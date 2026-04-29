// Schema-first generation pipeline.
//
// One Claude tool call (Sonnet 4.6, forced tool use). The tool's
// input_schema is the per-request narrowed Resource schema in
// schema/resource.schema.js. Sonnet returns a single structured object;
// we unwrap stringified branches, rebalance leaf marks to the prescribed
// totals, run assertResource for structural validity, then render the
// DOCX from the validated Resource. No markdown, no regex repair, no
// post-hoc cog-table reconstruction.

import { Packer } from 'docx';

import { callAnthropicTool } from '../lib/anthropic.js';
import { getCogLevels, isBarretts, marksToTime, largestRemainder } from '../lib/cognitive.js';
import { ATP, EXAM_SCOPE } from '../lib/atp.js';
import { resourceTypeLabel, subjectDisplayName, localiseDuration } from '../lib/i18n.js';
import { narrowSchemaForRequest, assertResource, tallyCogLevels } from '../schema/resource.schema.js';
import { rebalanceMarks } from '../lib/rebalance.js';
import { renderResource } from '../lib/render.js';
import { createEventChannel } from '../lib/sse.js';
import { str, int, oneOf, bool, ValidationError } from '../lib/validate.js';
import { cacheGet, cacheSet } from '../lib/cache.js';
import { logger as defaultLogger } from '../lib/logger.js';

const SONNET_4_6 = 'claude-sonnet-4-6';

/**
 * Build the topic scope (terms covered + ATP topics) for a request.
 * - Worksheet/Test       → [t]              term-only content
 * - Exam (T2, T4)        → EXAM_SCOPE[t]    cross-term per CAPS
 * - Exam (T1, T3)        → [t]              single-term exams
 * - Final Exam           → [1,2,3,4]        full year
 */
function topicScopeFor(subject, grade, term, resourceType) {
  let coversTerms;
  if (resourceType === 'Final Exam') coversTerms = [1, 2, 3, 4];
  else if (resourceType === 'Exam') coversTerms = EXAM_SCOPE[term] || [term];
  else coversTerms = [term];

  const topics = coversTerms.flatMap((t) => ATP[subject]?.[grade]?.[t] || []);
  // De-dup while preserving order — different terms occasionally repeat a topic.
  const seen = new Set();
  const unique = [];
  for (const t of topics) {
    if (seen.has(t)) continue;
    seen.add(t);
    unique.push(t);
  }
  return { coversTerms, topics: unique };
}

/**
 * Build the per-request context object the spike needs:
 * cognitive framework, prescribed marks, topic scope, derived labels.
 */
function buildContext(req) {
  const { subject, grade, term, language, resourceType, totalMarks, difficulty = 'on' } = req;

  const cog = getCogLevels(subject);
  const frameworkName = isBarretts(cog) ? "Barrett's" : "Bloom's";
  const prescribedMarks = largestRemainder(totalMarks, cog.pcts);
  const cogLevels = cog.levels.map((name, i) => ({
    name,
    percent: cog.pcts[i],
    prescribedMarks: prescribedMarks[i],
  }));

  const { coversTerms, topics } = topicScopeFor(subject, grade, term, resourceType);
  if (topics.length === 0) {
    throw new Error(`No ATP topics for subject="${subject}" grade=${grade} term=${term}`);
  }

  const durationMin = parseDurationMinutes(marksToTime(totalMarks));
  const localisedDurationLabel = localiseDuration(marksToTime(totalMarks), language);
  const subjectDisplay = subjectDisplayName(subject, language);
  const localResourceLabel = resourceTypeLabel(resourceType, language);

  return {
    subject, grade, term, language, resourceType, totalMarks, difficulty,
    frameworkName, cogLevels,
    cognitiveLevelNames: cogLevels.map((l) => l.name),
    coversTerms, topics,
    durationMin, localisedDurationLabel, subjectDisplay, localResourceLabel,
  };
}

function parseDurationMinutes(label) {
  // marksToTime returns strings like "45 minutes", "1 hour", "1 hour 30 minutes".
  let mins = 0;
  const hoursMatch = label.match(/(\d+)\s*hour/);
  const minsMatch = label.match(/(\d+)\s*minute/);
  if (hoursMatch) mins += parseInt(hoursMatch[1], 10) * 60;
  if (minsMatch) mins += parseInt(minsMatch[1], 10);
  return mins || 60;
}

function buildSystemPrompt(ctx) {
  const {
    subject, grade, term, language, resourceType, totalMarks, difficulty,
    frameworkName, cogLevels, coversTerms, topics,
    durationMin, localisedDurationLabel, subjectDisplay, localResourceLabel,
  } = ctx;

  const cogTable = cogLevels
    .map((l) => `  - ${l.name}: ${l.percent}% = ${l.prescribedMarks} marks`)
    .join('\n');
  const topicList = topics.map((t) => `  - ${t}`).join('\n');
  const isRTT = subject.includes('Home Language') || subject.includes('First Additional')
    || subject.includes('Huistaal') || subject.includes('Addisionele') || subject.includes('Eerste');
  const isExamType = resourceType === 'Exam' || resourceType === 'Final Exam';
  const isGeography = subject.includes('Geography') || subject.includes('Geografie');
  const isHistory  = subject.includes('History')   || subject.includes('Geskiedenis');
  const isAfrikaansHL = subject === 'Afrikaans Home Language';
  const isIntermediatePhase = grade >= 4 && grade <= 6;

  const subjectGuidance = buildSubjectGuidance({
    isRTT, isExamType, isGeography, isHistory, isAfrikaansHL, isIntermediatePhase, grade,
  });

  return [
    `You are a CAPS-aligned exam-paper author for South African Grades 4–7.`,
    `Your job is to call the build_resource tool with a complete, structurally-valid Resource for the requested paper.`,
    ``,
    `## Request`,
    `- Subject:        ${subject} (display in ${language}: ${subjectDisplay})`,
    `- Grade:          ${grade}`,
    `- Term:           ${term}`,
    `- Resource type:  ${resourceType} (label "${localResourceLabel}")`,
    `- Language:       ${language}`,
    `- Total marks:    ${totalMarks}`,
    `- Duration:       ${durationMin} minutes (display "${localisedDurationLabel}")`,
    `- Difficulty:     ${difficulty} grade level`,
    ``,
    `## CAPS topic scope`,
    `This paper covers term${coversTerms.length > 1 ? 's' : ''} ${coversTerms.join(', ')} content.`,
    `Every question.topic MUST be one of these ATP topics:`,
    topicList,
    ``,
    `## Cognitive framework: ${frameworkName}`,
    `Your meta.cognitiveFramework MUST list these levels with these percentages and prescribed marks:`,
    cogTable,
    `Every leaf question's cognitiveLevel MUST be one of: ${cogLevels.map((l) => l.name).join(', ')}.`,
    `The actual mark distribution across cognitive levels should match the prescribed marks within ±${Math.max(1, Math.round(totalMarks * 0.02))} marks per level.`,
    ``,
    `## Structural rules (the schema enforces these — violations are rejected)`,
    `1. Every question is EITHER a LEAF (has marks, cognitiveLevel, answerSpace) OR a COMPOSITE (has subQuestions). Never both.`,
    `2. Composite marks are computed from leaves; do NOT put marks on composites.`,
    `3. Every leaf has exactly one matching memo.answer (matched on questionNumber). marks and cognitiveLevel must agree.`,
    `4. Sum of leaf marks across the whole paper MUST equal meta.totalMarks (${totalMarks}). Before you emit the tool call, mentally add up every leaf's marks and verify the total is exactly ${totalMarks}; if it isn't, adjust mark allocations on individual leaves until it is.`,
    `5. Stimuli are first-class. If a question references a passage/visual/data, declare it once in stimuli[] and reference it via stimulusRef.`,
    `5a. RENDERABLE DIAGRAMS. For data-handling, climate, scientific-results, and similar questions, attach a diagram stimulus with a typed \`spec\` (currently supported: bar_graph). The renderer turns the spec into a real image embedded in the paper — preferred over a verbal "[Visual text — described below]" block. Only attach a diagram when interpreting it is part of the question; do not decorate. Always include altText alongside spec for accessibility and as a fallback.`,
    `5b. DIAGRAMS MUST NOT REVEAL ANSWERS. The diagram is a stimulus the learner must INTERPRET. If the question asks "Which fruit was the most popular?", the bars must be labelled with category names (Apple, Banana) and values (so the learner reads the bars), but if the question asks "Name the part labelled A", the diagram must show only the letter A — never "A: Flower". Treat callouts as keys (A, B, C / 1, 2, 3), never as names or definitions. When in doubt: would a learner who already knew the answer get no advantage from the diagram? Then it's safe.`,
    `6. Question numbers are dotted decimals: "1", "1.1", "1.1.1".`,
    `7. memo.answer.markingGuidance is the rationale ONLY (acceptable answer variants, what working should show, common pitfalls). Do NOT write phrases like "Award N marks for X", "Maximum N marks", or "1 mark per ...". The mark column is rendered separately from the structured \`marks\` field — duplicating mark counts in the prose causes inconsistencies when totals are later adjusted.`,
    `8. Every question's \`topic\` field MUST be COPIED VERBATIM from the ATP topic list above. Do not paraphrase, abbreviate, or duplicate phrases inside it. The schema enforces an exact-string match.`,
    ``,
    `## Resource-type guidance`,
    isRTT && isExamType
      ? `- This is a Response-to-Text (RTT) ${resourceType}. Section A MUST contain a passage stimulus (kind="passage") with the full body and a wordCount. Comprehension questions in Section A MUST stimulusRef that passage. RTT papers also typically include a Section B (summary, ~5 marks) referencing the same passage, and a Section C (language structures + visual text). The visual text in Section C is a separate stimulus (kind="visualText" with a verbal description, since we cannot generate images).`
      : isRTT
      ? `- This is a language ${resourceType}. Use stimuli where appropriate (passages for comprehension, visual texts for visual-literacy items).`
      : resourceType === 'Worksheet'
      ? `- A Worksheet is a single-section practice instrument; one section with letter=null is fine. Aim for short, focused items. ${totalMarks} marks total.`
      : resourceType === 'Test'
      ? `- A Test typically has 2–4 sections progressing from MCQ/short answer to extended response. ${totalMarks} marks total.`
      : `- An ${resourceType} typically has 3–5 sections progressing from short answer to extended response, with the harder cognitive levels concentrated in later sections. ${totalMarks} marks total.`,
    ``,
    ...(subjectGuidance ? [subjectGuidance, ''] : []),
    `## Language and labels`,
    `- All learner-facing strings (cover, section titles, instructions, question stems, memo answers) MUST be written in ${language}.`,
    `- Cover: resourceTypeLabel="${localResourceLabel}", subjectLine="${subjectDisplay}", gradeLine="${language === 'Afrikaans' ? `Graad ${grade}` : `Grade ${grade}`}", termLine="${language === 'Afrikaans' ? `Kwartaal ${term}` : `Term ${term}`}".`,
    `- learnerInfoFields MUST include all of these in this order: name, surname, date, examiner, time, total. For Worksheets you MAY omit examiner and time. For non-Worksheet resources include all six. Use bare labels (e.g. "Time", "Total") — the renderer adds the value.`,
    `- Section titles should be in ${language}, upper-cased.`,
    ``,
    `## Output`,
    `Call build_resource with the Resource object. Do not output anything else.`,
  ].join('\n');
}

// Subject-specific cognitive guidance blocks. These are appended to the
// system prompt only when the relevant subject/grade combination has a
// known drift pattern, so we don't bloat the prompts for subjects that
// already produce balanced cog distributions (Maths, NST, Tech, EMS).
//
// Patterns confirmed across a 26-paper / 4-grade live sweep:
//   • RTT (HL languages): all 8 papers over-supplied Literal+Reorg and
//     under-supplied Inferential. Stem-pattern catalog by level fixes this.
//   • Geography Intermediate Phase: 3/3 papers severely over-supplied
//     Low Order. Explicit cap on identification questions fixes this.
//   • History Intermediate Phase: 3/3 under-supplied Middle Order. Stem
//     patterns for Middle Order ("explain why", "compare", "describe
//     consequences") fix this. (Grade 7 already lands clean — skipped.)
function buildSubjectGuidance({ isRTT, isExamType, isGeography, isHistory, isAfrikaansHL, isIntermediatePhase, grade }) {
  const blocks = [];

  if (isRTT && isExamType) {
    blocks.push([
      `## Cognitive-level stem patterns (RTT comprehension)`,
      `RTT papers commonly over-supply Literal/Reorganisation and under-supply Inferential/Evaluation. To prevent this, draft each comprehension question using a stem that matches its cognitive level:`,
      `  - Literal: "What does the passage say about ___?", "Find the word/phrase that means ___.", "Where/when does ___?", "Quote the line that ___."`,
      `  - Reorganisation: "Summarise ___ in your own words.", "List THREE/FOUR ___.", "Explain in your own words what is meant by ___."`,
      `  - Inferential: "Why do you think ___?", "What does the writer suggest by ___?", "How would the character feel about ___? Explain.", "What can you infer about ___ from ___?"`,
      `  - Evaluation and Appreciation: "Do you agree with ___? Justify with evidence from the passage.", "Is the title suitable? Why?", "How effective is the writer's use of ___?", "Would you recommend ___? Give reasons."`,
      ``,
      `Before emitting the tool call: count your comprehension stems by cognitive level and confirm they match the prescribed marks. If Inferential or Evaluation is under-supplied, REPLACE Literal/Reorganisation questions with Inferential/Evaluation ones — do not just add more questions.`,
      ``,
      `HARD RULE — Reorganisation cap: Reorganisation marks MUST NOT exceed the prescribed allocation by more than 1. Live testing shows the most common drift is over-supplying Reorganisation at the cost of Inferential. If your draft puts Reorganisation above prescribed, your FIRST corrective action is to convert Reorganisation questions into Inferential ones (e.g. "List three reasons" → "Why do you think the writer included these three reasons?"), not to add more questions or shrink existing ones.`,
    ].join('\n'));
  }

  if (isGeography && isIntermediatePhase) {
    blocks.push([
      `## Geography-specific cognitive guidance (Intermediate Phase)`,
      `Geography assessment at this phase is frequently mis-pitched as memorisation. Direct identification of features (naming capitals, defining terms, recognising map symbols) MUST NOT exceed 30% of total marks. The remaining ~70% must require:`,
      `  - Map interpretation: using a legend, calculating distance/direction, comparing regions on a map.`,
      `  - Real-world application: predicting consequences of geographic phenomena, explaining cause-effect chains.`,
      `  - Analysis: why X occurs here but not there, what does Y data pattern suggest.`,
      ``,
      `Stem patterns by cognitive level:`,
      `  - Low Order: "Name the capital of ___.", "Identify the symbol for ___.", "Define ___."`,
      `  - Middle Order: "Explain why ___ is found in ___.", "Compare ___ and ___.", "Use the map/legend to ___.", "Describe the relationship between ___ and ___."`,
      `  - High Order: "Predict what would happen if ___.", "Evaluate the impact of ___ on ___.", "Justify whether ___ is a good location for ___."`,
      ``,
      `MIDDLE ORDER QUOTA: Middle Order is the largest prescribed band (typically ~50% of marks at this phase) and is the most under-supplied in practice. Aim for AT LEAST one Middle Order question in EVERY section, and ensure Middle Order question types include each of: (a) at least one map/diagram interpretation question that requires using the legend, scale, or compass, (b) at least one cause-effect explanation, and (c) at least one comparison or contrast question. Drafts that satisfy the Low Order quota but skip these specific Middle Order types will under-supply Middle Order.`,
    ].join('\n'));
  }

  if (isHistory && isIntermediatePhase) {
    blocks.push([
      `## History-specific cognitive guidance (Intermediate Phase)`,
      `History papers at this phase commonly under-supply Middle Order. To balance the paper, ensure Middle Order content uses these stem patterns:`,
      `  - Low Order: names, dates, definitions, "list three ___".`,
      `  - Middle Order: "Explain why ___ happened.", "Describe the consequences of ___.", "Compare ___ and ___.", "Outline the steps that led to ___.", "What was the impact of ___?"`,
      `  - High Order: "Evaluate ___.", "Was ___ justified? Argue both sides.", "How did ___ change ___?"`,
      ``,
      `SINGLE-MARK CAP: do NOT produce more than FOUR 1-mark questions in any single section. If you find yourself writing five or more single-mark recall items in one section, consolidate two of them into a single 2-mark Middle Order "Explain why ___" question of equivalent topic. This prevents the paper from being floor-loaded with Low Order recall and leaves room for Middle Order content the cog framework requires.`,
    ].join('\n'));
  }

  if (isAfrikaansHL && grade === 4) {
    blocks.push([
      `## Grade 4 Afrikaans Home Language — failure mode warning`,
      `Live testing found that Grade 4 Afrikaans Home Language papers default to a Reorganisation-heavy bimodal failure: roughly half the time the paper comes back with ~17 marks of Reorganisation and ~15 of Inferential against a 10/20 prescription. This is caused by a tendency to produce too many "Lys DRIE …", "Verduidelik in jou eie woorde …", and "Som op …" question stems.`,
      ``,
      `Hard rule for THIS paper: Reorganisation MUST land at exactly 10 marks (±1). Before drafting comprehension questions, allocate cog-level marks like this and do not deviate:`,
      `  - 10 marks Literal: short factual recall ("Wie …?", "Wat sê die teks oor …?", "Waar/wanneer …?", "Haal die sin aan wat …").`,
      `  - 10 marks Reorganisation: STRICT MAXIMUM. ONE summarising/listing question is enough; do NOT produce a second.`,
      `  - 20 marks Inferential: more than half the comprehension marks. Use "Hoekom dink jy …", "Wat impliseer die skrywer …", "Hoe sou die karakter voel oor …", "Wat kan jy aflei oor … uit …".`,
      `  - 10 marks Evaluation and Appreciation: one or two open evaluative questions ("Stem jy saam met …? Motiveer.", "Is die titel gepas? Hoekom?").`,
      `If your draft comes back with more than 10 Reorganisation marks, your FIRST corrective action is to convert "Lys"/"Som op" questions into "Hoekom dink jy"/"Wat impliseer" questions of equal mark value, NOT to shrink them.`,
    ].join('\n'));
  }

  return blocks.length ? blocks.join('\n\n') : null;
}

function buildUserPrompt(ctx) {
  return [
    `Generate the ${ctx.resourceType} described in the system prompt.`,
    `Set meta.schemaVersion="1.0", meta.subject="${ctx.subject}", meta.grade=${ctx.grade}, meta.term=${ctx.term}, meta.language="${ctx.language}", meta.resourceType="${ctx.resourceType}", meta.totalMarks=${ctx.totalMarks}, meta.duration.minutes=${ctx.durationMin}, meta.difficulty="${ctx.difficulty}".`,
    `meta.topicScope.coversTerms=[${ctx.coversTerms.join(',')}], meta.topicScope.topics must be exactly the ATP topic list given above.`,
    `Ensure the leaf-mark sum equals ${ctx.totalMarks} and that every leaf has a corresponding memo answer.`,
  ].join('\n');
}

/**
 * Run the spike for a single request. Returns:
 *   { resource, validation, model, usage }
 * - resource: the parsed object the model passed to build_resource (always
 *             schema-shape valid by API guarantee)
 * - validation: assertResource(resource) result
 */
export async function generate(req, opts = {}) {
  const { logger, signal, maxRetries = 2, correctiveContext } = opts;
  const ctx = buildContext(req);
  const inputSchema = narrowSchemaForRequest({
    subject: ctx.subject,
    language: ctx.language,
    resourceType: ctx.resourceType,
    cognitiveLevels: ctx.cognitiveLevelNames,
    topics: ctx.topics,
  });

  const tool = {
    name: 'build_resource',
    description: 'Emit one structured Resource object describing the entire paper (cover + stimuli + sections + memo). The harness renders DOCX and the cog-analysis table from this object — do not include those artifacts here.',
    input_schema: inputSchema,
  };

  const system = buildSystemPrompt(ctx);
  const baseUser = buildUserPrompt(ctx);

  // Optional caller-supplied corrective context — used by the moderator
  // regen loop to point Sonnet at specific issues to fix on a regeneration.
  // Distinct from the schema-validation retry below: this lands on attempt 0
  // (before schema-fail retries kick in).
  const initialUser = correctiveContext
    ? `${baseUser}\n\n${correctiveContext}`
    : baseUser;

  // Retry on schema-validation failure with corrective feedback. Sonnet's
  // residual structural failure rate (after snap + rebalance) is dominated
  // by model variance — same prompt, different attempt usually succeeds.
  // Each retry is a fresh tool call (~$0.12) and includes the prior
  // failure's error list so the model can self-correct on stable failure
  // modes (e.g. forgetting to declare a stimulus it referenced).
  let lastResult = null;
  let lastErrors = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const user = lastErrors
      ? `${baseUser}\n\nThe previous attempt failed schema validation with these errors:\n${lastErrors.slice(0, 8).map((e) => `  - ${e.path}: ${e.message}`).join('\n')}\nPlease emit a fresh, correct Resource that does not repeat these errors.`
      : initialUser;

    const raw = await callAnthropicTool({
      system,
      user,
      tool,
      model: SONNET_4_6,
      maxTokens: 16000,
      // Prompt cache the system prompt. Repeated calls for the same
      // {subject, grade, term, language, resourceType} produce identical
      // system prompts and tool schemas — within the 5-minute ephemeral
      // window the cache pays back ~90% of input cost on hits. The retry
      // attempts within a single request also self-cache (system identical
      // across attempts; only the user message differs).
      cacheSystem: true,
      logger,
      signal,
      phase: attempt === 0 ? 'generate' : `generate-retry-${attempt}`,
    });

    const resource = unwrapStringifiedBranches(raw);
    snapTopicsToCanonical(resource);
    const rebalance = rebalanceMarks(resource);
    const validation = assertResource(resource);

    lastResult = { resource, validation, rebalance, model: SONNET_4_6, ctx, attempts: attempt + 1 };

    if (validation.ok) return lastResult;

    // Validation failed. If we have retries left, log + loop with the
    // error list to give Sonnet corrective context.
    if (attempt < maxRetries) {
      logger?.warn?.(
        { attempt: attempt + 1, errorCount: validation.errors.length, sampleErrors: validation.errors.slice(0, 3) },
        'Schema validation failed; retrying with corrective feedback',
      );
      lastErrors = validation.errors;
    }
  }

  // All retries exhausted — return the last attempt with attempts count
  // so the caller can surface "we tried N times and still failed" cleanly.
  return lastResult;
}

/**
 * Sonnet 4.6 occasionally emits deeply-nested object branches as
 * JSON-encoded strings inside a tool input. Day-2 spike showed every one
 * of the six configurations returned meta/cover/memo as stringified JSON
 * while sections/stimuli came back as proper objects. The fix is mechanical:
 * if a top-level Resource property is a string and parses as an object,
 * use the parsed value. Idempotent — already-object values pass through.
 *
 * Also normalises shape edge cases caught in the live sweep:
 *   • stimuli/sections must be arrays — coerce missing/null to [] so
 *     downstream .map() calls don't crash before assertResource can
 *     surface a clean error.
 *   • Sonnet sometimes stringifies individual array items (a single
 *     stimulus object inside the stimuli array) — recurse one level in.
 */
function unwrapStringifiedBranches(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const TOP_KEYS = ['meta', 'cover', 'stimuli', 'sections', 'memo'];
  for (const k of TOP_KEYS) {
    if (typeof obj[k] === 'string') {
      try {
        const parsed = JSON.parse(obj[k]);
        if (parsed && (typeof parsed === 'object')) obj[k] = parsed;
      } catch {
        // leave as-is; assertResource will surface the type error.
      }
    }
  }

  // Array-typed branches must actually be arrays; coerce so downstream
  // .map() / .find() / .forEach() don't crash before validation runs.
  if (obj.stimuli && !Array.isArray(obj.stimuli))   obj.stimuli  = [];
  if (obj.sections && !Array.isArray(obj.sections)) obj.sections = [];

  // Recurse one level into stimuli + sections to catch stringified items.
  if (Array.isArray(obj.stimuli)) obj.stimuli = obj.stimuli.map(unwrapItem);
  if (Array.isArray(obj.sections)) obj.sections = obj.sections.map(unwrapItem);

  return obj;
}

function unwrapItem(item) {
  if (typeof item === 'string') {
    try {
      const parsed = JSON.parse(item);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* fallthrough */ }
  }
  return item;
}

/**
 * Snap each leaf question's `topic` field to the canonical ATP topic when the
 * model emits a near-miss variation.
 *
 * Anthropic's tool API does NOT strictly enforce JSON Schema string enums on
 * tool inputs — the schema narrows `topic` to the request's ATP list, but the
 * model can still emit minor drift like a duplicated phrase. The live sweep
 * caught one G5 LS-PSW paper where the model wrote
 *   "...peer pressure — effects — effects;..."
 * instead of the canonical
 *   "...peer pressure — effects;..."
 * which then failed assertResource. This salvages such cases by snapping the
 * model's drifted string back to whichever canonical ATP topic it most
 * resembles, before validation runs.
 *
 * Two-phase match (cheap before expensive):
 *   1. Collapse-duplicates pass — strip any "X — X" or "X; X" runs of
 *      identical adjacent tokens. Catches the live-observed failure mode.
 *   2. Levenshtein fallback — within a generous edit-distance budget
 *      (5% of canonical length, min 3) snap to the closest canonical.
 */
function snapTopicsToCanonical(resource) {
  const canonical = resource?.meta?.topicScope?.topics;
  if (!Array.isArray(canonical) || canonical.length === 0) return;
  const canonicalSet = new Set(canonical);
  const cache = new Map();

  const snap = (s) => {
    if (typeof s !== 'string') return s;
    if (canonicalSet.has(s)) return s;
    if (cache.has(s)) return cache.get(s);

    // Phase 1 — collapse adjacent duplicate runs around — / ; / , delimiters.
    const collapsed = collapseDuplicateRuns(s);
    if (canonicalSet.has(collapsed)) {
      cache.set(s, collapsed);
      return collapsed;
    }

    // Phase 2 — Levenshtein. Generous budget (10% of canonical length, min 6)
    // to catch single-word substitutions in long topic strings, e.g. an
    // Afrikaans FAL topic where the model wrote "Skryf en Kyk: ..." instead
    // of canonical "Lees en Kyk: ..." (5-char distance over a 60-char string,
    // which a 5%/min-3 budget would miss). The "best match within budget"
    // semantics still picks the closest canonical, so widening doesn't risk
    // snapping to a wrong topic when a nearer one exists.
    let best = s, bestDist = Infinity;
    for (const c of canonical) {
      const budget = Math.max(6, Math.floor(c.length * 0.10));
      if (Math.abs(c.length - s.length) > budget) continue;
      const d = levenshtein(s, c);
      if (d < bestDist && d <= budget) { best = c; bestDist = d; }
    }
    cache.set(s, best);
    return best;
  };

  const walk = (q) => {
    if (q && typeof q === 'object') {
      if (typeof q.topic === 'string') q.topic = snap(q.topic);
      if (Array.isArray(q.subQuestions)) q.subQuestions.forEach(walk);
    }
  };
  for (const sec of resource.sections || []) {
    if (Array.isArray(sec.questions)) sec.questions.forEach(walk);
  }
}

// Strip any "<frag><sep><frag>" run where the two <frag>s are identical
// (case-insensitive, whitespace-trimmed). Splits on the typical CAPS topic
// delimiters: em-dash, en-dash, semicolon, comma. Returns the collapsed string.
function collapseDuplicateRuns(s) {
  const parts = s.split(/(\s*[—–;,]\s*)/);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const isContent = i % 2 === 0;
    if (isContent && i >= 2) {
      const prevContent = out[out.length - 2] ?? '';
      if (prevContent.trim().toLowerCase() === p.trim().toLowerCase() && p.trim() !== '') {
        // Drop the duplicate content AND its preceding separator.
        out.pop();
        continue;
      }
    }
    out.push(p);
  }
  return out.join('');
}

// Iterative Levenshtein — O(n×m) time, O(min(n,m)) space.
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Ensure b is the shorter for memory.
  if (a.length < b.length) { const t = a; a = b; b = t; }
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const t = prev; prev = curr; curr = t;
  }
  return prev[b.length];
}

// Exposed for the spike runner.
export const __internals = { buildContext, topicScopeFor, parseDurationMinutes, unwrapStringifiedBranches, snapTopicsToCanonical, collapseDuplicateRuns, levenshtein, buildCacheKey };

// ─────────────────────────────────────────────────────────────────────
// EXPRESS HANDLER
//
// Mounted at POST /api/generate. Pipeline:
//   validate input → generate (Claude tool call → unwrap → rebalance →
//   assertResource) → renderResource (DOCX) → respond.
//
// Speaks SSE when the client sends Accept: text/event-stream, otherwise
// plain JSON. Result payload matches the legacy contract:
//   { docxBase64, preview, filename, verificationStatus }
// ─────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const log = req.log || defaultLogger;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let parsed;
  let bypassCache;
  try {
    parsed = parseRequest(req.body || {});
    bypassCache = bool(req.body?.fresh);
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message, field: err.field });
    }
    return res.status(400).json({ error: err.message });
  }

  const channel = createEventChannel(req, res);
  const abort = new AbortController();
  channel.onClose(() => abort.abort());

  // Result cache: identical request params within the TTL window return the
  // cached payload without an Anthropic call. Pass {fresh:true} to bypass.
  // Same response shape; _meta.cached signals the source for observability.
  const cacheKey = buildCacheKey(parsed);
  if (!bypassCache) {
    const cached = safeCacheGet(cacheKey, log);
    if (cached) {
      log.info?.({ cacheKey }, 'generate: cache hit');
      channel.sendPhase('cache', 'hit');
      channel.sendResult({ ...cached, _meta: { ...(cached._meta || {}), cached: true } });
      return;
    }
  }

  try {
    channel.sendPhase('generate', 'started');
    const result = await generate(parsed, { logger: log, signal: abort.signal });
    const { resource, validation, rebalance, ctx } = result;
    channel.sendPhase('generate', 'done', {
      leafSum: rebalance.finalSum,
      targetSum: rebalance.targetSum,
      nudges: rebalance.adjustments.length,
      tally: tallyCogLevels(resource),
    });

    if (!validation.ok) {
      log.warn({ errors: validation.errors }, 'generate: assertResource failed');
      channel.sendError(Object.assign(new Error('Schema validation failed after rebalance'), {
        status: 502, code: 'SCHEMA_INVALID', detail: validation.errors,
      }));
      return;
    }

    channel.sendPhase('docx_render', 'started');
    const doc = renderResource(resource);
    const buf = await Packer.toBuffer(doc);
    channel.sendPhase('docx_render', 'done', { bytes: buf.length });

    const verificationStatus = !rebalance.converged
      ? 'mark_sum_drift'
      : 'invariants_passed';

    const filename = buildFilename(parsed);
    const preview = buildTextPreview(resource);

    const payload = {
      docxBase64: buf.toString('base64'),
      preview,
      filename,
      verificationStatus,
      _meta: {
        pipeline: 'v2',
        rebalanceNudges: rebalance.adjustments.length,
        framework: ctx.frameworkName,
      },
    };
    channel.sendResult(payload);
    safeCacheSet(cacheKey, payload, log);
  } catch (err) {
    log.error({ err: err?.message || err }, 'generate failed');
    if (channel.isSSE) channel.sendError(err);
    else if (!res.headersSent) {
      res.status(err?.status || 500).json({ error: err?.message || 'Server error' });
    }
  }
}

function parseRequest(body) {
  const subject      = str(body.subject,      { field: 'subject', max: 200 });
  const resourceType = oneOf(body.resourceType, ['Worksheet', 'Test', 'Exam', 'Final Exam', 'Investigation', 'Project', 'Practical', 'Assignment'], { field: 'resourceType' });
  const language     = oneOf(body.language, ['English', 'Afrikaans'], { field: 'language' });
  const grade        = int(body.grade, { field: 'grade', min: 4, max: 7 });
  const term         = int(body.term,  { field: 'term',  min: 1, max: 4 });
  const totalMarks   = int(body.duration, { field: 'duration', required: false, min: 5, max: 200 }) || 50;
  const difficulty   = oneOf(body.difficulty || 'on', ['below', 'on', 'above'], { field: 'difficulty' });
  return { subject, grade, term, language, resourceType, totalMarks, difficulty };
}

function buildFilename({ subject, resourceType, grade, term }) {
  return `${subject}-${resourceType}-Grade${grade}-Term${term}`.replace(/[^a-zA-Z0-9\-]/g, '-') + '.docx';
}

// Cache key derived from the seven canonical request fields. Order is fixed
// so two requests with the same params produce the same key regardless of
// JSON property order. Bumping the v2 prefix invalidates the whole cache
// when the response shape changes (DOCX renderer upgrades, _meta additions).
function buildCacheKey({ subject, grade, term, language, resourceType, totalMarks, difficulty }) {
  const norm = { subject, grade, term, language, resourceType, totalMarks, difficulty };
  return `gen:v2:${JSON.stringify(norm)}`;
}

function safeCacheGet(key, log) {
  try { return cacheGet(key); }
  catch (err) { log?.warn?.({ err: err?.message }, 'generate: cache lookup failed'); return null; }
}

function safeCacheSet(key, payload, log) {
  try { cacheSet(key, payload); }
  catch (err) { log?.warn?.({ err: err?.message }, 'generate: cache write failed'); }
}

// Plain-text preview synthesised from the Resource. Used by the frontend
// preview pane; not the DOCX. Walks sections + leaves in document order.
function buildTextPreview(resource) {
  const lines = [];
  const { meta, cover, stimuli = [], sections = [], memo } = resource;

  lines.push(cover.resourceTypeLabel || resourceType);
  lines.push(cover.subjectLine);
  lines.push(`${cover.gradeLine}  |  ${cover.termLine}  |  ${meta.totalMarks} marks`);
  lines.push('');

  const renderedStimuli = new Set();
  for (const sec of sections) {
    for (const ref of sec.stimulusRefs || []) {
      if (renderedStimuli.has(ref)) continue;
      const st = stimuli.find((s) => s.id === ref);
      if (st) {
        lines.push(`[${(st.heading || st.kind).toUpperCase()}]`);
        if (st.body) lines.push(st.body);
        if (st.description) lines.push(st.description);
        lines.push('');
        renderedStimuli.add(ref);
      }
    }

    const sumMarks = leafSumIn(sec.questions);
    lines.push(`${sec.letter ? `SECTION ${sec.letter}: ` : ''}${sec.title}  (${sumMarks} marks)`);
    if (sec.instructions) lines.push(sec.instructions);
    for (const q of sec.questions) appendQuestionPreview(lines, q);
    lines.push('');
  }

  lines.push(`TOTAL: ${meta.totalMarks} marks`);
  lines.push('');
  lines.push('— MEMORANDUM —');
  for (const a of memo?.answers || []) {
    lines.push(`${a.questionNumber}. ${a.answer}  [${a.cognitiveLevel}, ${a.marks}]`);
  }
  return lines.join('\n');
}

function appendQuestionPreview(lines, q) {
  if (Array.isArray(q.subQuestions)) {
    lines.push(`${q.number}  ${q.stem}`);
    for (const sq of q.subQuestions) appendQuestionPreview(lines, sq);
    return;
  }
  lines.push(`${q.number}  ${q.stem}  [${q.marks}]`);
}

function leafSumIn(questions) {
  let n = 0;
  const walk = (q) => {
    if (Array.isArray(q.subQuestions)) q.subQuestions.forEach(walk);
    else n += q.marks || 0;
  };
  questions.forEach(walk);
  return n;
}
