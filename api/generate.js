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
import {
  ATP,
  EXAM_SCOPE,
  getPacingUnits,
  getPacingFormalAssessments,
  getPacingUnitById,
} from '../lib/atp.js';
import {
  buildCapsReferenceBlock,
  buildAssessmentStructureBlock,
  formatSubtopics,
  formatPacingUnit,
  formatFormalAssessmentStructure,
  buildLessonContextBlock,
} from '../lib/atp-prompt.js';
import { resourceTypeLabel, subjectDisplayName, localiseDuration } from '../lib/i18n.js';
import { narrowSchemaForRequest, assertResource, tallyCogLevels } from '../schema/resource.schema.js';
import { rebalanceMarks } from '../lib/rebalance.js';
import { renderResource } from '../lib/render.js';
import { renderLessonPptx } from '../lib/pptx-builder.js';
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
 * - Lesson               → [t] (with topic locked to the chosen Unit)
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

  // Lesson path narrows the topic scope to the chosen Unit and pulls the
  // Unit's full pacing block so the prompt can ground every objective +
  // phase in CAPS bullets verbatim. Falls back to a clear error when the
  // unitId doesn't resolve — better than silently generating term-wide.
  const isLesson = resourceType === 'Lesson';
  let lessonUnit = null;
  let lessonTerm = term;
  if (isLesson) {
    if (!req.unitId) throw new Error('Lesson requests must include a unitId');
    const found = getPacingUnitById(subject, grade, req.unitId);
    if (!found) {
      throw new Error(`Unit "${req.unitId}" not found for ${subject} Grade ${grade}`);
    }
    lessonUnit = found.unit;
    lessonTerm = found.term;
  }

  const { coversTerms, topics } = isLesson
    ? { coversTerms: [lessonTerm], topics: [lessonUnit.topic] }
    : topicScopeFor(subject, grade, term, resourceType);
  if (topics.length === 0) {
    throw new Error(`No ATP topics for subject="${subject}" grade=${grade} term=${term}`);
  }

  // Rich CAPS detail (subtopics, prerequisites, per-strand mark splits)
  // pulled from data/atp-pacing.json. Empty arrays when no pacing data is
  // available — the prompt builder treats them as optional and skips
  // those sections, so this is safe to add for every request.
  // For lessons, only the chosen Unit's pacing block is in scope.
  const isExamType = resourceType === 'Exam' || resourceType === 'Final Exam';
  const pacingUnits = isLesson
    ? [lessonUnit]
    : coversTerms.flatMap((t) => getPacingUnits(subject, grade, t, false));
  const pacingFormalAssessments = isLesson
    ? []
    : getPacingFormalAssessments(subject, grade, term, isExamType);

  // For a Lesson, the "duration" tracked by meta is still in marks — the
  // worksheet's marks. The lesson's classroom length lives in lesson.lessonMinutes.
  const durationMin = parseDurationMinutes(marksToTime(totalMarks));
  const localisedDurationLabel = localiseDuration(marksToTime(totalMarks), language);
  const subjectDisplay = subjectDisplayName(subject, language);
  const localResourceLabel = resourceTypeLabel(resourceType, language);
  const lessonMinutes = isLesson ? (req.lessonMinutes || 45) : null;

  return {
    subject, grade, term: lessonTerm, language, resourceType, totalMarks, difficulty,
    frameworkName, cogLevels,
    cognitiveLevelNames: cogLevels.map((l) => l.name),
    coversTerms, topics,
    pacingUnits, pacingFormalAssessments,
    durationMin, localisedDurationLabel, subjectDisplay, localResourceLabel,
    isLesson, lessonUnit, lessonMinutes,
  };
}

// CAPS-pacing prompt builders live in lib/atp-prompt.js (imported above)
// so they can be unit-tested without loading the full generation pipeline.

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
    pacingUnits, pacingFormalAssessments,
    durationMin, localisedDurationLabel, subjectDisplay, localResourceLabel,
    isLesson, lessonUnit, lessonMinutes,
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
    ...buildCapsReferenceBlock(pacingUnits),
    ...buildAssessmentStructureBlock(pacingFormalAssessments, resourceType, totalMarks),
    ...(isLesson ? buildLessonContextBlock(lessonUnit, lessonMinutes, language) : []),
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
    `5. Stimuli are first-class. If a question references a passage/visual/data/table, declare it once in stimuli[] and reference it via stimulusRef. NEVER inline tables, data, or passages directly into a question stem.`,
    `5a. RENDERABLE DIAGRAMS — STRICT WHITELIST. The system can render ONLY these diagram types, with these exact constraints:
       • bar_graph — vertical bars; bars MUST be an array of 2 to 10 entries (NO MORE THAN 10). Use for data handling, climate, results.
       • number_line — horizontal axis with optional marks; up to 25 ticks. Use for ordering, rounding, fractions, decimals.
       • food_chain — 2 to 6 organisms in a row with arrows. Use for NST trophic-level / energy-flow questions.

       HARD RULE: if the natural question would require a DIFFERENT visual the system cannot render — soil profile, body diagram, electric circuit, life-cycle wheel, plant cross-section, water cycle, map of South Africa, Venn diagram, place-value chart, pie chart, line graph, etc. — then DO NOT WRITE THAT QUESTION. Choose a different question that either uses one of the three supported diagrams above, or needs no visual at all. NEVER emit a kind:"diagram" stimulus without a renderable spec, and NEVER write a question that says "study the diagram below" / "label the diagram" / "use the diagram" if the diagram is not one of the three supported types. The fallback "[Visual text — described below]" placeholder is NOT acceptable output — it makes the paper look broken.

       For bar_graph specifically: if your data has more than 10 categories (e.g. 12 months of rainfall), AGGREGATE (4 quarters) or PICK A SUBSET (the 6 wettest months) so the bar count is ≤ 10. Don't try to squeeze 12 bars in.

       Always include altText alongside spec for accessibility.`,
    `5b. DIAGRAMS MUST NOT REVEAL ANSWERS. The diagram is a stimulus the learner must INTERPRET. If the question asks "Which fruit was the most popular?", the bars must be labelled with category names (Apple, Banana) and values (so the learner reads the bars), but if the question asks "Name the part labelled A", the diagram must show only the letter A — never "A: Flower". Treat callouts as keys (A, B, C / 1, 2, 3), never as names or definitions. When in doubt: would a learner who already knew the answer get no advantage from the diagram? Then it's safe.`,
    `5c. VARY DIAGRAM SCENARIOS. Real CAPS papers use a wide range of contexts — never default to the same one. Across the bar graphs and number lines you choose, rotate freely through scenarios that fit South African Grade 4–7 life: sports (rugby, soccer, netball, athletics), transport (cars at the gate, taxis, bicycles, scooters), weather and climate (rainfall, daily temperatures, wind speed), shopping and money (tuck-shop sales, market prices in rand, school fundraisers), animals (Kruger sightings, farm livestock, bird counts in the garden), reading and library use, household items, recycling weights, plant or class growth, holiday destinations. AVOID using the same scenario you would expect a teacher to have already seen — e.g. "favourite fruit" is fine occasionally but should not be the default. The label set should reflect the chosen scenario (Kudu/Impala/Zebra; Soccer/Rugby/Netball; Jan/Feb/Mar; etc.), not generic placeholders.`,
    `5d. DIAGRAM BUDGET. Across the WHOLE paper aim for 0–3 rendered diagrams in total — never one per question, never one per section. Some papers (a Worksheet on multiplication facts, a vocabulary Test) should have ZERO diagrams; that is correct, not a failure. A bar graph + a number line on every paper is wrong; pick whichever genuinely serves the assessment. Within one paper, never repeat the same SCENARIO across diagrams (do not have two bar graphs both about animals at a watering hole — pick different real-world contexts per diagram). Repeating the same TYPE is fine (e.g. two number lines for two distinct concepts) only when each diagram tests a different skill.`,
    `5e. TABULAR DATA → dataSet, NEVER ASCII PIPES. Tabular data — input/output tables, fraction-decimal-percentage equivalences, multiplication tables, frequency tables, timetables, conversion tables — MUST be declared as a \`dataSet\` stimulus with \`table: { headers: [...], rows: [[...], ...] }\` and referenced via stimulusRef. The renderer turns dataSet into a clean native Word table. Do NOT type a table as pipe-delimited monospace text inside the question stem (e.g. "| 1 | 2 | 3 |") — that renders as ugly ASCII art and fails accessibility. If a row needs a blank for the learner to fill in, use "?" or "____" inside the cell value. Never include both an inline ASCII version AND a dataSet stimulus — the dataSet is the only canonical form.`,
    `5f. MCQ STEMS REQUIRE OPTIONS. Any question whose stem invites a choice from listed alternatives ("Which of the following...", "Choose the correct...", "Select the...", "A quadrilateral with one pair of parallel sides is called a:", "What is the value of ...?" — when followed by selectable answers) MUST be \`type: "MCQ"\` with \`answerSpace.kind: "options"\` AND a complete \`options\` array of 4 items, each \`{ label, text, isCorrect }\`, with exactly ONE isCorrect:true. Never emit an MCQ-phrased stem as \`type: "ShortAnswer"\` or with no options — that produces an unanswerable question (a stem and a [mark] bracket with nothing to choose). If the section is titled "Multiple Choice", every question in that section must follow this pattern.`,
    `5g. PHOTOGRAPHS / IMAGES — NOT SUPPORTED. The system has NO photographic capability. Do NOT write questions that say "study the photograph", "look at the picture below", "identify the plant/animal in the photo", "what is shown in the image", or any variant. Do NOT emit any stimulus that references an external image. If a question would naturally need a photograph, choose a different question — descriptive, calculation, comprehension, or one that uses the three supported diagrams (bar_graph, number_line, food_chain).`,
    `6. Question numbers are dotted decimals: "1", "1.1", "1.1.1".`,
    `7. memo.answer.markingGuidance is the rationale ONLY (acceptable answer variants, what working should show, common pitfalls). Do NOT write phrases like "Award N marks for X", "Maximum N marks", or "1 mark per ...". The mark column is rendered separately from the structured \`marks\` field — duplicating mark counts in the prose causes inconsistencies when totals are later adjusted.`,
    `8. Every question's \`topic\` field MUST be COPIED VERBATIM from the ATP topic list above. Do not paraphrase, abbreviate, or duplicate phrases inside it. The schema enforces an exact-string match.`,
    ``,
    `## Resource-type guidance`,
    isLesson
      ? `- A Lesson pairs a teacher-facing lesson plan (the \`lesson\` branch above) with a short in-class worksheet (sections+memo). The worksheet is one section, ${totalMarks} marks total, focused entirely on the chosen Unit topic. Keep the worksheet practice-oriented — short answer, fill-in, calculation, or simple word problems — not a mini test.`
      : isRTT && isExamType
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
    `- learnerInfoFields MUST include all of these in this order: name, surname, date, examiner, time, total. For Worksheets and Lessons you MAY omit examiner and time. For Tests/Exams/Final Exams include all six. Use bare labels (e.g. "Time", "Total") — the renderer adds the value.`,
    `- Section titles should be in ${language}, upper-cased. The TITLE ONLY — do NOT include the "SECTION A:" / "SECTION B:" prefix in section.title (the renderer adds that from section.letter), and do NOT include a "(N marks)" suffix (the renderer computes that from leaf marks). Correct: title="MULTIPLE CHOICE". Wrong: title="SECTION A: MULTIPLE CHOICE  (15 marks)".`,
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
  const lines = [
    `Generate the ${ctx.resourceType} described in the system prompt.`,
    `Set meta.schemaVersion="1.0", meta.subject="${ctx.subject}", meta.grade=${ctx.grade}, meta.term=${ctx.term}, meta.language="${ctx.language}", meta.resourceType="${ctx.resourceType}", meta.totalMarks=${ctx.totalMarks}, meta.duration.minutes=${ctx.durationMin}, meta.difficulty="${ctx.difficulty}".`,
    `meta.topicScope.coversTerms=[${ctx.coversTerms.join(',')}], meta.topicScope.topics must be exactly the ATP topic list given above.`,
    `Ensure the leaf-mark sum equals ${ctx.totalMarks} and that every leaf has a corresponding memo answer.`,
  ];
  if (ctx.isLesson) {
    lines.push(
      `Populate the lesson branch per the "Lesson plan directives" section above. ` +
      `Phase minutes must sum to ${ctx.lessonMinutes} (±5), and exactly ONE phase must have worksheetRef:true.`,
    );
  }
  return lines.join('\n');
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
      // Lessons emit a lesson plan + a slide deck on top of the worksheet,
      // which roughly doubles the structured output. Other resource types
      // keep the historical 16k budget.
      maxTokens: ctx.isLesson ? 24000 : 16000,
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
export const __internals = {
  buildContext,
  topicScopeFor,
  parseDurationMinutes,
  unwrapStringifiedBranches,
  snapTopicsToCanonical,
  collapseDuplicateRuns,
  levenshtein,
  buildCacheKey,
  // CAPS-pacing prompt formatters — pure, exposed for tests.
  formatSubtopics,
  formatPacingUnit,
  formatFormalAssessmentStructure,
  buildCapsReferenceBlock,
  buildAssessmentStructureBlock,
  buildSystemPrompt,
};

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

  // Hard wall-clock ceiling on the whole generation pipeline. The
  // per-call Anthropic timeout is 180s, and generate() retries up to 3
  // times on schema-validation failures, so the worst-case before this
  // fires would be ~9 min — long enough that the heartbeat masks it as
  // an indefinite hang from the user's perspective. Aborting at 5 min
  // surfaces a clear error instead.
  const HARD_TIMEOUT_MS = 5.5 * 60 * 1000;
  const hardTimeout = setTimeout(() => {
    log.warn({ cacheKey }, 'generate: hard timeout (5 min) — aborting');
    abort.abort(new Error('TIMEOUT_5MIN'));
  }, HARD_TIMEOUT_MS);

  // Keep-alive heartbeat — the Anthropic call for a Final Exam can take
  // 90–150s, during which no real events flow through the SSE stream.
  // Upstream proxies (Cloudflare ~100s, Railway edge ~120s) kill idle
  // connections, which the frontend sees as "Network hiccup". A small
  // heartbeat comment every 15s keeps the pipe warm without polluting
  // the event stream the client subscribes to.
  const heartbeatTimer = channel.isSSE
    ? setInterval(() => channel.sendHeartbeat(), 15000)
    : null;

  try {
    channel.sendPhase('generate', 'started');
    // Final Exam is the longest-prompt, longest-output path: full year
    // scope + max marks. Sonnet often takes >180s to produce a valid
    // response, which means a single attempt already eats most of our
    // 5-min wall-clock budget. Drop the schema-retry to a single attempt
    // and rely on the per-call timeout (now 240s) to bound the call.
    const isFinalExam = parsed.resourceType === 'Final Exam';
    const result = await generate(parsed, {
      logger: log,
      signal: abort.signal,
      maxRetries: isFinalExam ? 0 : 2,
    });
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
    const pptxFilename = parsed.resourceType === 'Lesson'
      ? filename.replace(/\.docx$/i, '.pptx')
      : null;
    const preview = buildTextPreview(resource);

    // Lessons additionally render to PowerPoint. We render serially after
    // DOCX so a PPTX-render failure (very rare — pure JS, no native deps)
    // doesn't kill the DOCX path the teacher came for. On failure the
    // payload still carries the DOCX; the frontend just won't show the
    // PowerPoint button.
    let pptxBase64 = null;
    if (parsed.resourceType === 'Lesson') {
      channel.sendPhase('pptx_render', 'started');
      try {
        pptxBase64 = await renderLessonPptx(resource);
        channel.sendPhase('pptx_render', 'done', {
          bytes: Math.round((pptxBase64.length * 3) / 4),
          slides: resource.lesson?.slides?.length || 0,
        });
      } catch (err) {
        log.warn({ err: err?.message || err }, 'generate: PPTX render failed; DOCX still ships');
        channel.sendPhase('pptx_render', 'failed');
      }
    }

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
      ...(pptxBase64 ? { pptxBase64, pptxFilename } : {}),
    };
    channel.sendResult(payload);
    safeCacheSet(cacheKey, payload, log);
  } catch (err) {
    // Re-shape the hard-timeout abort into a clean user-facing error so
    // the frontend renders 'took too long' instead of a generic abort.
    const isHardTimeout =
      err?.message === 'TIMEOUT_5MIN' ||
      abort.signal.reason?.message === 'TIMEOUT_5MIN';
    const surfaced = isHardTimeout
      ? Object.assign(
          new Error('Generation took longer than 5 minutes. Final Exams sometimes hit this; please try again, or generate a Term Test instead which is faster.'),
          { status: 504, code: 'GENERATE_TIMEOUT' },
        )
      : err;

    log.error({ err: err?.message || err, hardTimeout: isHardTimeout }, 'generate failed');
    if (channel.isSSE) channel.sendError(surfaced);
    else if (!res.headersSent) {
      res.status(surfaced?.status || 500).json({ error: surfaced?.message || 'Server error' });
    }
  } finally {
    clearTimeout(hardTimeout);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

function parseRequest(body) {
  const subject      = str(body.subject,      { field: 'subject', max: 200 });
  const resourceType = oneOf(body.resourceType, ['Worksheet', 'Test', 'Exam', 'Final Exam', 'Investigation', 'Project', 'Practical', 'Assignment', 'Lesson'], { field: 'resourceType' });
  const language     = oneOf(body.language, ['English', 'Afrikaans'], { field: 'language' });
  const grade        = int(body.grade, { field: 'grade', min: 4, max: 7 });
  const term         = int(body.term,  { field: 'term',  min: 1, max: 4 });
  const totalMarks   = int(body.duration, { field: 'duration', required: false, min: 5, max: 200 }) || 50;
  const difficulty   = oneOf(body.difficulty || 'on', ['below', 'on', 'above'], { field: 'difficulty' });
  const parsed = { subject, grade, term, language, resourceType, totalMarks, difficulty };

  // Lesson-only extras. The Unit picker on the frontend posts a unitId from
  // /api/pacing-units; lessonMinutes is the planned classroom length.
  if (resourceType === 'Lesson') {
    parsed.unitId = str(body.unitId, { field: 'unitId', max: 200 });
    parsed.lessonMinutes = int(body.lessonMinutes, {
      field: 'lessonMinutes', required: false, min: 20, max: 120,
    }) || 45;
  }
  return parsed;
}

function buildFilename({ subject, resourceType, grade, term }) {
  return `${subject}-${resourceType}-Grade${grade}-Term${term}`.replace(/[^a-zA-Z0-9\-]/g, '-') + '.docx';
}

// Cache key derived from the canonical request fields. Order is fixed so
// two requests with the same params produce the same key regardless of
// JSON property order. Bumping the version prefix invalidates the whole
// cache when the response shape changes (DOCX renderer upgrades, _meta
// additions). Lesson requests include unitId + lessonMinutes so two
// different lessons in the same subject/grade/term don't collide.
function buildCacheKey({
  subject, grade, term, language, resourceType, totalMarks, difficulty,
  unitId, lessonMinutes,
}) {
  const norm = { subject, grade, term, language, resourceType, totalMarks, difficulty };
  if (resourceType === 'Lesson') {
    norm.unitId = unitId || null;
    norm.lessonMinutes = lessonMinutes || null;
  }
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
  const { meta, cover, stimuli = [], sections = [], memo, lesson } = resource;

  lines.push(cover.resourceTypeLabel || meta.resourceType);
  lines.push(cover.subjectLine);
  lines.push(`${cover.gradeLine}  |  ${cover.termLine}  |  ${meta.totalMarks} marks`);
  lines.push('');

  // Lesson plan goes above the worksheet so the teacher sees both halves
  // in the preview pane. For non-Lesson resources `lesson` is undefined
  // and this block is skipped.
  if (meta.resourceType === 'Lesson' && lesson) {
    appendLessonPreview(lines, lesson);
  }

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

function appendLessonPreview(lines, lesson) {
  lines.push('— LESSON PLAN —');
  const anchor = lesson.capsAnchor || {};
  if (anchor.unitTopic) lines.push(`Unit: ${anchor.unitTopic}`);
  if (anchor.capsStrand) {
    lines.push(`Strand: ${anchor.capsStrand}${anchor.subStrand ? ` / ${anchor.subStrand}` : ''}`);
  }
  if (anchor.weekRange) lines.push(`Weeks: ${anchor.weekRange}`);
  if (lesson.lessonMinutes) lines.push(`Length: ${lesson.lessonMinutes} minutes`);
  if (anchor.sourcePdf) {
    const pageSuffix = anchor.sourcePage ? `, p. ${anchor.sourcePage}` : '';
    lines.push(`Source: ${anchor.sourcePdf}${pageSuffix}`);
  }
  lines.push('');

  if (lesson.learningObjectives?.length) {
    lines.push('LEARNING OBJECTIVES');
    for (const o of lesson.learningObjectives) lines.push(`  • ${o}`);
    lines.push('');
  }
  if (lesson.priorKnowledge?.length) {
    lines.push('PRIOR KNOWLEDGE');
    for (const p of lesson.priorKnowledge) lines.push(`  • ${p}`);
    lines.push('');
  }
  if (lesson.vocabulary?.length) {
    lines.push('KEY VOCABULARY');
    for (const v of lesson.vocabulary) lines.push(`  • ${v.term} — ${v.definition}`);
    lines.push('');
  }
  if (lesson.materials?.length) {
    lines.push('MATERIALS');
    for (const m of lesson.materials) lines.push(`  • ${m}`);
    lines.push('');
  }
  if (lesson.phases?.length) {
    lines.push('LESSON PHASES');
    for (const p of lesson.phases) {
      lines.push(`  ${p.name}  (${p.minutes} min)${p.worksheetRef ? '  ← worksheet' : ''}`);
      for (const a of p.teacherActions || []) lines.push(`    T: ${a}`);
      for (const a of p.learnerActions || []) lines.push(`    L: ${a}`);
      for (const q of p.questionsToAsk || []) lines.push(`    ?  ${q}`);
    }
    lines.push('');
  }
  if (lesson.differentiation) {
    const d = lesson.differentiation;
    if (d.below?.length || d.onGrade?.length || d.above?.length) {
      lines.push('DIFFERENTIATION');
      for (const [items, lbl] of [[d.below, 'Below'], [d.onGrade, 'On grade'], [d.above, 'Above']]) {
        if (items?.length) {
          lines.push(`  ${lbl}:`);
          for (const it of items) lines.push(`    • ${it}`);
        }
      }
      lines.push('');
    }
  }
  if (lesson.homework?.description) {
    const mins = lesson.homework.estimatedMinutes ? ` (${lesson.homework.estimatedMinutes} min)` : '';
    lines.push(`HOMEWORK${mins}`);
    lines.push(`  ${lesson.homework.description}`);
    lines.push('');
  }
  if (lesson.teacherNotes?.length) {
    lines.push('TEACHER NOTES');
    for (const n of lesson.teacherNotes) lines.push(`  • ${n}`);
    lines.push('');
  }
  lines.push('— LEARNER WORKSHEET —');
  lines.push('');
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
