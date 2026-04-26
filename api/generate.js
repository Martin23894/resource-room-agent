import { Packer } from 'docx';

import { logger as defaultLogger } from '../lib/logger.js';
import { callAnthropic, callAnthropicTool, AnthropicError, TOOL_MODEL } from '../lib/anthropic.js';
import { planTool, qualityTool, memoVerifyTool } from '../lib/tools.js';
import { str, int, oneOf, bool, teacherGuidance as vGuidance, buildGuidanceBlock, ValidationError } from '../lib/validate.js';
import { getCogLevels, largestRemainder, isBarretts as isBarrettsFn } from '../lib/cognitive.js';
import { countMarks } from '../lib/marks.js';
import { ensureAnswerSpace } from '../lib/answer-space.js';
import { ATP, EXAM_SCOPE, getATPTopics } from '../lib/atp.js';
import { extractContent } from '../lib/content.js';
import { i18n } from '../lib/i18n.js';
import { cleanOutput, localiseLabels, stripLeadingMemoBanner } from '../lib/clean-output.js';
import { correctCogAnalysisTable, parseMemoAnswerRows } from '../lib/cog-table.js';
import { ensureSequentialSectionLetters } from '../lib/sections.js';
import { validatePlan, planContext, LOW_DEMAND_TYPES } from '../lib/plan.js';
import { verifyCogBalance, formatImbalances } from '../lib/cog-balance.js';
import { validateMemoStructure } from '../lib/memo-structure.js';
import { cacheGet, cacheSet } from '../lib/cache.js';
import { generateCacheKey } from '../lib/cache-key.js';
import { createDocxBuilder } from '../lib/docx-builder.js';
import { buildPrompts } from '../lib/prompts.js';
import { createEventChannel } from '../lib/sse.js';

// ============================================================
// MAIN HANDLER
// ============================================================
export default async function handler(req, res) {
  const log = req.log || defaultLogger;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let subject, topic, resourceType, language, duration, difficulty, includeRubric, grade, term, bypassCache, guidance;
  try {
    subject      = str(req.body?.subject,      { field: 'subject',      max: 200 });
    topic        = str(req.body?.topic,        { field: 'topic',        required: false, max: 500 });
    resourceType = str(req.body?.resourceType, { field: 'resourceType', max: 50 });
    language     = str(req.body?.language,     { field: 'language',     max: 40 });
    duration     = int(req.body?.duration,     { field: 'duration',     required: false, min: 10, max: 200 }) || 50;
    difficulty   = oneOf(req.body?.difficulty || 'on', ['below', 'on', 'above'], { field: 'difficulty' });
    includeRubric = bool(req.body?.includeRubric);
    // _bypassCache is optional — set to true by the Regenerate button so
    // teachers get fresh content instead of the cached version.
    bypassCache  = bool(req.body?._bypassCache);
    grade        = int(req.body?.grade, { field: 'grade', min: 4, max: 7 });
    term         = int(req.body?.term,  { field: 'term',  min: 1, max: 4 });
    // Free-form pre-prompt. Kept short (500 char cap) and injected into
    // the USER message only (never the system prompt) so it does not
    // invalidate prompt caching and cannot jailbreak curriculum scope.
    guidance     = vGuidance(req.body?.teacherGuidance);

    // Defensive lock for HL/FAL language subjects: an Afrikaans Home
    // Language paper can never be generated in English, and vice versa.
    // The UI greys out the wrong button, but a direct API call could
    // still send an incoherent pair — caught here so the pipeline never
    // sees one (the bilingual chimera observed in the audit pool).
    const SUBJECT_FORCED_LANG = {
      'Afrikaans Home Language':             'Afrikaans',
      'Afrikaans First Additional Language': 'Afrikaans',
      'English Home Language':               'English',
      'English First Additional Language':   'English',
    };
    const forced = SUBJECT_FORCED_LANG[subject];
    if (forced && language !== forced) {
      return res.status(400).json({
        error: `Subject "${subject}" must be generated in ${forced}, not ${language}.`,
      });
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

  // ── Event channel + cancellation plumbing ──
  // SSE mode (Accept: text/event-stream) streams phase updates; plain
  // JSON mode keeps the original request/response API. A client disconnect
  // aborts the AbortController, which propagates into every in-flight
  // Claude call and halts the pipeline.
  const channel = createEventChannel(req, res);
  const abortController = new AbortController();
  const signal = abortController.signal;
  let clientClosed = false;
  channel.onClose(() => {
    clientClosed = true;
    log.info('Client disconnected — aborting generation');
    abortController.abort();
  });

  // ── Cache short-circuit ──
  // Identical generation params within the TTL window return instantly
  // at zero Anthropic cost. Default TTL is 1h (CACHE_TTL_SECONDS env).
  // The Regenerate button sends _bypassCache=true so teachers can force a
  // fresh paper; we still WRITE the fresh result to the cache so downstream
  // retries / reloads benefit from it.
  const cacheKey = generateCacheKey({
    subject, topic, resourceType, language, duration, difficulty, includeRubric, grade, term,
    teacherGuidance: guidance,
  });
  if (!bypassCache) {
    try {
      const hit = cacheGet(cacheKey);
      if (hit) {
        log.info({ cacheKey }, 'Cache hit — serving stored response');
        channel.sendPhase('cache', 'hit');
        channel.sendResult({ ...hit, cached: true });
        return;
      }
    } catch (cacheErr) {
      log.warn({ err: cacheErr?.message || cacheErr }, 'Cache read failed — continuing with live generation');
    }
  } else {
    log.info({ cacheKey }, 'Cache bypass requested — generating fresh');
  }

  const g = grade;
  const t = term;
  const phase = g <= 3 ? 'Foundation' : g <= 6 ? 'Intermediate' : 'Senior';
  const isExam = resourceType === 'Exam';
  const isFinalExam = resourceType === 'Final Exam';
  const isWorksheet = resourceType === 'Worksheet';
  const isTest = resourceType === 'Test';
  const isExamType = isExam || isFinalExam;
 
  const totalMarks = parseInt(duration) || 50;
 
  // ── ATP topic lookup — replaces allTopics from UI ──
  // Always use the database; topic field is now just a focus hint
  const atpTopics = isFinalExam
    ? [1, 2, 3, 4].flatMap(tm => (ATP[subject]?.[g]?.[tm]) || [])
    : getATPTopics(subject, g, t, isExamType);
 
  const atpTopicList = atpTopics.length > 0
    ? atpTopics.join('\n- ')
    : (topic || subject);
 
  const focusHint = topic && topic !== subject
    ? `\nFOCUS: The teacher has requested emphasis on: ${topic}\n(This is a specific focus within the above topic list — do not limit to only this topic)`
    : '';
 
  const L = i18n(language);
  const docx = createDocxBuilder({ subject, resourceType, language, grade: g, term: t, totalMarks, isWorksheet });
  const { buildDoc, displaySubject, timeAllocation } = docx;
  const diffNote = difficulty === 'below' ? 'Below grade level' : difficulty === 'above' ? 'Above grade level' : 'On grade level';
 
  const cog = getCogLevels(subject);
  const isBarretts = isBarrettsFn(cog);
  const cogMarks = largestRemainder(totalMarks, cog.pcts);
  const cogTolerance = Math.max(1, Math.round(totalMarks * 0.02));
  const cogTable = cog.levels.map((l, i) => l + ' ' + cog.pcts[i] + '% = ' + cogMarks[i] + ' marks').join('\n');
 
  // Build topic instruction using ATP database
  let topicInstruction = '';
  // Build separate T1 and T2 topic lists for exam terms so the split is explicit
  const examTerm1Topics = isExam && t === 2 ? (ATP[subject]?.[g]?.[1] || []) : [];
  const examTerm2Topics = isExam && t === 2 ? (ATP[subject]?.[g]?.[2] || []) : [];
  const examTerm3Topics = isExam && t === 4 ? (ATP[subject]?.[g]?.[3] || []) : [];
  const examTerm4Topics = isExam && t === 4 ? (ATP[subject]?.[g]?.[4] || []) : [];

  if (isFinalExam) {
    topicInstruction = `FINAL EXAM — covers ALL topics from the entire year (Terms 1, 2, 3 and 4).\nEnsure questions are spread across these topics:\n- ${atpTopicList}${focusHint}`;
  } else if (isExam && t === 2) {
    const t1List = examTerm1Topics.join('\n  - ');
    const t2List = examTerm2Topics.join('\n  - ');
    topicInstruction = `TERM 2 EXAM — THIS IS AN EXAM TERM. CAPS requires BOTH Term 1 AND Term 2 content.

⚠️ CRITICAL SPLIT RULE — NON-NEGOTIABLE:
Approximately 50% of marks must come from Term 1 topics and 50% from Term 2 topics.
The difference between the two terms must NEVER exceed 70%/30%.
A paper using ONLY Term 1 topics is WRONG and will be rejected.
A paper using ONLY Term 2 topics is WRONG and will be rejected.
You MUST include questions from BOTH lists below.

TERM 1 TOPICS for Grade ${g} ${subject} (approximately ${Math.round(totalMarks * 0.5)} marks from here):
  - ${t1List}

TERM 2 TOPICS for Grade ${g} ${subject} (approximately ${Math.round(totalMarks * 0.5)} marks from here):
  - ${t2List}${focusHint}`;
  } else if (isExam && t === 4) {
    const t3List = examTerm3Topics.join('\n  - ');
    const t4List = examTerm4Topics.join('\n  - ');
    topicInstruction = `TERM 4 EXAM — THIS IS AN EXAM TERM. CAPS requires BOTH Term 3 AND Term 4 content.

⚠️ CRITICAL SPLIT RULE — NON-NEGOTIABLE:
Approximately 50% of marks must come from Term 3 topics and 50% from Term 4 topics.
The difference between the two terms must NEVER exceed 70%/30%.
A paper using ONLY Term 3 topics is WRONG and will be rejected.
A paper using ONLY Term 4 topics is WRONG and will be rejected.
You MUST include questions from BOTH lists below.

TERM 3 TOPICS for Grade ${g} ${subject} (approximately ${Math.round(totalMarks * 0.5)} marks from here):
  - ${t3List}

TERM 4 TOPICS for Grade ${g} ${subject} (approximately ${Math.round(totalMarks * 0.5)} marks from here):
  - ${t4List}${focusHint}`;
  } else {
    topicInstruction = `TERM ${t} ASSESSMENT — covers ONLY Term ${t} topics (CAPS rule: Term 1 and Term 3 assessments test only that term's work).\nQuestions MUST be drawn ONLY from these CAPS-prescribed Grade ${g} Term ${t} topics:\n- ${atpTopicList}${focusHint}\n\nDO NOT include topics from other terms — this is a strict CAPS compliance requirement.`;
  }
 
  // ═══════════════════════════════════════
  // CLAUDE API — delegates to shared wrapper (retries + 180s timeout);
  // this thin adapter preserves the legacy content-extraction behaviour
  // (JSON.content if present, else raw text with escape chars unescaped).
  // Structured-output migration is Phase 1.5.
  // ═══════════════════════════════════════
  async function callClaude(system, user, maxTok) {
    let raw;
    try {
      raw = await callAnthropic({ system, user, maxTokens: maxTok, logger: log, signal });
    } catch (err) {
      if (err instanceof AnthropicError && err.code === 'TIMEOUT') {
        throw new Error('Generation is taking longer than usual. Please try again — complex resources can take up to 3 minutes.');
      }
      throw err;
    }
    return extractContent(raw);
  }

  // Thin alias kept for legacy call sites — safeExtractContent was the old
  // hand-rolled version of extractContent. They now do the same thing.
  const safeExtractContent = extractContent;

  // Detect when Phase 3B (cog analysis + extension + rubric) hit max_tokens
  // mid-output. Conservative — only flags responses that show clear signs of
  // being truncated mid-table. Used to trigger a single retry with a higher
  // budget; if the retry also looks truncated we keep what we have.
  function looksTruncated(text, withRubric) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trimEnd();
    if (trimmed.length < 100) return true;          // suspiciously short
    const tail = trimmed.slice(-12);
    // Ends mid-word (no terminating whitespace, punctuation, pipe, or paren)
    // and the last visible char looks like a letter — strong sign of cut-off.
    if (/[A-Za-z]$/.test(trimmed) && !/[.!?\]\)|]\s*$/.test(trimmed)) {
      return true;
    }
    // If a rubric was requested, the response must contain at least one full
    // pipe-table row covering "Level 1" or its closing column. A rubric-aware
    // section that ends without that is a truncation.
    if (withRubric) {
      const hasRubricHeading = /(MARKING RUBRIC|NASIENRUBRIEK|Marking Rubric)/i.test(trimmed);
      if (hasRubricHeading) {
        // Count pipe-rows after the rubric heading; a complete 4-criterion
        // rubric has at least 5 rows (header + 4 criteria). Far fewer = cut off.
        const idx = trimmed.search(/(MARKING RUBRIC|NASIENRUBRIEK|Marking Rubric)/i);
        const rubricSection = idx >= 0 ? trimmed.slice(idx) : '';
        const pipeRows = (rubricSection.match(/^\s*\|.*\|\s*$/gm) || []).length;
        if (pipeRows < 4) return true;
        // Rubric should end with a row that closes with `|`. If the last
        // non-empty line doesn't, the table is incomplete.
        const lines = rubricSection.split('\n').map((l) => l.trimEnd()).filter(Boolean);
        const lastLine = lines[lines.length - 1] || '';
        if (!/\|\s*$/.test(lastLine)) return true;
      }
    }
    return false;
  }

  // ═══════════════════════════════════════
  // PROMPTS — standard (non-RTT) pipeline
  // ═══════════════════════════════════════
  const { planSys, planUsr, qSys, qUsr, mSys, mUsrA, mUsrB, taxLabel } = buildPrompts({
    subject, topic, resourceType, language,
    grade: g, term: t, totalMarks,
    phase, difficulty, diffNote, includeRubric,
    isWorksheet, isTest, isExamType,
    cog, cogMarks, cogTolerance,
    isBarretts,
    atpTopicList, topicInstruction, atpTopics,
    teacherGuidance: guidance,
  });

  // ═══════════════════════════════════════
  // RESPONSE TO TEXT — 4-SECTION PIPELINE
  // Runs instead of the standard pipeline for English HL/FAL
  // and Afrikaans HL/FAL Response to Text papers
  // ═══════════════════════════════════════
  const isResponseToText = isBarretts && !isWorksheet;

  // Barrett's marks per section for a Response to Text paper:
  // Section A: Comprehension 20 marks  → own Barrett's
  // Section B: Visual text  10 marks  → own Barrett's
  // Section C: Summary       5 marks  → Reorganisation only
  // Section D: Language     15 marks  → own Barrett's
  // Total = 50 marks (standard). For non-50 papers, scale proportionally.
  function getRTTSectionMarks(total) {
    if (total === 50) return { a: 20, b: 10, c: 5, d: 15 };
    // Scale proportionally, round to whole numbers
    const scale = total / 50;
    const a = Math.round(20 * scale);
    const b = Math.round(10 * scale);
    const d = Math.round(15 * scale);
    const c = total - a - b - d;
    return { a, b, c: Math.max(c, 3), d };
  }

  // Barrett's marks per level for a given section total
  function getBarrettMarks(sectionTotal, includeSummaryOnly = false) {
    if (includeSummaryOnly) {
      // Summary is purely Reorganisation level
      return [0, sectionTotal, 0, 0];
    }
    return largestRemainder(sectionTotal, [20, 20, 40, 20]);
  }

  async function generateResponseToText() {
    const lang = language;
    const isAfrikan = subject.toLowerCase().includes('afrikaans');
    const secLabel = isAfrikan
      ? ['AFDELING A', 'AFDELING B', 'AFDELING C', 'AFDELING D']
      : ['SECTION A', 'SECTION B', 'SECTION C', 'SECTION D'];
    const sm = getRTTSectionMarks(totalMarks);

    // Shared passage — one literary or non-literary reading passage for Section A & C
    const passageSys = `You are a South African CAPS ${phase} Phase ${lang} teacher.
Write a reading passage suitable for Grade ${g} learners in ${lang}.
Use South African context, names (Sipho, Ayanda, Zanele, Thandi, Pieter, Anri), SA places, SA currency (rands).
The passage must be:
- A ${isAfrikan ? 'literêre of nie-literêre teks' : 'literary or non-literary text'}
- Appropriate reading level for Grade ${g}
- Between 250 and 350 words long
- Interesting and relevant to South African learners
- NOT about diagrams, maps or images (text only)
Return ONLY the passage text — no title instructions or commentary.`;
    const passageUsr = `Write the reading passage for a Grade ${g} ${subject} Term ${t} Response to Text paper.
Topic must align with CAPS Term ${t} ${subject} reading content.
Return only the passage.`;

    channel.sendPhase('rtt_passage', 'started');
    let passage = '';
    try {
      passage = await callClaude(passageSys, passageUsr, 1200);
      passage = passage.replace(/^```.*\n?/, '').replace(/```$/, '').trim();
      channel.sendPhase('rtt_passage', 'done');
    } catch (e) {
      passage = '';
      channel.sendPhase('rtt_passage', 'failed');
    }

    // Helper: build Barrett's table for a section
    function barretts(marks, includeSummaryOnly = false) {
      const bm = getBarrettMarks(marks, includeSummaryOnly);
      const levels = ['Literal', 'Reorganisation', 'Inferential', 'Evaluation and Appreciation'];
      const pcts = [20, 20, 40, 20];
      if (includeSummaryOnly) {
        return `| Cognitive Level | Prescribed % | Marks |\n|---|---|---|\n| Reorganisation | 100% | ${marks} |`;
      }
      return `| Cognitive Level | Prescribed % | Marks |\n|---|---|---|\n` +
        levels.map((l, i) => `| ${l} | ${pcts[i]}% | ${bm[i]} |`).join('\n');
    }

    // SECTION A — Comprehension (20 marks)
    const secASys = `You are a South African CAPS Grade ${g} ${subject} teacher writing ${secLabel[0]} of a Response to Text exam in ${lang}.
DIFFICULTY: ${diffNote}
This section tests COMPREHENSION ONLY — NO language/grammar questions here.
Language questions belong ONLY in Section D.
The reading passage is provided. All questions must refer to it.

Barrett's Taxonomy cognitive levels for this section (${sm.a} marks total):
${barretts(sm.a)}

FORMAT:
- Heading: ${secLabel[0]}: ${isAfrikan ? 'BEGRIP' : 'COMPREHENSION'} [${sm.a}]
- Sub-heading: ${isAfrikan ? 'Lees die gegewe teks en beantwoord die vrae wat volg.' : 'Read the passage and answer the questions that follow.'}
- Questions numbered 1.1, 1.2 … with mark in brackets (X) on same line
- Progress from Literal → Reorganisation → Inferential → Evaluation and Appreciation
- End with: [${sm.a}]
- NO grammar, vocabulary, figure of speech, or language structure questions
Return JSON: {"content":"Section A text only"}`;

    const secAUsr = `READING PASSAGE:\n${passage}\n\nWrite ${secLabel[0]} — Comprehension questions (${sm.a} marks) following the instructions exactly.`;

    // SECTION B — Visual Text (10 marks)
    const secBSys = `You are a South African CAPS Grade ${g} ${subject} teacher writing ${secLabel[1]} of a Response to Text exam in ${lang}.
This section tests VISUAL TEXT comprehension ONLY — NO language/grammar questions here.
Language questions belong ONLY in Section D.

IMPORTANT — NO DIAGRAMS RULE: This system cannot display actual images or posters.
Instead, describe a visual text in words (e.g. "Study the advertisement described below:" then describe layout, text, images, colours in words). Learners answer questions about the described visual.

Barrett's Taxonomy cognitive levels for this section (${sm.b} marks total):
${barretts(sm.b)}

FORMAT:
- Heading: ${secLabel[1]}: ${isAfrikan ? 'VISUELE TEKS' : 'VISUAL TEXT'} [${sm.b}]
- Describe the visual text in words (advertisement, poster, or cartoon)
- Sub-heading: ${isAfrikan ? 'Bestudeer die visuele teks hieronder en beantwoord die vrae.' : 'Study the visual text below and answer the questions.'}
- Questions numbered 2.1, 2.2 … with mark in brackets (X) on same line
- End with: [${sm.b}]
- NO grammar, vocabulary, or language structure questions
Return JSON: {"content":"Section B text only"}`;

    const secBUsr = `Write ${secLabel[1]} — Visual Text questions (${sm.b} marks) for Grade ${g} ${subject} Term ${t}.
Use SA context. Describe a visual in words (advertisement, poster or cartoon about an SA topic relevant to Grade ${g}).`;

    // SECTION C — Summary (5 marks)
    const secCSys = `You are a South African CAPS Grade ${g} ${subject} teacher writing ${secLabel[2]} of a Response to Text exam in ${lang}.
This section is a SUMMARY WRITING task ONLY — one question only.
Barrett's Taxonomy: This is a Reorganisation level task (selecting and organising key information).

FORMAT:
- Heading: ${secLabel[2]}: ${isAfrikan ? 'OPSOMMING' : 'SUMMARY'} [${sm.c}]
- Instruct learners to write a summary of the reading passage (from Section A) in their own words
- Specify maximum word count (about 50 words for 5 marks, scale accordingly)
- State exactly what the summary must include (e.g. main points, key ideas)
- End with: [${sm.c}]

LEARNER PAPER ONLY — non-negotiable:
Do NOT include marking-rubric guidance on the learner paper. NEVER write
"Award UP TO X marks for CONTENT", "Award UP TO X marks for LANGUAGE",
"Deduct marks if…", or "Do NOT penalise for…". Marking criteria belong
in the memo (Phase 3 below) — the learner sees only the task and the
required content points. The total mark allocation is shown only by the
[${sm.c}] block label at the end.

Return JSON: {"content":"Section C text only"}`;

    const secCUsr = `READING PASSAGE (from Section A):\n${passage}\n\nWrite ${secLabel[2]} — Summary task (${sm.c} marks).`;

    // SECTION D — Language Structures and Conventions
    const secDSys = `You are a South African CAPS Grade ${g} ${subject} teacher writing ${secLabel[3]} of a Response to Text exam in ${lang}.
THIS IS THE ONLY SECTION WHERE LANGUAGE/GRAMMAR QUESTIONS ARE ASKED.
Do NOT include comprehension questions here — only language structures and conventions.

Barrett's Taxonomy for this section (${sm.d} marks total):
${barretts(sm.d)}

CAPS Grade ${g} ${subject} Term ${t} Language topics to draw from:
${atpTopicList}

QUESTION TYPES (mix these — do not repeat the same type more than twice):
- Parts of speech (nouns, verbs, adjectives, adverbs, pronouns)
- Tense (change sentence from present to past, etc.)
- Active/Passive voice
- Direct/Indirect speech
- Punctuation and capitalisation
- Synonyms and antonyms
- Prefixes and suffixes
- Figures of speech (simile, metaphor, personification)
- Sentence structure (combine sentences, identify subject/predicate)
- Vocabulary in context
AVOID: conditional sentences and other Grade 7+ structures for Grade 6.

FORMAT:
- Heading: ${secLabel[3]}: ${isAfrikan ? 'TAALSTRUKTURE EN -KONVENSIES' : 'LANGUAGE STRUCTURES AND CONVENTIONS'} [${sm.d}]
- Questions numbered 4.1, 4.2 … with mark in brackets (X) on same line
- Mix question types — provide context sentences for each
- End with: [${sm.d}]
Return JSON: {"content":"Section D text only"}`;

    const secDUsr = `Write ${secLabel[3]} — Language Structures and Conventions (${sm.d} marks) for Grade ${g} ${subject} Term ${t} in ${lang}.`;

    // Generate all 4 sections in parallel
    log.info(`RTT Pipeline: generating 4 sections in parallel (${sm.a}+${sm.b}+${sm.c}+${sm.d}=${sm.a+sm.b+sm.c+sm.d} marks)`);
    channel.sendPhase('rtt_sections', 'started');
    const [secARaw, secBRaw, secCRaw, secDRaw] = await Promise.all([
      callClaude(secASys, secAUsr, 3000),
      callClaude(secBSys, secBUsr, 2000),
      callClaude(secCSys, secCUsr, 1000),
      callClaude(secDSys, secDUsr, 2500)
    ]);
    channel.sendPhase('rtt_sections', 'done');

    const secA = cleanOutput(safeExtractContent(secARaw));
    const secB = cleanOutput(safeExtractContent(secBRaw));
    const secC = cleanOutput(safeExtractContent(secCRaw));
    const secD = cleanOutput(safeExtractContent(secDRaw));

    // Assemble the full paper
    const passageHeading = isAfrikan ? 'LEESSTUK:' : 'READING PASSAGE:';
    const questionPaper = [
      passageHeading,
      '',
      passage,
      '',
      secA,
      '',
      secB,
      '',
      secC,
      '',
      secD,
      '',
      `${L.totalLabel}: _____ / ${totalMarks} ${L.marksWord}`
    ].join('\n');

    log.info(`RTT Pipeline: paper assembled (${questionPaper.length} chars)`);

    // ── RTT Memo Phase 1: Section A (Comprehension) answers + Barrett's ──
    // Deliberately separate from the question paper generation to stay within token limits
    const rttMemoSys = `You are a South African CAPS Grade ${g} ${subject} teacher creating a memorandum for a Response to Text exam in ${lang}.
Use pipe | tables only. No Unicode box characters. No markdown headings with #.
Return JSON: {"content":"memorandum text"}`;

    const rttMemoUsrA = `READING PASSAGE:
${passage}

${secLabel[0]} QUESTIONS (${sm.a} marks):
${secA}

Write the memo for ${secLabel[0]} ONLY:

1. Answer table with columns: ${L.memo.no} | ${L.memo.answer} | ${L.memo.guidance} | ${L.memo.cogLevel} | ${L.memo.mark}
   - List EVERY sub-question (1.1, 1.2, 1.3, … through to the last sub-question, INCLUDING the highest-mark final question).
   - Do NOT skip any sub-question. Do NOT truncate the table early. The answer
     table must cover every sub-question listed above without exception.
   - COGNITIVE LEVEL must be one of: Literal | Reorganisation | Inferential | Evaluation and Appreciation
   - Use the MARK shown in brackets on each question line.

2. NAMES AND FACTS — non-negotiable:
   When a sub-question asks about characters, places, items, or events
   from the reading passage above, your ANSWER must contain the actual
   names / details from the passage VERBATIM. Read the passage and copy
   the names exactly. Do NOT write placeholder text like "(name as in
   text)" or "(naam soos in teks vermeld)" — that is invalid output.
   If the question is "Who appeared before Sipho?" and the passage names
   "Anri" and "Pieter", your ANSWER cell must contain "Anri" and "Pieter"
   — not a placeholder. Same rule applies to all factual recall items.

3. After the answer table, write a Barrett's Taxonomy summary for
   ${secLabel[0]} ONLY:
   | Barrett's Level | Questions | Marks Allocated | Marks as % of Section |
   All rows must sum to exactly ${sm.a} marks. Target: Literal 20%, Reorganisation 20%, Inferential 40%, Evaluation 20%.

4. End with: ${secLabel[0]} ${L.totalLabel}: ${sm.a} ${L.marksWord}

Return JSON: {"content":"Section A memo"}`;

    // ── RTT Memo Phase 2: Section B (Visual Text) + Section C (Summary) answers + Barrett's ──
    // Audit Bug 9 — earlier wording had Part 1 and Part 2 mixed in the
    // model output: the Section B distribution table showed Section C's
    // rubric criteria ("Content Point 1 + Language and Structure") with
    // Section C's mark count, and the closing total said "SECTION C
    // TOTAL: 5 marks" under the SECTION B heading. The fix below uses
    // hard separators, mandates a literal distribution-table format for
    // Part 1, and forbids the rubric-criteria pattern by name.
    //
    // Audit Bug 20 — the Section C memo had no access to the reading
    // passage, so Claude invented a model summary about a different story
    // (Paper 7: memo described sneakers + homeless child while the actual
    // passage was about a beach trip to uMhlanga). The passage is now
    // included verbatim so the content points the memo lists are anchored
    // to the same passage Section A asked questions on.
    const rttMemoUsrB = `READING PASSAGE (the source text Section C asks the learner to summarise — model answers must reference THIS passage's content, names, places and events; do NOT invent a different story):
${passage}

${secLabel[1]} QUESTIONS (${sm.b} marks):
${secB}

${secLabel[2]} QUESTION (${sm.c} marks):
${secC}

Write the memo for ${secLabel[1]} AND ${secLabel[2]}. The two parts are
SEPARATE. Do NOT mix Part 2's rubric criteria into Part 1's distribution
table. Do NOT close Part 1 with "${secLabel[2]} TOTAL" — it must close
with "${secLabel[1]} ${L.totalLabel}".

═══════════════════════════════════════════════════════
PART 1 — ${secLabel[1]} VISUAL TEXT MEMO (${sm.b} marks)
═══════════════════════════════════════════════════════

EMIT ALL THREE OF THESE — NEVER SKIP. The pipeline rejects any Part 1
that arrives without an answer table (Bug 19 prevention).

1. Answer table FIRST — columns: ${L.memo.no} | ${L.memo.answer} | ${L.memo.guidance} | ${L.memo.cogLevel} | ${L.memo.mark}
   List EVERY visual-text sub-question (2.1, 2.2, 2.3 …) on its own row.
   Do NOT skip any sub-question. Do NOT abbreviate the table to a single
   "see below" line. Each row must have an answer cell and a marking
   guidance cell with real content — never empty cells.
   Cognitive level is one of: Literal / Reorganisation / Inferential / Evaluation and Appreciation.

2. Barrett's Taxonomy DISTRIBUTION TABLE for ${secLabel[1]} ONLY.
   Use EXACTLY these columns:
   | Cognitive Level | Questions | Marks |
   This table MUST contain ALL FOUR Barrett's levels — Literal,
   Reorganisation, Inferential, Evaluation and Appreciation — even if
   some have 0 marks (write "—" in the Questions cell and 0 in Marks).
   The "Questions" column lists the sub-question NUMBERS at each level
   (e.g. "2.1, 2.3"). It does NOT contain "Content Point 1", "Content
   Point 2", "Language and Structure", or any rubric phrase — those
   belong in Part 2.
   The Marks column adds to EXACTLY ${sm.b} marks for this section.
   Bug 9 prevention: do NOT emit a single-row table like
   "| Reorganisation | … | 5 |" — that is Part 2's pattern, not Part 1's.

3. Close Part 1 with this exact line:
   ${secLabel[1]} ${L.totalLabel}: ${sm.b} ${L.marksWord}

═══════════════════════════════════════════════════════
PART 2 — ${secLabel[2]} SUMMARY TASK MEMO (${sm.c} marks)
═══════════════════════════════════════════════════════

CRITICAL — passage anchoring (Bug 20): Every content point you list MUST
be grounded in the READING PASSAGE shown at the top of this prompt. Use
the actual character names, places, events and quantities from THAT
passage. Do NOT invent a different story. If the passage is about a
beach trip to uMhlanga, the model summary covers that beach trip — not
shopping, sneakers, or any unrelated scenario.

1. Answer table — columns: ${L.memo.no} | ${L.memo.answer} | ${L.memo.guidance} | ${L.memo.cogLevel} | ${L.memo.mark}
   This section awards marks for: content points covered + language/structure.
   All marks count as Reorganisation level.
   Number rows by content criterion (e.g. 3.1, 3.2 … or Content Point 1, 2 …).
   Each content-point row's ANSWER cell quotes or paraphrases the actual
   passage — names, places and events as they appear above.

2. Barrett's Taxonomy summary for ${secLabel[2]} ONLY.
   All ${sm.c} marks at Reorganisation level.

3. Close Part 2 with this exact line:
   ${secLabel[2]} ${L.totalLabel}: ${sm.c} ${L.marksWord}

Return JSON: {"content":"Section B and C memo"}`;

    // ── RTT Memo Phase 3: Section D (Language) answers + Barrett's + combined paper table ──
    const _bLevels = L.barretts?.levels || ['Literal', 'Reorganisation', 'Inferential', 'Evaluation and Appreciation'];
    const _bPcts   = [20, 20, 40, 20];
    const _bMarks  = largestRemainder(totalMarks, [20, 20, 40, 20]);
    const _bHeading = L.barretts?.combinedHeading
      ? L.barretts.combinedHeading(totalMarks)
      : `COMBINED BARRETT'S TAXONOMY ANALYSIS — FULL PAPER (${totalMarks} marks)`;
    const _bColumns = L.barretts?.columns ||
      "| Barrett's Level | Prescribed % | Prescribed Marks | Actual Marks | Actual % |";
    const _bRows = _bLevels.map((lvl, i) =>
      `| ${lvl} | ${_bPcts[i]}% | ${_bMarks[i]} | [sum from all sections] | [%] |`
    ).join('\n');
    const _bTotalLabel = language === 'Afrikaans' ? 'TOTAAL' : 'TOTAL';

    const rttMemoUsrD = `${secLabel[3]} QUESTIONS (${sm.d} marks):
${secD}

Write the memo for ${secLabel[3]}:
1. Answer table: ${L.memo.no} | ${L.memo.answer} | ${L.memo.guidance} | ${L.memo.cogLevel} | ${L.memo.mark}
   List every sub-question (4.1, 4.2 … etc). Use Literal/Reorganisation/Inferential/Evaluation and Appreciation.
2. Barrett's Taxonomy summary for ${secLabel[3]} ONLY (must sum to ${sm.d} marks).
3. End with: ${secLabel[3]} ${L.totalLabel}: ${sm.d} ${L.marksWord}

Then write the COMBINED PAPER BARRETT'S ANALYSIS:
Heading: ${_bHeading}
Write this pipe table exactly (fill in the Actual Marks column by summing each level across all four section Barrett's tables above):
${_bColumns}
${_bRows}
| ${_bTotalLabel} | 100% | ${totalMarks} | [must equal ${totalMarks}] | 100% |

Actual Marks per level = sum across ALL four sections. All Actual Marks must total exactly ${totalMarks}.

Return JSON: {"content":"Section D memo and combined Barrett's"}`;

    log.info(`RTT Memo: generating in 3 phases (A / B+C / D+combined)`);
    channel.sendPhase('rtt_memo', 'started');
    // Token budget bump (Bug 19): the B+C phase has to fit TWO answer
    // tables (Section B + Section C) plus two Barrett's tables in one
    // response. At 4000 tokens it routinely truncated the Section B
    // body — Paper 7 audit found the section had only its closing
    // "SECTION B TOTAL: 10 marks" line and no answer table at all.
    // Afrikaans is ~20% wordier than English so the multiplier is
    // applied across all three phases.
    const isAfrRtt = (language || '').toLowerCase() === 'afrikaans';
    const rttTok = (base) => Math.round(base * (isAfrRtt ? 1.2 : 1));
    const [memoARaw, memoBCRaw, memoDRaw] = await Promise.all([
      callClaude(rttMemoSys, rttMemoUsrA, rttTok(6000)),
      callClaude(rttMemoSys, rttMemoUsrB, rttTok(7000)),
      callClaude(rttMemoSys, rttMemoUsrD, rttTok(6000))
    ]);
    channel.sendPhase('rtt_memo', 'done');

    // Strip any leading MEMORANDUM banner each phase emits — the assembly
    // below adds its own single outer banner, so phase-level reprises
    // would stack two or three "MEMORANDUM" headings on top of each other
    // (the Grade 6 Afrikaans HL audit caught a triple).
    let memoA  = stripLeadingMemoBanner(cleanOutput(safeExtractContent(memoARaw)));
    let memoBC = stripLeadingMemoBanner(cleanOutput(safeExtractContent(memoBCRaw)));
    let memoD  = stripLeadingMemoBanner(cleanOutput(safeExtractContent(memoDRaw)));

    // Bug 19 retry: the Section B+C phase has a higher truncation /
    // skip-the-answer-table risk because it emits two answer tables in
    // one response. If the result has NO answer-table header (Paper 7
    // shipped only "SECTION B TOTAL: 10 marks" with no rows), retry once
    // with the maximum budget. This is cheap insurance — a clean first
    // pass skips it entirely.
    if (!validateMemoStructure(memoBC).answerTable) {
      log.warn(
        { len: memoBC.length, tail: memoBC.slice(-200) },
        'RTT memo Phase BC: no answer-table header detected — retrying with max budget',
      );
      try {
        const retryRaw = await callClaude(rttMemoSys, rttMemoUsrB, rttTok(12000));
        const retryClean = stripLeadingMemoBanner(cleanOutput(safeExtractContent(retryRaw)));
        if (validateMemoStructure(retryClean).answerTable) {
          memoBC = retryClean;
          log.info('RTT memo Phase BC: retry succeeded — answer table now present');
        } else {
          log.warn('RTT memo Phase BC: retry still missing answer table — keeping original');
        }
      } catch (e) {
        log.warn({ err: e?.message || e }, 'RTT memo Phase BC: retry failed — keeping original');
      }
    }

    // Localised memo header — was hard-coded English even on Afrikaans
    // papers, which the Afrikaans HL audit caught.
    const rttHeader = L.rttMemo || { heading: 'MEMORANDUM', subtitle: () => '', framework: '' };
    const subjectDisplay = displaySubject || subject;

    // ── RTT Phase D-post: Deterministic combined Barrett's reconciliation (Bug 5) ──
    // The combined Barrett's table at the end of memoD often disagrees
    // with the per-section answer rows scattered across memoA / memoBC /
    // memoD (Paper 7 + Paper 9 audits). We rebuild the cog-analysis
    // table's Actual Marks column from the union of all three memo
    // phases' answer rows.
    //
    // RTT memos use language-appropriate level names — English uses the
    // canonical Barrett's labels, Afrikaans uses the Afrikaans translations.
    // tallyByLevel inside correctCogAnalysisTable matches case- and
    // whitespace-insensitively so we just supply both candidate sets and
    // keep whichever produces a non-zero tally.
    let memoDFinal = memoD;
    {
      const ENG_LEVELS = ['Literal', 'Reorganisation', 'Inferential', 'Evaluation and Appreciation'];
      const AFR_LEVELS = ['Letterlik', 'Herorganisasie', 'Inferensieel', 'Evaluering en Waardering'];
      const levels = (language === 'Afrikaans') ? AFR_LEVELS : ENG_LEVELS;
      const allAnswerRows = (memoA || '') + '\n' + (memoBC || '') + '\n' + (memoD || '');
      const prefix = allAnswerRows + '\n\n';
      const synthetic = prefix + memoD;
      const cogFix = correctCogAnalysisTable(synthetic, { levels, totalMarks });
      if (cogFix.changed && cogFix.text.startsWith(prefix)) {
        log.info(
          { computedByLevel: cogFix.computedByLevel, totalCounted: cogFix.totalCounted, language },
          'RTT combined Barrett\'s table reconciled against per-section answer rows (Bug 5)',
        );
        memoDFinal = cogFix.text.slice(prefix.length);
      }
    }

    const memoContent = [
      rttHeader.heading,
      '',
      typeof rttHeader.subtitle === 'function' ? rttHeader.subtitle(g, subjectDisplay, t) : `Grade ${g} ${subjectDisplay} — Response to Text — Term ${t}`,
      rttHeader.framework,
      '',
      memoA,
      '',
      memoBC,
      '',
      memoDFinal,
    ].join('\n');

    log.info(`RTT Memo: complete (${memoContent.length} chars — A:${memoARaw.length} BC:${memoBCRaw.length} D:${memoDRaw.length})`);

    // Per-section memo structure check. The Afrikaans HL audit caught a
    // truncated Section A memo that dropped Q1.9 entirely. Run the same
    // structural validator on each of the 3 RTT memo phases so we know
    // exactly which one (if any) came back incomplete.
    for (const [name, body] of [['Section A', memoA], ['Sections B+C', memoBC], ['Section D', memoD]]) {
      const s = validateMemoStructure(body);
      if (!s.answerTable) {
        log.warn(
          { section: name, len: body.length, tail: body.slice(-200) },
          'RTT memo: section is missing the answer-table header — likely truncated or incomplete',
        );
      }
    }

    const markTotal = totalMarks; // RTT papers use fixed mark total

    // RTT mark-sum check. The standard pipeline runs Phase 2a mark-drift
    // correction; the RTT pipeline did not, which let the Afrikaans HL paper
    // ship at 47 marks while claiming 50. We don't auto-correct (4-section
    // re-write would be expensive and risky) but we DO log a clear warning
    // when the assembled paper drifts so the next bad generation is
    // diagnosable from Railway logs alone.
    try {
      const actualMarks = countMarks(questionPaper);
      if (actualMarks > 0 && actualMarks !== markTotal) {
        log.warn(
          { claimed: markTotal, counted: actualMarks, drift: actualMarks - markTotal },
          'RTT paper: mark-sum drift between section headers and total — the paper does not actually sum to its TOTAL line',
        );
      }
    } catch (e) {
      log.info({ err: e?.message }, 'RTT mark-sum check skipped (parser error)');
    }

    // Safety net: inject blank answer lines where the AI forgot them, then
    // localise any English Answer:/Working: labels that survived as raw
    // Claude output (the injected MCQ stub is already localised by
    // ensureAnswerSpace, but embedded labels in maths/calculation questions
    // come straight from the model and need a second pass).
    const finalPaper = localiseLabels(ensureAnswerSpace(questionPaper, { language }), language);
    channel.sendPhase('docx_build', 'started');

    // Build DOCX
    let docxBase64 = null;
    const filename = (subject + '-ResponseToText-Grade' + g + '-Term' + t).replace(/[^a-zA-Z0-9\-]/g, '-') + '.docx';
    try {
      const doc = buildDoc(finalPaper, memoContent, markTotal);
      const buffer = await Packer.toBuffer(doc);
      docxBase64 = buffer.toString('base64');
    } catch (docxErr) {
      log.error({ err: docxErr?.message || docxErr }, 'RTT DOCX build error');
    }
    channel.sendPhase('docx_build', 'done');

    // RTT papers don't run a separate memo-verify step, so we report them
    // as "clean" unconditionally — the schema-driven RTT memo is trusted.
    const preview = finalPaper + '\n\n' + memoContent;
    const payload = { docxBase64, preview, filename, verificationStatus: 'clean' };
    try { cacheSet(cacheKey, payload); } catch (e) { log.warn({ err: e?.message || e }, 'Cache write failed'); }
    channel.sendResult(payload);
    return;
  }

  // ═══════════════════════════════════════
  // EXECUTE — multi-phase generation
  // ═══════════════════════════════════════
  try {
    // Route Barrett's subjects to the dedicated RTT pipeline
    if (isResponseToText) {
      return await generateResponseToText();
    }

    // ── Phase 1: Generate & validate question plan ──
    // Tool-use guarantees the response is a valid plan object — no JSON.parse,
    // no escape-character salvage, no try/catch around parsing. validatePlan
    // still enforces the CAPS rules on top.
    channel.sendPhase('plan', 'started');
    const planCtx = planContext({ totalMarks, cog, cogMarks, cogTolerance, atpTopics });
    let plan = null;
    let planAttempts = 0;
    while (!plan && planAttempts < 2) {
      planAttempts++;
      try {
        const parsedPlan = await callAnthropicTool({
          system: planSys,
          user: planUsr,
          tool: planTool(cog.levels),
          maxTokens: 1500,
          // Haiku 4.5 — structured output, shallow schema, cheap. ~3× saving.
          model: TOOL_MODEL,
          phase: 'plan',
          logger: log,
          signal,
        });
        plan = validatePlan(parsedPlan, planCtx, log);
        if (!plan) log.info(`Plan attempt ${planAttempts}: validation failed`);
      } catch (e) {
        log.info(`Plan attempt ${planAttempts}: error — ${e.message}`);
      }
    }
 
    if (!plan) {
      log.info('Plan validation failed — using JS fallback plan');
      const fallbackQuestions = [];
      const typeByLevel = ['MCQ', 'Short Answer', 'Multi-step', 'Word Problem'];
      cog.levels.forEach((lvl, li) => {
        let lvlMarks = cogMarks[li];
        const qType = typeByLevel[Math.min(li, typeByLevel.length - 1)];
        const chunkSize = li === 0 ? 5 : 10;
        while (lvlMarks > 0) {
          const chunk = Math.min(lvlMarks, chunkSize);
          fallbackQuestions.push({ number: 'Q' + (fallbackQuestions.length + 1), type: qType, topic: atpTopics[0] || subject, marks: chunk, cogLevel: lvl });
          lvlMarks -= chunk;
        }
      });
      plan = { questions: fallbackQuestions };
      log.info(`Fallback plan: ${fallbackQuestions.length} questions, ${fallbackQuestions.reduce((s,q)=>s+q.marks,0)} marks`);
    }
 
    log.info(`Plan validated: ${plan.questions.length} questions, ${plan.questions.reduce((s,q)=>s+q.marks,0)} marks`);
    channel.sendPhase('plan', 'done', {
      questions: plan.questions.length,
      marks: plan.questions.reduce((s, q) => s + q.marks, 0),
    });

    // ── Phase 2: Write questions from validated plan ──
    // Token budget: scaled to plan size + a healthy buffer for Afrikaans
    // (which is ~15% wordier than English). The Grade 7 Afrikaans Nat Sci
    // 85-mark Eindeksamen sample truncated mid-sentence at the old 5500-
    // cap, dropping all of Section C.
    channel.sendPhase('writing', 'started');
    const isAfr = (language || '').toLowerCase() === 'afrikaans';
    const qTokBase = isWorksheet ? 3000 : isExamType ? 8000 : 5500;
    const qTok = Math.round(qTokBase * (isAfr ? 1.2 : 1));
    let questionPaper = await callClaude(qSys(plan), qUsr(plan), qTok);
    questionPaper = cleanOutput(questionPaper);
    // Truncation guard — if the paper ends without a TOTAL line AND the
    // last block isn't a complete-looking question (no terminating mark
    // bracket on the final non-blank line), flag it so the operator can
    // retry. We don't auto-retry yet because Phase 2a usually salvages
    // mark drift — but a hard truncation that drops a whole section is
    // exactly the failure that shipped before this guard existed.
    {
      const tail = questionPaper.split('\n').filter((l) => l.trim()).slice(-3).join('\n');
      const hasTotal = /\b(TOTAL|TOTAAL)\s*:/i.test(tail);
      const endsCleanly = /[\.\?\)\]]\s*$/.test(tail) || /\(\d+\)\s*$/.test(tail);
      if (!hasTotal && !endsCleanly) {
        log.warn(
          { tail: tail.slice(-200), tokens: qTok },
          'Phase 2: paper appears TRUNCATED — no TOTAL line and ends mid-sentence. Section content may be missing.',
        );
        channel.sendPhase('writing', 'truncation_warning');
      }
    }
    channel.sendPhase('writing', 'done');
 
    // ── Phase 2a: Mark drift correction ──
    const countedAfterP2 = countMarks(questionPaper);
    const drift = countedAfterP2 - totalMarks;
    if (countedAfterP2 > 0 && drift !== 0) {
      channel.sendPhase('mark_drift', 'started', { counted: countedAfterP2, target: totalMarks, drift });
      log.info(`Mark drift: counted=${countedAfterP2}, target=${totalMarks}, drift=${drift > 0 ? '+' : ''}${drift}`);
      const corrSys = `You are correcting a ${subject} ${resourceType} question paper. The paper totals ${countedAfterP2} marks but must total EXACTLY ${totalMarks} marks. ${drift > 0 ? 'Reduce' : 'Increase'} the total by ${Math.abs(drift)} mark${Math.abs(drift) > 1 ? 's' : ''}.

STRICT OUTPUT RULES — NON-NEGOTIABLE:
- Your response must be VALID JSON and nothing else.
- Do NOT write any reasoning, commentary, planning text, "Current marks:" notes, "Change Q… from X to Y" lists, running tallies, verification checks, or explanations BEFORE or AFTER the JSON.
- Do NOT wrap the JSON in markdown fences.
- The ONLY text you output is a single JSON object: {"content":"<complete corrected paper>"}.

RULES FOR THE CORRECTION ITSELF:
- Change the minimum number of sub-question mark values needed.
- Only change (X) numbers — never change the question text or answer spaces.
- Keep all Working:/Answer:/Antwoord: lines exactly as they are.
- Keep the ${L.totalLabel} line exactly as it is except for the mark value.`;
      const corrUsr = `Paper totals ${countedAfterP2}, must be EXACTLY ${totalMarks}. ${drift > 0 ? 'Reduce' : 'Increase'} by ${Math.abs(drift)}.\n\nPAPER:\n${questionPaper}\n\nOutput the corrected paper as a single JSON object: {"content":"…"}. No prose before or after.`;
      try {
        const corrected = cleanOutput(await callClaude(corrSys, corrUsr, qTok));
        const countedAfterCorr = countMarks(corrected);
        if (countedAfterCorr === totalMarks) {
          questionPaper = corrected;
          log.info(`Correction successful: ${countedAfterCorr} marks ✓`);
          channel.sendPhase('mark_drift', 'done', { marks: countedAfterCorr });
        } else {
          log.info(`Correction resulted in ${countedAfterCorr} marks — keeping Phase 2 paper`);
          channel.sendPhase('mark_drift', 'kept_original', { marks: countedAfterP2 });
        }
      } catch (corrErr) {
        log.info(`Correction failed: ${corrErr.message}`);
        channel.sendPhase('mark_drift', 'failed');
      }
    } else if (countedAfterP2 === totalMarks) {
      log.info(`Phase 2 exact: ${countedAfterP2} marks ✓`);
    }
 
    const finalCount = countMarks(questionPaper);
    let markTotal = finalCount > 0 ? finalCount : totalMarks;
    log.info(`Final mark total: ${markTotal}`);

    // Bug 11 — surface a warning if the body still doesn't sum to the
    // cover-page total after Phase 2a tried to correct it. The DOCX cover
    // is built from totalMarks; a residual mismatch means the printed
    // total disagrees with the actual question marks (the Grade 7 Nat
    // Sci 85-vs-100 case).
    if (finalCount > 0 && finalCount !== totalMarks) {
      log.warn(
        { cover: totalMarks, body: finalCount, drift: finalCount - totalMarks },
        'Standard pipeline: body mark sum does not match cover total — printed cover and content disagree',
      );
    }

    // ── Phase 2a-bis: Section letter renumbering (Bug 22) ──
    // Paper 11 (Grade 7 EMS Term 2) shipped with SECTION A → unlabelled
    // Q2/Q3 → SECTION C → SECTION D. The prompt forbids gaps but the
    // writer occasionally produces them anyway. Renumber in-place so the
    // visible labels are A, B, C, D, … and cleanly sequential. We do not
    // rewrite question text, only the SECTION/AFDELING headers themselves.
    {
      const sec = ensureSequentialSectionLetters(questionPaper);
      if (sec.changed) {
        log.warn(
          { replacements: sec.replacements },
          'Section letters were not sequential — renumbered in-place (Bug 22)',
        );
        questionPaper = sec.text;
      }
    }

    // ── Phase 2c: Cog-level balance check (pure code, no Claude call) ──
    // If the written paper drifts from the plan's cogLevel-per-question
    // assignments by more than tolerance, fire ONE Claude rewrite. The
    // check itself is free; the rewrite only fires on a minority of
    // generations where Claude downgraded question types.
    channel.sendPhase('cog_balance', 'started');
    const balance = verifyCogBalance({ paper: questionPaper, plan, cog, cogMarks, tolerance: cogTolerance });
    if (balance.lowConfidence) {
      log.info({ unmapped: balance.unmapped.length }, 'Cog-balance check skipped (too many unmapped sub-questions)');
      channel.sendPhase('cog_balance', 'skipped');
    } else if (!balance.clean) {
      log.info({ imbalances: balance.imbalances }, `Cog-level drift detected — rewriting paper once`);
      channel.sendPhase('cog_balance', 'rewriting', { imbalances: balance.imbalances.length });
      const feedback = formatImbalances(balance);
      const planList = plan.questions.map((q) => `  ${q.number}: ${q.cogLevel} (${q.marks} marks)`).join('\n');

      const rebalanceSys = `You are rewriting a South African CAPS ${phase} Phase ${resourceType} question paper in ${language} because its cognitive-level distribution drifted from the validated plan.

RULES — non-negotiable:
- Keep every sub-question's numbering (1.1, 1.2, 2.1, …) unchanged.
- Keep every sub-question's mark value (X) unchanged.
- Change ONLY the question text / type / complexity so each sub-question lands at the cognitive level the plan requires.
- Higher cognitive levels (Complex Procedures, Problem Solving, Evaluation, High Order) MUST use genuinely multi-step / analytical / problem-solving question types — NOT recall or simple routine questions.
- Preserve every [N] block total and the final TOTAL line.
- NO cover page, NO cognitive level labels in the learner paper, NO commentary.
Output the complete corrected paper only.`;

      const rebalanceUsr = `Current cognitive-level mismatch (target: within ±${cogTolerance} marks per level):
${feedback}

PLAN — each question's required cognitive level:
${planList}

CURRENT PAPER:
${questionPaper}

Rewrite the paper so each sub-question lands at its plan cogLevel.`;

      try {
        const rebalanced = cleanOutput(await callClaude(rebalanceSys, rebalanceUsr, qTok));
        const rebalancedCount = countMarks(rebalanced);
        if (rebalancedCount === markTotal || rebalancedCount === totalMarks) {
          const newBalance = verifyCogBalance({ paper: rebalanced, plan, cog, cogMarks, tolerance: cogTolerance });
          questionPaper = rebalanced;
          markTotal = rebalancedCount;
          log.info(
            { clean: newBalance.clean, imbalances: newBalance.imbalances },
            newBalance.clean ? 'Cog-level rebalance successful' : 'Cog-level rebalance still drifted — accepting',
          );
          channel.sendPhase('cog_balance', newBalance.clean ? 'done' : 'still_drifted');
        } else {
          log.info(`Cog-level rebalance changed mark total (${rebalancedCount} vs ${markTotal}) — keeping original paper`);
          channel.sendPhase('cog_balance', 'kept_original');
        }
      } catch (err) {
        log.info(`Cog-level rebalance failed: ${err.message}`);
        channel.sendPhase('cog_balance', 'failed');
      }
    } else {
      log.info(`Cog-level balance: clean ✓`);
      channel.sendPhase('cog_balance', 'clean');
    }

    // ── Phase 2b: Question Quality Check ──
    // Tool-use guarantees a { clean, flaws[] } object — no JSON salvage.
    const qQualitySys = `You are a South African CAPS examiner reviewing a question paper for design flaws.
Check for:
1. ORDERING_EQUAL_VALUES — ordering question where two or more values are mathematically equal
2. MCQ_MULTIPLE_CORRECT — MCQ where more than one option is correct
3. MCQ_NO_CORRECT — MCQ where no option is correct
4. DATA_AMBIGUOUS — data set where multiple modes exist but question says "the mode"
5. QUESTION_IMPOSSIBLE — question that cannot be answered with information given
6. WRONG_TERM_TOPIC — question on a topic NOT in this list: ${atpTopics.slice(0,8).join('; ')}

Call the flag_question_paper_issues tool with clean=true and an empty flaws array if you find no issues.`;

    const qQualityUsr = `Review this Grade ${g} ${subject} Term ${t} question paper for design flaws:\n\n${questionPaper}`;

    channel.sendPhase('quality_check', 'started');
    try {
      let qualityResult;
      try {
        qualityResult = await callAnthropicTool({
          system: qQualitySys,
          user: qQualityUsr,
          tool: qualityTool,
          maxTokens: 1200,
          // Haiku 4.5 — picks from a fixed flaw-type enum, no creative writing.
          model: TOOL_MODEL,
          phase: 'quality',
          logger: log,
          signal,
        });
      } catch (toolErr) {
        log.info(`Phase 2b: tool call failed (${toolErr.message}) — skipping`);
        qualityResult = { flaws: [], clean: true };
      }

      if (qualityResult.flaws && qualityResult.flaws.length > 0) {
        log.info(`Phase 2b: ${qualityResult.flaws.length} flaw(s) detected`);
        qualityResult.flaws.forEach(f => log.info(`  Q${f.question} [${f.type}]: ${f.detail}`));
        channel.sendPhase('quality_check', 'fixing', { flaws: qualityResult.flaws.length });
        const fixSys = `You are correcting specific design flaws in a ${subject} question paper.
OUTPUT RULES:
- Output the complete corrected question paper ONLY
- Start IMMEDIATELY with the first line of the paper (e.g. "SECTION A" or "Question 1")
- Do NOT write any explanation, reasoning, preamble, or notes before or after
- Do NOT wrap in JSON — output raw paper text directly
- Rewrite ONLY the flagged questions — leave everything else character-for-character identical
- Preserve every (X) mark value exactly`;
        const flawList = qualityResult.flaws.map(f => `Q${f.question}: [${f.type}] ${f.detail} — Fix: ${f.fix}`).join('\n');
        const fixUsr = `Fix ONLY these flaws. Output complete corrected paper with NO preamble.\n\nFLAWS:\n${flawList}\n\nPAPER:\n${questionPaper}`;
        try {
          const rawFixed = await callClaude(fixSys, fixUsr, qTok);
          const fixedPaper = cleanOutput(safeExtractContent(rawFixed));
          const fixedCount = countMarks(fixedPaper);
          if (fixedCount === markTotal) {
            questionPaper = fixedPaper;
            log.info(`Phase 2b: fixed ✓`);
            channel.sendPhase('quality_check', 'done');
          } else {
            log.info(`Phase 2b: fix shifted mark total (${fixedCount}≠${markTotal}) — keeping original`);
            channel.sendPhase('quality_check', 'kept_original');
          }
        } catch (fixErr) {
          log.info(`Phase 2b: fix failed (${fixErr.message})`);
          channel.sendPhase('quality_check', 'failed');
        }
      } else {
        log.info(`Phase 2b: no design flaws ✓`);
        channel.sendPhase('quality_check', 'clean');
      }
    } catch (qErr) {
      log.info(`Phase 2b: quality check skipped (${qErr.message})`);
      channel.sendPhase('quality_check', 'skipped');
    }

    // ── Phase 3A: Generate memo table ──
    channel.sendPhase('memo_table', 'started');
    const cogLevelRef = plan.questions.map(q => `${q.number} (${q.marks} marks) → ${q.cogLevel}`).join('\n');
    const memoTableRaw = cleanOutput(await callClaude(mSys, mUsrA(questionPaper, markTotal, cogLevelRef), 8192));
    const phase3aStructure = validateMemoStructure(memoTableRaw);
    log.info({ len: memoTableRaw.length, hasAnswerTable: phase3aStructure.answerTable }, 'Phase 3A: memo table generated');
    if (!phase3aStructure.answerTable) {
      // Fires when Claude returned prose or a cog-only fragment instead of
      // the NO. | ANSWER table. Phase 4 will try to correct but without the
      // anchor table it usually can't. Logged loud so we can investigate.
      log.warn({ preview: memoTableRaw.slice(0, 300) }, 'Phase 3A: memo table is missing the NO. | ANSWER header — downstream memo will likely be incomplete');
    }
    // Bug 11 detector: when the memo's answer rows over-count the paper
    // (e.g. the Paper 10 case where each "8.1 (2)" parent was duplicated
    // as two "8.1(a) (2) + 8.1(b) (2)" sub-rows of 2 marks each — total
    // 4 instead of 2), the Phase 3C cog reconciliation will compute
    // wrong "Actual Marks" values too. Surface this with a clear log
    // entry so we know which sample triggered it.
    {
      const rows = parseMemoAnswerRows(memoTableRaw);
      const memoSum = rows.reduce((a, r) => a + r.mark, 0);
      if (rows.length > 0 && memoSum !== markTotal) {
        log.warn(
          { memoRowCount: rows.length, memoSum, paperTotal: markTotal, drift: memoSum - markTotal },
          'Phase 3A: memo answer-row marks do NOT sum to the paper total — likely Bug 11 (sub-part over-counting)',
        );
      }
    }
    channel.sendPhase('memo_table', 'done');

    // ── Phase 3B: Generate cog analysis + extension + rubric ──
    channel.sendPhase('memo_analysis', 'started');
    let memoAnalysisRaw = cleanOutput(await callClaude(mSys, mUsrB(memoTableRaw, markTotal), 8192));
    log.info(`Phase 3B: cog analysis generated (${memoAnalysisRaw.length} chars)`);

    // Phase 3B truncation guard.
    // The output should end with a complete rubric — final row of the rubric
    // table closing with a `|` and possibly trailing whitespace. If we see
    // a clear truncation (ends mid-word, no rubric closing pipe in the last
    // 200 chars, or the rubric heading appears but the last line isn't a
    // complete table row), retry once with higher max_tokens. The Life Skills
    // T4 audit caught this exact failure mode.
    if (looksTruncated(memoAnalysisRaw, includeRubric)) {
      log.warn({ tail: memoAnalysisRaw.slice(-200) }, 'Phase 3B: output looks truncated — retrying once with higher max_tokens');
      try {
        memoAnalysisRaw = cleanOutput(await callClaude(mSys, mUsrB(memoTableRaw, markTotal), 16000));
        log.info(`Phase 3B: retry generated (${memoAnalysisRaw.length} chars)`);
      } catch (retryErr) {
        log.warn({ err: retryErr?.message || retryErr }, 'Phase 3B: retry failed — keeping original output');
      }
    }
    channel.sendPhase('memo_analysis', 'done');

    // ── Phase 3C: Deterministic cog-table reconciliation (Bug 5) ──
    // The Phase 3B prompt asks Claude to FILL the Actual Marks column by
    // summing the answer table per level. In practice (Paper 7, 9, 10
    // audits) Claude regularly miscounts — a row says "Actual = 18" while
    // the bracketed-item breakdown on the same line sums to 20. The
    // verifier in Phase 4 catches some of those, but not reliably.
    //
    // This pass is pure code: it parses the answer table, sums per level,
    // and overwrites the cog analysis table's Actual Marks cells if they
    // disagree. No regression risk — `changed: false` is the no-op path.
    {
      // Run the correction on memoAnalysisRaw alone — the answer table
      // (memoTableRaw) is the source of truth for marks-per-level and is
      // never modified. We pass a synthetic combined string so the parser
      // sees both the answer rows and the cog table, but we only keep the
      // corrected analysis half.
      const joiner = '\n\n';
      const memoCombined = memoTableRaw + joiner + memoAnalysisRaw;
      const cogFix = correctCogAnalysisTable(memoCombined, {
        levels: cog.levels,
        totalMarks: markTotal,
      });
      if (cogFix.changed) {
        log.info(
          { computedByLevel: cogFix.computedByLevel, totalCounted: cogFix.totalCounted },
          'Phase 3C: cog-table Actual Marks reconciled against answer-table sums (Bug 5)',
        );
        // memoTableRaw is a prefix of cogFix.text by construction (the
        // correction only touches cog-table rows, which sit inside the
        // memoAnalysisRaw half). Slice off that prefix to recover the
        // corrected analysis text.
        if (cogFix.text.startsWith(memoTableRaw + joiner)) {
          memoAnalysisRaw = cogFix.text.slice((memoTableRaw + joiner).length);
        }
      }
    }

    const memoContent = memoTableRaw + '\n\n' + memoAnalysisRaw;

    // ── Phase 4: Memo Verification + Auto-Correction ──
    // Tool-use guarantees a { clean, errors[], cogLevelErrors[] } object.
    const verSys = `You are a senior South African CAPS examiner performing a final accuracy check on a memorandum.

Check EVERY row of the memorandum table for the following error types:

1. ARITHMETIC — recalculate the answer from scratch. Flag any mismatch.
2. PROFIT_LOSS — income > cost = PROFIT; cost > income = LOSS. Flag wrong label or amount.
3. COUNT — for stem-and-leaf or data set "how many" questions: count every leaf. Flag mismatches.
4. ROUNDING — check rounded value matches marking guidance. Flag if answer uses different value.
5. ANSWER_GUIDANCE_CONTRADICTION — for each row, compare the ANSWER cell with the
   MARKING GUIDANCE cell of the SAME row. If the guidance computes a result that
   contradicts the answer text, flag it. (Example: ANSWER says "Thandi is incorrect"
   but the guidance shows working that proves Thandi correct.)
   Pay particular attention to division: if the ANSWER cell states a remainder
   (e.g. "1 939 res 20", "rem 5", "remainder 3"), verify the remainder value
   against the working in MARKING GUIDANCE. If the guidance shows the division
   is exact (no remainder, or a different remainder), flag as ANSWER_GUIDANCE_CONTRADICTION.
   (Example: ANSWER says "1 939 res 20" but guidance shows 44 × 1 939 = 85 316 ✓
   with no remainder — the "res 20" is wrong.)

Then check the COGNITIVE LEVEL ANALYSIS section for THREE distinct kinds of issue:

6. TABLE_ANALYSIS_MISMATCH — sum MARK values per cognitive level across the answer
   rows. If a level's total does not equal the value shown in the cog analysis
   TABLE, flag it.
7. COG_BREAKDOWN_INCOMPLETE — read the breakdown text under the cog table
   ("Knowledge (X marks): Q1.1 (1) + Q1.2 (1) + … = X marks"). Every sub-question
   that exists in the answer table MUST appear in exactly one cog level's
   breakdown. Flag any sub-question reference that is missing from all three
   (or four) breakdown lists. Use kind=COG_BREAKDOWN_INCOMPLETE and put the
   missing sub-question references in the missingItems field.
8. COG_BREAKDOWN_MATH_ERROR — for each cog level, sum the bracketed mark values
   listed in the breakdown text. If those listed items do NOT arithmetically
   sum to the total claimed at the start of that breakdown line ("(X marks):
   … = X marks"), flag it. (Example: "Middle Order (22 punte): … = 22 punte"
   but the listed items add to 20.) Use kind=COG_BREAKDOWN_MATH_ERROR.

Call the flag_memo_errors tool with clean=true and empty arrays if no errors
exist. When reporting cogLevelErrors, ALWAYS include the kind field — set it
to TABLE_ANALYSIS_MISMATCH for the legacy check (item 6 above), or
COG_BREAKDOWN_INCOMPLETE / COG_BREAKDOWN_MATH_ERROR for items 7 and 8.`;

    const verUsr = `QUESTION PAPER:\n${questionPaper}\n\nMEMORANDUM TO VERIFY:\n${memoContent}\n\nCheck every memo row. Report ALL errors.`;

    // verificationStatus tracks whether Phase 4 confirmed the memo was clean,
    // corrected errors, or skipped. Surfaced on the response so the UI can
    // render a "Verified ✓" or "Review recommended" badge.
    let verificationStatus = 'clean';
    let verifiedMemo = memoContent;
    channel.sendPhase('memo_verify', 'started');
    try {
      let verResult;
      try {
        verResult = await callAnthropicTool({
          system: verSys,
          user: verUsr,
          tool: memoVerifyTool,
          maxTokens: 3000,
          // Haiku 4.5 — compares answers against a memo, emits structured
          // error list. Mechanical check, no generation.
          model: TOOL_MODEL,
          phase: 'memo-verify',
          logger: log,
          signal,
        });
      } catch (toolErr) {
        log.info(`Phase 4: tool call failed (${toolErr.message}) — skipping`);
        verResult = { errors: [], cogLevelErrors: [], clean: true };
        verificationStatus = 'skipped';
      }

      const totalErrors = (verResult.errors || []).length + (verResult.cogLevelErrors || []).length;
      if (totalErrors > 0) {
        log.info(`Phase 4: ${totalErrors} error(s) detected`);
        (verResult.errors || []).forEach(e => log.info(`  Q${e.question} [${e.check}]: found="${e.found}" correct="${e.correct}"`));
        (verResult.cogLevelErrors || []).forEach(e => {
          // Newer responses include kind; older "TABLE_ANALYSIS_MISMATCH" path
          // omits it. Fall back gracefully so old responses still log usefully.
          const kind = e.kind || 'TABLE_ANALYSIS_MISMATCH';
          if (kind === 'COG_BREAKDOWN_INCOMPLETE') {
            log.info(`  CogLevel [${e.level}] INCOMPLETE: missing ${e.missingItems || '(unspecified)'} from breakdown`);
          } else if (kind === 'COG_BREAKDOWN_MATH_ERROR') {
            log.info(`  CogLevel [${e.level}] MATH ERROR: claimed ${e.foundInTable} but items sum to ${e.foundInAnalysis}`);
          } else {
            log.info(`  CogLevel [${e.level}] TABLE/ANALYSIS MISMATCH: table=${e.foundInTable} analysis=${e.foundInAnalysis}`);
          }
        });
        channel.sendPhase('memo_verify', 'correcting', { errors: totalErrors });

        const corrMemoSys = `You are correcting specific verified errors in a memorandum.
Fix ONLY the rows and cells listed in the error report. Do not change anything else.

STRICT OUTPUT RULES — NON-NEGOTIABLE (Bug 21 prevention):
- Your response must be a SINGLE valid JSON object and nothing else.
- Do NOT write any reasoning, planning, "Q7.x: …" notes, "The error report
  confirms…" lines, "No change needed" remarks, or restatements of the error
  report BEFORE or AFTER the JSON.
- Do NOT wrap the JSON in markdown fences (no \`\`\`json, no \`\`\`).
- The ONLY text you output is: {"content":"<complete corrected memorandum>"}.

STRUCTURAL REQUIREMENT — non-negotiable:
The corrected memorandum MUST contain BOTH sections in this exact order:
  1. The answer table: pipe-delimited rows with columns
     "NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK" covering
     every sub-question in the paper.
  2. The cognitive level analysis: a pipe-delimited table headed
     "Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual %"
     followed by a per-level breakdown paragraph.
Never omit the answer table. Never omit the cognitive analysis.
If the errors live in only one section, still return both — unchanged where
they had no errors, corrected where they did.`;
        const allErrors = [
          ...(verResult.errors || []).map(e => {
            // ANSWER_GUIDANCE_CONTRADICTION needs slightly different phrasing
            // to make clear that BOTH the answer cell and the guidance cell
            // must align — fixing the answer alone is not enough.
            if (e.check === 'ANSWER_GUIDANCE_CONTRADICTION') {
              return `Q${e.question} [ANSWER ⇄ GUIDANCE contradiction]: ANSWER cell currently says "${e.found}". The MARKING GUIDANCE in the same row computes a result that proves the correct answer is "${e.correct}". Update the ANSWER cell so it agrees with the guidance. ${e.fix}`;
            }
            return `Q${e.question} [${e.check}]: Answer should be "${e.correct}". ${e.fix}`;
          }),
          ...(verResult.cogLevelErrors || []).map(e => {
            const kind = e.kind || 'TABLE_ANALYSIS_MISMATCH';
            if (kind === 'COG_BREAKDOWN_INCOMPLETE') {
              return `Cognitive Level analysis — ${e.level}: breakdown is missing these sub-questions: ${e.missingItems || '(see report)'}. Add them to the ${e.level} breakdown line and update the line's total. ${e.fix}`;
            }
            if (kind === 'COG_BREAKDOWN_MATH_ERROR') {
              return `Cognitive Level analysis — ${e.level}: claimed total is ${e.foundInTable} but the bracketed items sum to ${e.foundInAnalysis}. Update either the items or the claimed total so they agree. Then update the cog table at the top of the analysis section to match. ${e.fix}`;
            }
            return `Cognitive Level table — ${e.level}: ${e.fix}`;
          }),
        ].join('\n');
        const corrMemoUsr = `Correct ONLY these verified errors. Do not change anything else.\n\nERRORS:\n${allErrors}\n\nMEMORANDUM:\n${memoContent}`;

        try {
          // Phase 4 correction emits the FULL memo (answer table + cog
          // analysis + extension + rubric) — easily > 8k tokens for big
          // memos. The Paper 11 leak (Bug 21) was a max_tokens truncation
          // mid-string that left the JSON envelope unclosed; bumping to 16k
          // matches the Phase 3B retry budget.
          const rawCorrected = await callClaude(corrMemoSys, corrMemoUsr, 16000);
          let correctedMemo = cleanOutput(safeExtractContent(rawCorrected));
          // Structural guard: reject fragments. A valid corrected memo must
          // contain BOTH the answer table (NO./NR. | ANSWER/ANTWOORD header)
          // AND the cognitive level analysis. Older length-only guard
          // ("> 500 chars") accepted cog-analysis-only fragments because
          // the analysis alone is usually > 500 chars, which is how the
          // answer table disappeared from generated memos.
          const structure = validateMemoStructure(correctedMemo);
          const originalStructure = validateMemoStructure(memoContent);
          const bigEnough = correctedMemo && correctedMemo.length >= Math.max(500, Math.floor(memoContent.length * 0.7));

          if (structure.complete && bigEnough) {
            // Bug 5 follow-up: re-apply the deterministic cog-table
            // reconciliation to Phase 4's corrected memo. Phase 4 asks
            // Claude to fix specific errors but Claude can introduce new
            // miscounts in the cog table while doing so. Phase 3C ran on
            // the pre-correction memo; without this second pass, the
            // post-correction cog table can ship with wrong Actual Marks.
            const post4Fix = correctCogAnalysisTable(correctedMemo, {
              levels: cog.levels,
              totalMarks: markTotal,
            });
            if (post4Fix.changed) {
              log.info(
                { computedByLevel: post4Fix.computedByLevel, totalCounted: post4Fix.totalCounted },
                'Phase 4 post: cog-table reconciled on the corrected memo (Bug 5 follow-up)',
              );
              correctedMemo = post4Fix.text;
            }
            verifiedMemo = correctedMemo;
            verificationStatus = 'corrected';
            log.info({ originalLen: memoContent.length, correctedLen: correctedMemo.length }, 'Phase 4: memo corrected ✓');
            channel.sendPhase('memo_verify', 'corrected');
          } else {
            // Tell the operator exactly why we rejected so a bad correction
            // doesn't look like a silent pass.
            log.warn(
              {
                reason: !structure.answerTable
                  ? 'missing answer table'
                  : !structure.cogAnalysis
                    ? 'missing cog analysis'
                    : 'correction shorter than 70% of original',
                structure, originalStructure,
                originalLen: memoContent.length,
                correctedLen: correctedMemo?.length || 0,
              },
              'Phase 4: correction rejected — keeping original memo',
            );
            verifiedMemo = memoContent;
            verificationStatus = 'review_recommended';
            channel.sendPhase('memo_verify', 'review_recommended');
          }
        } catch (corrErr) {
          log.info(`Phase 4: correction failed (${corrErr.message})`);
          verifiedMemo = memoContent;
          verificationStatus = 'review_recommended';
          channel.sendPhase('memo_verify', 'review_recommended');
        }
      } else {
        log.info(`Phase 4: memo verified — no errors ✓`);
        channel.sendPhase('memo_verify', 'clean');
      }
    } catch (verErr) {
      log.info(`Phase 4: verification skipped (${verErr.message})`);
      verificationStatus = 'skipped';
      channel.sendPhase('memo_verify', 'skipped');
    }

    // ── Phase 5: Safety net — inject blank answer lines the AI may have skipped ──
    const finalPaper = localiseLabels(ensureAnswerSpace(questionPaper, { language }), language);
    channel.sendPhase('docx_build', 'started');

    // ── Build DOCX ──
    let docxBase64 = null;
    const filename = (subject + '-' + resourceType + '-Grade' + g + '-Term' + t).replace(/[^a-zA-Z0-9\-]/g, '-') + '.docx';
    try {
      const doc = buildDoc(finalPaper, verifiedMemo, markTotal);
      const buffer = await Packer.toBuffer(doc);
      docxBase64 = buffer.toString('base64');
    } catch (docxErr) {
      log.error({ err: docxErr?.message || docxErr }, 'DOCX build error');
    }
    channel.sendPhase('docx_build', 'done');

    const preview = finalPaper + '\n\n' + verifiedMemo;
    const payload = { docxBase64, preview, filename, verificationStatus };
    try { cacheSet(cacheKey, payload); } catch (e) { log.warn({ err: e?.message || e }, 'Cache write failed'); }
    channel.sendResult(payload);
    return;

  } catch (err) {
    // Client-initiated aborts are not pipeline errors — they shouldn't be
    // logged at error level or surfaced as 500s.
    if (clientClosed || (err instanceof AnthropicError && err.code === 'ABORTED')) {
      log.info('Generation cancelled by client');
      return;
    }
    log.error({ err: err?.message || err, stack: err?.stack }, 'Generate error');
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    channel.sendError(Object.assign(new Error(err?.message || 'Server error'), { status }));
    return;
  }
}
