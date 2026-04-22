import { Packer } from 'docx';

import { logger as defaultLogger } from '../lib/logger.js';
import { callAnthropic, callAnthropicTool, AnthropicError } from '../lib/anthropic.js';
import { planTool, qualityTool, memoVerifyTool } from '../lib/tools.js';
import { str, int, oneOf, bool, ValidationError } from '../lib/validate.js';
import { getCogLevels, largestRemainder, isBarretts as isBarrettsFn } from '../lib/cognitive.js';
import { countMarks } from '../lib/marks.js';
import { ensureAnswerSpace } from '../lib/answer-space.js';
import { ATP, EXAM_SCOPE, getATPTopics } from '../lib/atp.js';
import { extractContent } from '../lib/content.js';
import { i18n } from '../lib/i18n.js';
import { cleanOutput } from '../lib/clean-output.js';
import { validatePlan, planContext, LOW_DEMAND_TYPES } from '../lib/plan.js';
import { createDocxBuilder } from '../lib/docx-builder.js';
import { buildPrompts } from '../lib/prompts.js';

// ============================================================
// MAIN HANDLER
// ============================================================
export default async function handler(req, res) {
  const log = req.log || defaultLogger;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let subject, topic, resourceType, language, duration, difficulty, includeRubric, grade, term;
  try {
    subject      = str(req.body?.subject,      { field: 'subject',      max: 200 });
    topic        = str(req.body?.topic,        { field: 'topic',        required: false, max: 500 });
    resourceType = str(req.body?.resourceType, { field: 'resourceType', max: 50 });
    language     = str(req.body?.language,     { field: 'language',     max: 40 });
    duration     = int(req.body?.duration,     { field: 'duration',     required: false, min: 10, max: 200 }) || 50;
    difficulty   = oneOf(req.body?.difficulty || 'on', ['below', 'on', 'above'], { field: 'difficulty' });
    includeRubric = bool(req.body?.includeRubric);
    grade        = int(req.body?.grade, { field: 'grade', min: 4, max: 7 });
    term         = int(req.body?.term,  { field: 'term',  min: 1, max: 4 });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
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
      raw = await callAnthropic({ system, user, maxTokens: maxTok, logger: log });
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
    atpTopicList, topicInstruction,
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

    let passage = '';
    try {
      passage = await callClaude(passageSys, passageUsr, 1200);
      passage = passage.replace(/^```.*\n?/, '').replace(/```$/, '').trim();
    } catch(e) { passage = ''; }

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
- Mark allocation: content marks + language/structure marks
- End with: [${sm.c}]
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
    const [secARaw, secBRaw, secCRaw, secDRaw] = await Promise.all([
      callClaude(secASys, secAUsr, 3000),
      callClaude(secBSys, secBUsr, 2000),
      callClaude(secCSys, secCUsr, 1000),
      callClaude(secDSys, secDUsr, 2500)
    ]);

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

    const rttMemoUsrA = `${secLabel[0]} QUESTIONS (${sm.a} marks):
${secA}

Write the memo for ${secLabel[0]} ONLY:
1. Answer table with columns: ${L.memo.no} | ${L.memo.answer} | ${L.memo.guidance} | ${L.memo.cogLevel} | ${L.memo.mark}
   - List every sub-question (1.1, 1.2 … etc)
   - COGNITIVE LEVEL must be one of: Literal | Reorganisation | Inferential | Evaluation and Appreciation
   - Use the MARK shown in brackets on each question line
2. After the table, write a Barrett's Taxonomy summary for ${secLabel[0]} ONLY:
   | Barrett's Level | Questions | Marks Allocated | Marks as % of Section |
   All rows must sum to exactly ${sm.a} marks. Target: Literal 20%, Reorganisation 20%, Inferential 40%, Evaluation 20%.
3. End with: ${secLabel[0]} ${L.totalLabel}: ${sm.a} ${L.marksWord}

Return JSON: {"content":"Section A memo"}`;

    // ── RTT Memo Phase 2: Section B (Visual Text) + Section C (Summary) answers + Barrett's ──
    const rttMemoUsrB = `${secLabel[1]} QUESTIONS (${sm.b} marks):
${secB}

${secLabel[2]} QUESTION (${sm.c} marks):
${secC}

Write the memo for ${secLabel[1]} AND ${secLabel[2]}:

PART 1 — ${secLabel[1]} answer table: ${L.memo.no} | ${L.memo.answer} | ${L.memo.guidance} | ${L.memo.cogLevel} | ${L.memo.mark}
List every sub-question (2.1, 2.2 … etc). Use Literal/Reorganisation/Inferential/Evaluation and Appreciation.
Then write Barrett's Taxonomy summary for ${secLabel[1]} ONLY (must sum to ${sm.b} marks).
End with: ${secLabel[1]} ${L.totalLabel}: ${sm.b} ${L.marksWord}

PART 2 — ${secLabel[2]} answer table: ${L.memo.no} | ${L.memo.answer} | ${L.memo.guidance} | ${L.memo.cogLevel} | ${L.memo.mark}
This section is a summary task. Award marks for: content points included (award per bullet point met) + language/structure.
Cognitive level for summary = Reorganisation.
Then write Barrett's Taxonomy summary for ${secLabel[2]} ONLY (must sum to ${sm.c} marks — all Reorganisation).
End with: ${secLabel[2]} ${L.totalLabel}: ${sm.c} ${L.marksWord}

Return JSON: {"content":"Section B and C memo"}`;

    // ── RTT Memo Phase 3: Section D (Language) answers + Barrett's + combined paper table ──
    const rttMemoUsrD = `${secLabel[3]} QUESTIONS (${sm.d} marks):
${secD}

Write the memo for ${secLabel[3]}:
1. Answer table: ${L.memo.no} | ${L.memo.answer} | ${L.memo.guidance} | ${L.memo.cogLevel} | ${L.memo.mark}
   List every sub-question (4.1, 4.2 … etc). Use Literal/Reorganisation/Inferential/Evaluation and Appreciation.
2. Barrett's Taxonomy summary for ${secLabel[3]} ONLY (must sum to ${sm.d} marks).
3. End with: ${secLabel[3]} ${L.totalLabel}: ${sm.d} ${L.marksWord}

Then write the COMBINED PAPER BARRETT'S ANALYSIS:
Heading: COMBINED BARRETT'S TAXONOMY ANALYSIS — FULL PAPER (${totalMarks} marks)
Write this pipe table:
| Barrett's Level | Prescribed % | Prescribed Marks | Actual Marks | Actual % |
| Literal | 20% | ${largestRemainder(totalMarks,[20,20,40,20])[0]} | [sum from all sections] | [%] |
| Reorganisation | 20% | ${largestRemainder(totalMarks,[20,20,40,20])[1]} | [sum from all sections] | [%] |
| Inferential | 40% | ${largestRemainder(totalMarks,[20,20,40,20])[2]} | [sum from all sections] | [%] |
| Evaluation and Appreciation | 20% | ${largestRemainder(totalMarks,[20,20,40,20])[3]} | [sum from all sections] | [%] |
| TOTAL | 100% | ${totalMarks} | [must equal ${totalMarks}] | 100% |

Actual Marks per level = sum across ALL four sections. All Actual Marks must total exactly ${totalMarks}.

Return JSON: {"content":"Section D memo and combined Barrett's"}`;

    log.info(`RTT Memo: generating in 3 phases (A / B+C / D+combined)`);
    const [memoARaw, memoBCRaw, memoDRaw] = await Promise.all([
      callClaude(rttMemoSys, rttMemoUsrA, 4000),
      callClaude(rttMemoSys, rttMemoUsrB, 4000),
      callClaude(rttMemoSys, rttMemoUsrD, 4000)
    ]);

    const memoA  = cleanOutput(safeExtractContent(memoARaw));
    const memoBC = cleanOutput(safeExtractContent(memoBCRaw));
    const memoD  = cleanOutput(safeExtractContent(memoDRaw));

    const memoContent = [
      'MEMORANDUM',
      '',
      `Grade ${g} ${subject} — Response to Text — Term ${t}`,
      `CAPS Aligned | Barrett\'s Taxonomy Framework`,
      '',
      memoA,
      '',
      memoBC,
      '',
      memoD
    ].join('\n');

    log.info(`RTT Memo: complete (${memoContent.length} chars — A:${memoARaw.length} BC:${memoBCRaw.length} D:${memoDRaw.length})`);

    const markTotal = totalMarks; // RTT papers use fixed mark total

    // Safety net: inject blank answer lines where the AI forgot them.
    const finalPaper = ensureAnswerSpace(questionPaper);

    // Build DOCX
    let docxBase64 = null;
    const filename = (subject + '-ResponseToText-Grade' + g + '-Term' + t).replace(/[^a-zA-Z0-9\-]/g, '-') + '.docx';
    try {
      const doc = buildDoc(finalPaper, memoContent, markTotal);
      const buffer = await Packer.toBuffer(doc);
      docxBase64 = buffer.toString('base64');
    } catch(docxErr) { log.error({ err: docxErr?.message || docxErr }, 'RTT DOCX build error'); }

    const preview = finalPaper + '\n\n' + memoContent;
    return res.status(200).json({ docxBase64, preview, filename });
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
    const planCtx = planContext({ totalMarks, cog, cogMarks, cogTolerance });
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
          logger: log,
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
 
    // ── Phase 2: Write questions from validated plan ──
    const qTok = isWorksheet ? 3000 : (isExamType) ? 5500 : 4500;
    let questionPaper = await callClaude(qSys(plan), qUsr(plan), qTok);
    questionPaper = cleanOutput(questionPaper);
 
    // ── Phase 2a: Mark drift correction ──
    const countedAfterP2 = countMarks(questionPaper);
    const drift = countedAfterP2 - totalMarks;
    if (countedAfterP2 > 0 && drift !== 0) {
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
        if (countedAfterCorr === totalMarks) { questionPaper = corrected; log.info(`Correction successful: ${countedAfterCorr} marks ✓`); }
        else log.info(`Correction resulted in ${countedAfterCorr} marks — keeping Phase 2 paper`);
      } catch(corrErr) { log.info(`Correction failed: ${corrErr.message}`); }
    } else if (countedAfterP2 === totalMarks) {
      log.info(`Phase 2 exact: ${countedAfterP2} marks ✓`);
    }
 
    const finalCount = countMarks(questionPaper);
    const markTotal = finalCount > 0 ? finalCount : totalMarks;
    log.info(`Final mark total: ${markTotal}`);
 
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

    try {
      let qualityResult;
      try {
        qualityResult = await callAnthropicTool({
          system: qQualitySys,
          user: qQualityUsr,
          tool: qualityTool,
          maxTokens: 1200,
          logger: log,
        });
      } catch (toolErr) {
        log.info(`Phase 2b: tool call failed (${toolErr.message}) — skipping`);
        qualityResult = { flaws: [], clean: true };
      }

      if (qualityResult.flaws && qualityResult.flaws.length > 0) {
        log.info(`Phase 2b: ${qualityResult.flaws.length} flaw(s) detected`);
        qualityResult.flaws.forEach(f => log.info(`  Q${f.question} [${f.type}]: ${f.detail}`));
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
          if (fixedCount === markTotal) { questionPaper = fixedPaper; log.info(`Phase 2b: fixed ✓`); }
          else log.info(`Phase 2b: fix shifted mark total (${fixedCount}≠${markTotal}) — keeping original`);
        } catch(fixErr) { log.info(`Phase 2b: fix failed (${fixErr.message})`); }
      } else {
        log.info(`Phase 2b: no design flaws ✓`);
      }
    } catch(qErr) { log.info(`Phase 2b: quality check skipped (${qErr.message})`); }
 
    // ── Phase 3A: Generate memo table ──
    const cogLevelRef = plan.questions.map(q => `${q.number} (${q.marks} marks) → ${q.cogLevel}`).join('\n');
    const memoTableRaw = cleanOutput(await callClaude(mSys, mUsrA(questionPaper, markTotal, cogLevelRef), 8192));
    log.info(`Phase 3A: memo table generated (${memoTableRaw.length} chars)`);
 
    // ── Phase 3B: Generate cog analysis + extension + rubric ──
    const memoAnalysisRaw = cleanOutput(await callClaude(mSys, mUsrB(memoTableRaw, markTotal), 8192));
    log.info(`Phase 3B: cog analysis generated (${memoAnalysisRaw.length} chars)`);
 
    const memoContent = memoTableRaw + '\n\n' + memoAnalysisRaw;
 
    // ── Phase 4: Memo Verification + Auto-Correction ──
    // Tool-use guarantees a { clean, errors[], cogLevelErrors[] } object.
    const verSys = `You are a senior South African CAPS examiner performing a final accuracy check on a memorandum.
Check EVERY row of the memorandum table:
1. ARITHMETIC — recalculate the answer from scratch. Flag any mismatch.
2. PROFIT_LOSS — income > cost = PROFIT; cost > income = LOSS. Flag wrong label or amount.
3. COUNT — for stem-and-leaf or data set "how many" questions: count every leaf. Flag mismatches.
4. ROUNDING — check rounded value matches marking guidance. Flag if answer uses different value.
5. COG_LEVEL_TOTAL — add up MARK values per cognitive level. Compare to the analysis table. Flag mismatches.

Call the flag_memo_errors tool with clean=true and empty arrays if no errors exist.`;

    const verUsr = `QUESTION PAPER:\n${questionPaper}\n\nMEMORANDUM TO VERIFY:\n${memoContent}\n\nCheck every memo row. Report ALL errors.`;

    let verifiedMemo = memoContent;
    try {
      let verResult;
      try {
        verResult = await callAnthropicTool({
          system: verSys,
          user: verUsr,
          tool: memoVerifyTool,
          maxTokens: 3000,
          logger: log,
        });
      } catch (toolErr) {
        log.info(`Phase 4: tool call failed (${toolErr.message}) — skipping`);
        verResult = { errors: [], cogLevelErrors: [], clean: true };
      }
 
      const totalErrors = (verResult.errors || []).length + (verResult.cogLevelErrors || []).length;
      if (totalErrors > 0) {
        log.info(`Phase 4: ${totalErrors} error(s) detected`);
        (verResult.errors || []).forEach(e => log.info(`  Q${e.question} [${e.check}]: found="${e.found}" correct="${e.correct}"`));
        (verResult.cogLevelErrors || []).forEach(e => log.info(`  CogLevel [${e.level}]: table=${e.foundInTable} analysis=${e.foundInAnalysis}`));
 
        const corrMemoSys = `You are correcting specific verified errors in a memorandum.
Fix ONLY the rows and cells listed in the error report. Do not change anything else.
Return the complete corrected memorandum as JSON: {"content":"complete corrected memorandum"}`;
        const allErrors = [
          ...(verResult.errors || []).map(e => `Q${e.question} [${e.check}]: Answer should be "${e.correct}". ${e.fix}`),
          ...(verResult.cogLevelErrors || []).map(e => `Cognitive Level table — ${e.level}: ${e.fix}`)
        ].join('\n');
        const corrMemoUsr = `Correct ONLY these verified errors. Do not change anything else.\n\nERRORS:\n${allErrors}\n\nMEMORANDUM:\n${memoContent}`;
 
        try {
          const rawCorrected = await callClaude(corrMemoSys, corrMemoUsr, 8192);
          const correctedMemo = cleanOutput(safeExtractContent(rawCorrected));
          if (correctedMemo && correctedMemo.length > 500) { verifiedMemo = correctedMemo; log.info(`Phase 4: memo corrected ✓`); }
          else { log.info(`Phase 4: correction too short — keeping original`); verifiedMemo = memoContent; }
        } catch(corrErr) { log.info(`Phase 4: correction failed (${corrErr.message})`); verifiedMemo = memoContent; }
      } else {
        log.info(`Phase 4: memo verified — no errors ✓`);
      }
    } catch(verErr) { log.info(`Phase 4: verification skipped (${verErr.message})`); }

    // ── Phase 5: Safety net — inject blank answer lines the AI may have skipped ──
    const finalPaper = ensureAnswerSpace(questionPaper);

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

    const preview = finalPaper + '\n\n' + verifiedMemo;
    return res.status(200).json({ docxBase64, preview, filename });
 
  } catch (err) {
    log.error({ err: err?.message || err, stack: err?.stack }, 'Generate error');
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({ error: err?.message || 'Server error' });
  }
}
