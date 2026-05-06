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
  getOutOfScopePacingUnits,
  findUnitSubtopic,
} from '../lib/atp.js';
import {
  buildCapsReferenceBlock,
  buildAssessmentStructureBlock,
  buildOutOfScopeBlock,
  formatSubtopics,
  formatPacingUnit,
  formatFormalAssessmentStructure,
  prescribedSectionMarksFor,
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
  const { subject, grade, term, language, resourceType, difficulty = 'on' } = req;
  let { totalMarks } = req;

  // Creative Arts is a Practical Task with a CAPS-fixed 40-mark rubric, not
  // a Q&A paper. The 2026-05 teacher review (docs/teacher-feedback-2026-05.md
  // §3.5) made this explicit: "Art is always out of 40 marks", "It is not a
  // question paper, but instead an instruction of art that needs to be
  // created or a performance that must be prepared". Override totalMarks
  // so the rest of the pipeline (rebalance, render) operates on the right
  // canonical figure regardless of what the request asked for.
  const isCreativeArts = /Life Skills.*Creative Arts/i.test(subject);
  if (isCreativeArts) totalMarks = 40;

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
  let lessonSubtopic = null;
  if (isLesson) {
    if (!req.unitId) throw new Error('Lesson requests must include a unitId');
    const found = getPacingUnitById(subject, grade, req.unitId);
    if (!found) {
      throw new Error(`Unit "${req.unitId}" not found for ${subject} Grade ${grade}`);
    }
    lessonUnit = found.unit;
    lessonTerm = found.term;
    // Optional subtopic narrowing. We DON'T error on a missing match —
    // older cached requests or a Unit whose subtopic list changed
    // upstream would otherwise become un-regenerable. Falling back to
    // whole-Unit scope keeps the request servable.
    if (req.subtopicHeading) {
      lessonSubtopic = findUnitSubtopic(lessonUnit, req.subtopicHeading);
    }
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
  // Units in OTHER terms — used to tell the model what NOT to test. Empty
  // for Lessons (single-unit scope) and for Final Exams (cover all 4 terms).
  const outOfScopePacingUnits = isLesson
    ? []
    : getOutOfScopePacingUnits(subject, grade, term, isExamType);

  // CAPS-prescribed section marks (Phase F). For Languages papers where
  // CAPS specifies a per-section mark split, compute the targets up-front
  // so the rebalancer can enforce them after fixing total + cog. Returns
  // null when the subject has no section structure (e.g. Maths assessments
  // are mark-range only with no per-section split).
  const prescribedSectionMarks = isLesson
    ? null
    : prescribedSectionMarksFor(pacingFormalAssessments, resourceType, totalMarks);

  // Creative Arts: pull the term's art form (Visual Arts / Performing Arts)
  // from the pacing units' capsStrand. CAPS strictly alternates these by
  // term, and the 2026-05 teacher review made it a hard rule that papers
  // never combine both. Pin the prompt to whichever the term schedules.
  let creativeArtsFocus = null;
  if (isCreativeArts) {
    const focusCounts = {};
    for (const u of pacingUnits) {
      if (u.isAssessmentSlot && u.capsStrand) {
        focusCounts[u.capsStrand] = (focusCounts[u.capsStrand] || 0) + 1;
      }
    }
    // Prefer the strand the term's formal-assessment slot uses; fall back
    // to the most-frequent strand among the term's units; default to
    // Visual Arts when neither yields a verdict.
    creativeArtsFocus = Object.entries(focusCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!creativeArtsFocus) {
      const allStrands = pacingUnits.map((u) => u.capsStrand).filter(Boolean);
      const counts = {};
      for (const s of allStrands) counts[s] = (counts[s] || 0) + 1;
      creativeArtsFocus = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Visual Arts';
    }
  }

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
    pacingUnits, pacingFormalAssessments, outOfScopePacingUnits,
    isCreativeArts, creativeArtsFocus,
    prescribedSectionMarks,
    durationMin, localisedDurationLabel, subjectDisplay, localResourceLabel,
    isLesson, lessonUnit, lessonSubtopic, lessonMinutes,
    isFinalExam: resourceType === 'Final Exam',
    seriesContext: isLesson ? (req.seriesContext || null) : null,
  };
}

// CAPS-pacing prompt builders live in lib/atp-prompt.js (imported above)
// so they can be unit-tested without loading the full generation pipeline.

/**
 * Creative Arts task-brief block. The 2026-05 teacher review
 * (docs/teacher-feedback-2026-05.md §3.5) made four hard rules explicit:
 *   1. Visual + Performing arts alternate by term, NEVER combined
 *   2. Output is a TASK BRIEF (instructions to make/perform), not a Q&A paper
 *   3. Total = 40 marks (CAPS-prescribed)
 *   4. No Bloom's / cog-level analysis — practical rubric only
 *
 * The CAPS pacing data confirms #1 and #3 verbatim; #2 + #4 are pedagogical
 * conventions the wife asserted from her own experience.
 *
 * The block tells the model to populate the schema with phases-as-questions
 * (Planning / Creating / Presenting / Reflecting) plus a real rubric in
 * memo. This satisfies the schema (which can't be fundamentally restructured
 * here) while still emitting content that READS as a task brief, not a Q&A.
 */
function buildCreativeArtsTaskBriefBlock(focus, term, language) {
  const isVisual = /Visual/i.test(focus || '');
  const af = language === 'Afrikaans';
  const phases = isVisual
    ? af
      ? ['Beplanning en navorsing', 'Skep van die kunswerk', 'Aanbieding en refleksie']
      : ['Planning and research', 'Creating the artwork', 'Presentation and reflection']
    : af
      ? ['Beplanning en oefening', 'Repetisie', 'Opvoering en refleksie']
      : ['Planning and rehearsal', 'Rehearsal practice', 'Performance and reflection'];

  return [
    `## Creative Arts task brief (HARD RULES)`,
    `This is a CAPS Creative Arts ${focus} Practical Task for Term ${term}, NOT a written Q&A paper. Treat it as a task brief that instructs learners to ${isVisual ? 'create an artwork' : 'prepare and perform'}, not as a comprehension test. CAPS prescribes 40 marks total, assessed against a rubric.`,
    ``,
    `Hard rules (from the CAPS ATP and teacher-moderator review):`,
    `  1. ART FORM: This paper is ${focus} ONLY. Do NOT include any ${isVisual ? 'performing-arts (drama / dance / music)' : 'visual-arts (drawing / painting / 3D)'} content. CAPS rotates Visual Arts and Performing Arts by term — they are NEVER combined in a single assessment.`,
    `  2. NOT A Q&A PAPER: Do NOT write "Define the term…", "Name three…", "Identify the…" questions. Each section is a phase of the task with INSTRUCTIONS to the learner, not a comprehension question.`,
    `  3. 40 MARKS: meta.totalMarks MUST be 40. The four-criterion rubric splits typically allocate roughly: ${isVisual ? 'Planning/Idea (8m), Composition/Technique (16m), Use of Materials (8m), Reflection/Presentation (8m)' : 'Planning/Concept (8m), Performance Technique (16m), Creative Interpretation (8m), Reflection (8m)'}. Adjust to fit but keep the total at 40.`,
    `  4. STRUCTURE: emit ${phases.length} sections, one per phase, IN ORDER:`,
    ...phases.map((p, i) => `       ${String.fromCharCode(65 + i)}. ${p}`),
    `     Each section's "questions" are PHASE INSTRUCTIONS. Each leaf's stem is a step the learner takes (e.g. "Sketch three rough designs for your relief mandala on A4 paper"), and each leaf's marks contribute to the relevant rubric criterion. answerSpace.kind should be "lines" with a generous \`lines\` count (5-15) so the learner has room to record planning notes / reflection.`,
    `  5. RUBRIC: memo.rubric is REQUIRED. List 4 criteria each with 3-4 mark-band descriptors (e.g. "0-2 marks: limited", "3-5: developing", "6-7: proficient", "8: excellent"). The rubric criteria mark totals MUST sum to 40.`,
    `  6. MEMO ANSWERS: memo.answers entries describe what the teacher should LOOK FOR when marking each phase, not "the correct answer". E.g. "Strong responses identify a clear theme, sketch ≥3 design variations, and explain colour/material choices in 2-3 sentences."`,
    `  7. COGNITIVE FRAMEWORK: keep the cog framework as Bloom's per schema requirements but the cognitive analysis table will NOT be rendered for Creative Arts (per CAPS — Practical Tasks are rubric-marked, not cog-analysed). Map each leaf's cognitiveLevel loosely: planning items → "Low Order"; creating/performing → "Middle Order"; reflection/critique → "High Order".`,
    `  8. NO MCQ, NO TRUE/FALSE, NO FILL-BLANK: every "leaf" is a ShortAnswer or ExtendedResponse "step in the task" — never a forced-choice question.`,
    ``,
  ];
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
    pacingUnits, pacingFormalAssessments, outOfScopePacingUnits,
    isCreativeArts, creativeArtsFocus,
    prescribedSectionMarks,
    durationMin, localisedDurationLabel, subjectDisplay, localResourceLabel,
    isLesson, lessonUnit, lessonSubtopic, lessonMinutes, seriesContext,
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
  const isMaths = subject.includes('Mathematics') || subject.includes('Wiskunde');
  const isNST = (subject.includes('Natural Sciences') || subject.includes('Natuurwetenskappe'))
    && !subject.includes('Technology') && !subject.includes('Tegnologie')
    || subject.includes('Natural Sciences and Technology');
  const isIntermediatePhase = grade >= 4 && grade <= 6;

  const subjectGuidance = buildSubjectGuidance({
    isRTT, isExamType, isGeography, isHistory, isAfrikaansHL, isMaths, isNST, isIntermediatePhase, grade,
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
    ...(isLesson ? [] : buildOutOfScopeBlock(outOfScopePacingUnits || [])),
    ...(isLesson ? buildLessonContextBlock(lessonUnit, lessonMinutes, language, lessonSubtopic, seriesContext) : []),
    ...(isCreativeArts ? buildCreativeArtsTaskBriefBlock(creativeArtsFocus, term, language) : []),
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
    `4a. PER-QUESTION MARK FAIRNESS. Each leaf's \`marks\` value MUST reflect the work the question asks of the learner. Live moderation has shown the most common quality failure is fair-sum totals at paper level masking unfair allocations on individual questions. Apply these heuristics, then sanity-check each leaf:
       • COUNTING STEMS: when the stem says "Give TWO examples / List THREE reasons / Name FOUR features", marks MUST be at least the stated count (one mark per part). "Give two examples" → ≥2 marks. "List three reasons" → ≥3 marks. Never 1 mark for a multi-part stem.
       • MULTI-STEP CALCULATION: at least one mark per discrete step a learner is expected to show. A 3-step problem ("convert units, then multiply, then round") is ≥3 marks. A "show your working" instruction implies multi-mark allocation.
       • COMPOSITION / EXTENDED WRITING: a paragraph (~30–50 words) is ≥5 marks. An 80-word composition is ≥8 marks. A 100–150 word piece is ≥10 marks. NEVER 1–3 marks for an extended-writing task — that's the single most common unfairness pattern (composition under-marked vs trivial language exercises over-marked).
       • EXTENDED-RESPONSE / EVALUATION ("Why do you think…", "Justify with evidence", "Argue both sides"): ≥2 marks. Multi-sentence reasoning is never 1 mark.
       • SHORT-ANSWER (1 sentence, single fact): 1–2 marks.
       • MCQ / TrueFalse / FillBlank / OneWordAnswer / single-fact Identify: 1 mark.
       • SIBLING CONSISTENCY: within a single section, near-identical question types must have similar mark counts. If 9.3 and 9.4 are 2-mark short-answer items, do NOT make 9.5 a 1-mark question of the same shape.
       Before emitting the tool call, walk every leaf and verify: does \`marks\` match the work? If not, fix the marks (or the stem) so they match.`,
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
    `5e. TABULAR DATA → dataSet, NEVER ASCII PIPES. Tabular data — input/output tables, fraction-decimal-percentage equivalences, multiplication tables, frequency tables, timetables, conversion tables — MUST be declared as a \`dataSet\` stimulus with \`table: { headers: [...], rows: [[...], ...] }\` and referenced via stimulusRef. The renderer turns dataSet into a clean native Word table. Do NOT type a table as pipe-delimited monospace text inside the question stem (e.g. "| 1 | 2 | 3 |") — that renders as ugly ASCII art and fails accessibility. If a row needs a blank for the learner to fill in, use "?" or "____" inside the cell value. Never include both an inline ASCII version AND a dataSet stimulus — the dataSet is the only canonical form. EVERY \`dataSet\` you declare MUST include a non-empty \`rows\` array — a header-only table renders as a solid green bar with no content beneath, which the teacher will read as a broken paper. If you reference a stimulusRef that points to a dataSet, the dataSet's table.rows MUST contain real values learners can read.`,
    `5f. MCQ STEMS REQUIRE OPTIONS. Any question whose stem invites a choice from listed alternatives ("Which of the following...", "Choose the correct...", "Select the...", "A quadrilateral with one pair of parallel sides is called a:", "What is the value of ...?" — when followed by selectable answers) MUST be \`type: "MCQ"\` with \`answerSpace.kind: "options"\` AND a complete \`options\` array of 4 items, each \`{ label, text, isCorrect }\`, with exactly ONE isCorrect:true. Never emit an MCQ-phrased stem as \`type: "ShortAnswer"\` or with no options — that produces an unanswerable question (a stem and a [mark] bracket with nothing to choose). If the section is titled "Multiple Choice", every question in that section must follow this pattern.`,
    `5g. PHOTOGRAPHS / IMAGES — NOT SUPPORTED. The system has NO photographic capability. Do NOT write questions that say "study the photograph", "look at the picture below", "identify the plant/animal in the photo", "what is shown in the image", or any variant. Do NOT emit any stimulus that references an external image. If a question would naturally need a photograph, choose a different question — descriptive, calculation, comprehension, or one that uses the three supported diagrams (bar_graph, number_line, food_chain).`,
    `6. Question numbers are dotted decimals: "1", "1.1", "1.1.1".`,
    `7. memo.answer.markingGuidance is the rationale ONLY (acceptable answer variants, what working should show, common pitfalls). Do NOT write phrases like "Award N marks for X", "Maximum N marks", or "1 mark per ...". The mark column is rendered separately from the structured \`marks\` field — duplicating mark counts in the prose causes inconsistencies when totals are later adjusted.`,
    `8. Every question's \`topic\` field MUST be COPIED VERBATIM from the ATP topic list above. Do not paraphrase, abbreviate, or duplicate phrases inside it. The schema enforces an exact-string match.`,
    `9. NEVER USE MARKDOWN SYNTAX in any string field. The renderer treats text fields (stems, options, answers, marking guidance, instructions) as plain prose with proper Word formatting applied programmatically. Do NOT emit \`**word**\` for bold/underline, do NOT emit \`*word*\` for italics, do NOT emit \`# heading\` markers, do NOT emit pipe-delimited tables (see rule 5e — use a dataSet stimulus). If you need a word underlined for the question to make sense (e.g. "Identify the underlined noun in this sentence: The cat sat on the mat."), put the target word in single quotes ('cat') or capital letters or wrap it in inline angle brackets — never with markdown asterisks, which render as literal "**" in the final paper.`,
    `10. MULTI-PART QUESTIONS USE COMPOSITE / subQuestions, NEVER an inline stem. When a question has parts (a), (b), (c), (d) — e.g. "Rewrite each sentence in past tense" with three sentences each needing their own answer space — emit it as a Composite question with subQuestions, where the parent's stem is just the instruction ("Rewrite each sentence in past tense") and each sub-question is one of the parts. NEVER pack multiple parts inline like \`stem: "Rewrite each sentence. (a) The cat sleeps. (b) The dog runs. (c) The bird sings."\` because the renderer cannot give each part its own answer line that way. The teacher will mark this as broken.`,
    `11. DO NOT GIVE THE ANSWER AWAY IN THE STEM. A common failure: a syllabification question whose stem already shows the syllables ("Divide into syllables: re-cy-cling"). The learner has nothing to do. Always show the word UNDIVIDED ("recycling"), then ask for syllabification. Same rule for: pronunciation marks already on a stress question, capital letters already on a punctuation question, articles already on an "insert the article" question, parts of speech already labelled in a tagging question, etc. Read your stem back and check that solving it requires the learner to do something the stem doesn't already do.`,
    `12. MARK ARITHMETIC IN INSTRUCTIONS MUST BE CORRECT. If you write "(2 features × 2 dances = 3 marks)" the math is wrong (2×2=4) and the teacher will reject the paper. When you embed arithmetic into instruction text, verify the operation: count × items = total. Better practice: omit the breakdown from the instruction text and rely on the structured \`marks\` field — the renderer surfaces marks separately, and post-processing reconciles any per-step mark text via the rebalancer's reconcileMarkingGuidance pass. If you do include a breakdown, double-check the arithmetic before emitting.`,
    `13. SPELL OUT ABBREVIATIONS ON FIRST USE. Especially for Maths Grade 4-7: write "Highest Common Factor (HCF)" or just "Highest Common Factor" the first time it appears in a stem, never bare "HCF". Same for Lowest Common Multiple (LCM), Greatest Common Divisor (GCD), Least Common Denominator (LCD). Once spelled out, the abbreviation may be used in subsequent questions IN THE SAME PAPER. For Grade 4-6, prefer the full term throughout — Grade 6 learners should not be expected to decode subject-specific abbreviations cold.`,
    `14. VISUAL STIMULI MUST BE EITHER EMBEDDED OR CITED. The system can EMBED only the three diagram types listed in rule 5a (bar_graph, number_line, food_chain). For ANY other visual a question references — a poster, advertisement, infographic, photograph, painting reproduction, mandala diagram, plant cross-section — the system CANNOT generate the image. In that case, do NOT write a question that depends on seeing the image. If the question is about a real, well-known visual (e.g. a public-domain campaign poster), include a "Source:" line in the stimulus.description naming the source so the teacher can locate or print the asset (e.g. "Source: WWF SA, 'Beat Plastic Pollution' campaign poster, 2023, available at wwf.org.za"). Memo answers MUST NOT reference content visible only in an unembedded visual (e.g. "The Green Oceans Foundation" as the answer to "Name the organisation on the poster" when the poster doesn't exist).`,
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
function buildSubjectGuidance({ isRTT, isExamType, isGeography, isHistory, isAfrikaansHL, isMaths, isNST, isIntermediatePhase, grade }) {
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

  // Language-structures sections (typically Section C in HL Tests, Section D in HL Exams,
  // and the Language section of FAL papers) test grammar, parts of speech, punctuation,
  // tenses, etc. These are mechanical recall/transformation tasks — almost never
  // Inferential. Live moderation found Eng HL Section D and Afr HL Q3.2/4.1/4.2 mislabelled
  // as Inferential when they're actually Literal or Reorganisation.
  if (isRTT) {
    blocks.push([
      `## Cognitive-level stems for LANGUAGE STRUCTURES sections (grammar / punctuation / parts of speech)`,
      `Language-structures questions are mechanical operations on text. Default to LITERAL or REORGANISATION cognitive levels — they are almost NEVER Inferential and NEVER Evaluation:`,
      `  - Literal — "Identify the noun/verb/adjective in this sentence", "Underline the subject", "What punctuation mark belongs here?", single-word fill-in-the-blank, simple synonym/antonym match, parts-of-speech tagging.`,
      `  - Reorganisation — "Rewrite this sentence in past tense / passive voice / direct speech / negative form", "Combine these two sentences using a conjunction", "Change the singular noun to plural and adjust agreement", "Punctuate this sentence correctly".`,
      `  - Inferential is reserved for questions about MEANING IN THE PASSAGE (the comprehension section), not grammar transformations. Tense changes, conjunctions, and grammar rules are Reorganisation by definition — there is no inference required, only a transformation.`,
      ``,
      `Before emitting: any question in the language-structures section labelled Inferential or Evaluation should be re-checked. If it asks the learner to apply a grammar rule mechanically, it's Reorganisation. If it asks the learner to identify or recognise a feature, it's Literal.`,
    ].join('\n'));
  }

  if (isMaths) {
    blocks.push([
      `## Cognitive-level stem patterns (Mathematics — Bloom's framework)`,
      `Live moderation showed two recurring mismatch patterns on Maths papers: (a) routine 1-2 step calculations LABELLED as Complex Procedures when they're actually Routine Procedures, and (b) creative/synthesis questions LABELLED as Knowledge when they require Problem Solving. Apply these stem patterns:`,
      `  - Knowledge — pure recall: "Define ___", "What is the place value of ___?", "State the formula for ___", "Name the property that ___". No calculation, no application.`,
      `  - Routine Procedures — single algorithmic step the learner has practised: "Calculate 247 + 358", "Solve 3x + 5 = 20", "Convert 0.75 to a fraction", "Find the perimeter of a rectangle 4 cm by 6 cm". One operation, one answer.`,
      `  - Complex Procedures — MULTI-STEP problems requiring chained operations or multiple concepts: "A shop sells apples at R3.50 each. Sipho buys 12. He pays with a R50 note. How much change?" (3 steps: multiply, subtract, then state). "Find the area of an L-shape" (decompose then sum). Generally 2-4 distinct operations.`,
      `  - Problem Solving — non-routine, learner must DEVISE the approach: "Make up a number sentence whose answer is 24 using exactly three operations", "Investigate which dimensions for a rectangular pen with 20 m of fencing maximise area", "Explain why any 3-digit number minus its reverse is divisible by 9", open-ended investigations, justification with proof.`,
      ``,
      `HARD CHECK: a single-step calculation can NEVER be Problem Solving and rarely Complex Procedures. A "make up", "investigate", "explain why always", or "justify" stem can NEVER be Knowledge. Before emitting, scan each question: count the distinct operations — 1 op → Routine, 2-3 ops → Complex, "devise/justify/investigate" → Problem Solving.`,
    ].join('\n'));
  }

  if (isNST) {
    blocks.push([
      `## Cognitive-level stem patterns (Natural Sciences and Technology / Natural Sciences)`,
      `NST papers commonly over-supply Low Order recall ("Name ___", "List ___") and under-supply Middle Order application. Worse, the model has been mislabelling extended-response questions ("Explain in detail why ___") as Low Order when they require multi-sentence reasoning. Apply these stem patterns:`,
      `  - Low Order — single-fact recall + recognition: "Name the parts of a flower", "Identify the food group that ___ belongs to", "What is the function of the heart?", "List three sources of energy", multiple choice with ONE correct factual answer.`,
      `  - Middle Order — APPLICATION + interpretation: "Explain how ___ adapts to its environment", "Describe what would happen if ___", "Compare a producer and a consumer", "Use the food chain diagram to explain energy flow", "Predict the result of mixing X with Y based on what you've learned about ___".`,
      `  - High Order — analysis, design, evaluation: "Design a simple experiment to test ___ (state your hypothesis, method, and expected results)", "Evaluate the impact of ___ on ___", "Justify why ___ is more sustainable than ___ giving at least three reasons", multi-paragraph extended-response items with hypothesis-method-results structure.`,
      ``,
      `HARD CHECK: an extended-response question (3+ sentences expected, design/justify/evaluate verbs) is HIGH ORDER even if the topic looks elementary. A "list / name / state" stem is LOW ORDER even if the topic is sophisticated. Cognitive level is determined by the MENTAL OPERATION the learner performs, not by the topic.`,
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
    if (ctx.lessonSubtopic?.heading) {
      lines.push(
        `Focus this lesson narrowly on the subtopic "${ctx.lessonSubtopic.heading}" within the Unit. ` +
        `Do NOT cover other subtopics of the Unit — they will be taught in separate lessons.`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * Targeted remediation strings for the recurring schema-fail patterns.
 * Returned as a string (possibly empty) appended to the corrective-feedback
 * retry prompt, alongside the raw error list.
 *
 * The two original Lesson rules (worksheetRef, title-slide layout) are now
 * inferred by the renderers when missing, so they no longer surface here.
 * Only retained tips are for genuinely non-recoverable errors the model
 * needs to fix — phase-minute drift, mark-sum drift, etc.
 */
function buildTargetedRemediation(errors, ctx) {
  const tips = [];
  const has = (substr) => errors.some((e) => String(e.path || '').includes(substr) || String(e.message || '').includes(substr));

  if (has('phases[*].minutes')) {
    tips.push(
      `REMEDIATION (phase minutes): the sum of all lesson.phases[*].minutes MUST equal lesson.lessonMinutes within ±5. Recalculate per-phase minutes so they add up to ${ctx?.lessonMinutes ?? 'the requested length'}.`,
    );
  }
  if (has('sum(leaf.marks)')) {
    tips.push(
      `REMEDIATION (mark sum): the sum of leaf marks across all sections MUST equal meta.totalMarks=${ctx?.totalMarks ?? 'the requested total'}. Adjust mark allocations on individual leaves so the sum is exact.`,
    );
  }
  return tips.length ? `\n${tips.join('\n\n')}\n` : '';
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
  const usageByAttempt = [];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const user = lastErrors
      ? `${baseUser}\n\nThe previous attempt failed schema validation with these errors:\n${lastErrors.slice(0, 8).map((e) => `  - ${e.path}: ${e.message}`).join('\n')}\n${buildTargetedRemediation(lastErrors, ctx)}\nPlease emit a fresh, correct Resource that does not repeat these errors.`
      : initialUser;

    const raw = await callAnthropicTool({
      system,
      user,
      tool,
      model: SONNET_4_6,
      // Output budgets per resource type:
      //   Final Exam — full-year scope, 100-mark paper, multi-section
      //                with stimuli + matched memo. Empirically a 50-mark
      //                Test consumes ~10k output tokens; a 100-mark Final
      //                Exam needs ~20-25k. 32k gives comfortable headroom
      //                so the model can finish under the schema instead of
      //                truncating mid-tool-call (which fails validation
      //                and burns the retry budget).
      //   Lesson    — lesson plan + slide deck + worksheet + memo, roughly
      //                doubles a worksheet's output.
      //   Others    — historical 16k is plenty for Tests/Exams/Worksheets.
      maxTokens: ctx.isFinalExam ? 32000 : ctx.isLesson ? 24000 : 16000,
      // Final Exam at 32k output @ ~100 tok/s ≈ 320s of model time, so
      // bump the per-call timeout from the default 240s to 360s so the
      // call has a full 6 minutes before the wrapper aborts. Other types
      // keep the default which is comfortable for a 16k/24k budget.
      timeoutMs: ctx.isFinalExam ? 360000 : undefined,
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
      onUsage: (u) => usageByAttempt.push(u),
    });

    const resource = unwrapStringifiedBranches(raw);
    snapTopicsToCanonical(resource);
    // Languages (Barrett's framework) require EXACT section + cog targets
    // per the 2026-05 teacher review: "for languages they have to be exact".
    // Other subjects keep the ±1 default (cog drift stops well short of
    // teacher-noticeable, and Phase 4 is a no-op without prescription anyway).
    const isLanguages = ctx.frameworkName === "Barrett's";
    const rebalance = rebalanceMarks(resource, {
      prescribedSectionMarks: ctx.prescribedSectionMarks,
      cogTolerance: isLanguages ? 0 : 1,
      sectionTolerance: isLanguages ? 0 : 1,
    });
    const validation = assertResource(resource);

    lastResult = { resource, validation, rebalance, model: SONNET_4_6, ctx, attempts: attempt + 1, usageByAttempt: [...usageByAttempt] };

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
 *   • The `lesson` branch is the deepest nested top-level branch (phases,
 *     slides, vocabulary, etc.) and Sonnet stringifies it more reliably
 *     than meta/cover/memo. Without unwrapping, assertResource passes
 *     spuriously (a non-empty string is truthy, defeating !lesson) and
 *     the renderer's conditional sections all return [] (because string
 *     properties are undefined), producing a "lesson plan" with only the
 *     headers and no body — and a missing PPTX (slides=undefined→empty).
 *     Same for lesson.phases / lesson.slides — they may come back as
 *     stringified arrays, so we recurse one level into the lesson branch
 *     too.
 */
function unwrapStringifiedBranches(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const TOP_KEYS = ['meta', 'cover', 'stimuli', 'sections', 'memo', 'lesson'];
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

  // Recurse one level into the lesson branch's array properties — same
  // stringification pattern but at one extra depth. Also coerce non-array
  // values back to [] so the lesson renderer's array iterators don't crash.
  if (obj.lesson && typeof obj.lesson === 'object') {
    for (const k of ['phases', 'slides', 'learningObjectives', 'priorKnowledge', 'vocabulary', 'materials', 'teacherNotes']) {
      if (typeof obj.lesson[k] === 'string') {
        try {
          const parsed = JSON.parse(obj.lesson[k]);
          if (Array.isArray(parsed)) obj.lesson[k] = parsed;
        } catch { /* fallthrough */ }
      }
    }
    if (Array.isArray(obj.lesson.phases)) obj.lesson.phases = obj.lesson.phases.map(unwrapItem);
    if (Array.isArray(obj.lesson.slides)) obj.lesson.slides = obj.lesson.slides.map(unwrapItem);
    // capsAnchor is a single object, not an array — handle the rare case
    // where Sonnet stringifies it directly.
    if (typeof obj.lesson.capsAnchor === 'string') {
      try {
        const parsed = JSON.parse(obj.lesson.capsAnchor);
        if (parsed && typeof parsed === 'object') obj.lesson.capsAnchor = parsed;
      } catch { /* fallthrough */ }
    }
  }

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
  buildTargetedRemediation,
  // CAPS-pacing prompt formatters — pure, exposed for tests.
  formatSubtopics,
  formatPacingUnit,
  formatFormalAssessmentStructure,
  buildCapsReferenceBlock,
  buildAssessmentStructureBlock,
  buildSystemPrompt,
  buildUserPrompt,
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

  // Hard wall-clock ceiling on the whole generation pipeline. Aborting
  // here surfaces a clear "took longer than expected" error instead of
  // letting the heartbeat mask an indefinite hang.
  //
  // Final Exam needs a longer ceiling: full-year scope + 32k output budget
  // means a single Anthropic call can run ~5-6 min on its own. Other
  // resource types finish well inside 5.5 min even with two schema
  // retries (240s × 3 = 12 min worst case, but real failures abort earlier
  // because each attempt's 240s timeout fires).
  const isFinalExamReq = parsed.resourceType === 'Final Exam';
  const HARD_TIMEOUT_MS = isFinalExamReq ? 7 * 60 * 1000 : 5.5 * 60 * 1000;
  const hardTimeoutMinutes = HARD_TIMEOUT_MS / 60000;
  const hardTimeout = setTimeout(() => {
    log.warn({ cacheKey, hardTimeoutMinutes }, 'generate: hard timeout — aborting');
    abort.abort(new Error('TIMEOUT_GEN'));
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
      err?.message === 'TIMEOUT_GEN' ||
      abort.signal.reason?.message === 'TIMEOUT_GEN';
    const timeoutMinutes = isFinalExamReq ? 7 : 5;
    const surfaced = isHardTimeout
      ? Object.assign(
          new Error(`Generation took longer than ${timeoutMinutes} minutes. Final Exams sometimes hit this; please try again, or generate a Term Test instead which is faster.`),
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
  // subtopicHeading optionally narrows the lesson focus to one top-level
  // subtopic of the chosen Unit (so a 6h Unit can be split into ~6 distinct
  // 45-min lessons instead of N nearly-identical "introduction" lessons).
  if (resourceType === 'Lesson') {
    parsed.unitId = str(body.unitId, { field: 'unitId', max: 200 });
    parsed.lessonMinutes = int(body.lessonMinutes, {
      field: 'lessonMinutes', required: false, min: 20, max: 120,
    }) || 45;
    parsed.subtopicHeading = str(body.subtopicHeading, {
      field: 'subtopicHeading', required: false, max: 500,
    }) || null;
    // Optional seriesContext: when the frontend is orchestrating a series
    // of lessons (Phase B), each call posts the lesson's position + the
    // headings already covered, so the prompt can ask the model to build
    // on prior knowledge rather than re-teach an introduction every time.
    parsed.seriesContext = parseSeriesContext(body.seriesContext);
  }
  return parsed;
}

/**
 * Validate the optional seriesContext sub-object posted with a Lesson
 * generation. Returns null when missing/invalid (graceful fallback to
 * single-lesson behaviour) or { position, total, priorSubtopics } when
 * well-formed. Tight bounds prevent abuse — series of 30+ lessons would
 * exceed the rate limit anyway, so 20 is a comfortable upper bound.
 */
function parseSeriesContext(input) {
  if (!input || typeof input !== 'object') return null;
  const position = Number(input.position);
  const total = Number(input.total);
  if (!Number.isInteger(position) || !Number.isInteger(total)) return null;
  if (position < 1 || total < 1 || position > total || total > 20) return null;
  const prior = Array.isArray(input.priorSubtopics) ? input.priorSubtopics : [];
  // Cap and sanitise prior headings — strings only, max 30 entries, max
  // 500 chars each (matches the subtopicHeading cap).
  const priorSubtopics = prior
    .slice(0, 30)
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s) => String(s).trim().slice(0, 500));
  return { position, total, priorSubtopics };
}

function buildFilename({ subject, resourceType, grade, term }) {
  return `${subject}-${resourceType}-Grade${grade}-Term${term}`.replace(/[^a-zA-Z0-9\-]/g, '-') + '.docx';
}

// Cache key derived from the canonical request fields. Order is fixed so
// two requests with the same params produce the same key regardless of
// JSON property order. Bumping the version prefix invalidates the whole
// cache when the response shape changes (DOCX renderer upgrades, _meta
// additions). Lesson requests include unitId + lessonMinutes +
// subtopicHeading so two different lessons in the same subject/grade/term
// don't collide.
function buildCacheKey({
  subject, grade, term, language, resourceType, totalMarks, difficulty,
  unitId, lessonMinutes, subtopicHeading, seriesContext,
}) {
  const norm = { subject, grade, term, language, resourceType, totalMarks, difficulty };
  if (resourceType === 'Lesson') {
    norm.unitId = unitId || null;
    norm.lessonMinutes = lessonMinutes || null;
    norm.subtopicHeading = subtopicHeading || null;
    // Series context changes the prompt (prior-subtopics list, position
    // in the sequence) so series lessons must not collide with
    // single-lesson cache entries for the same Unit + subtopic. Pull
    // only the fields that actually shape the prompt; cap the prior list
    // by stable join so re-orderings of the same set still hit the same key.
    if (seriesContext && seriesContext.total > 1) {
      norm.seriesPosition = seriesContext.position;
      norm.seriesTotal    = seriesContext.total;
      norm.seriesPrior    = (seriesContext.priorSubtopics || []).join('|');
    }
  }
  // v6 adds the Phase B slide-layout variety enum (warmUp / wordWall /
  // thinkPairShare / workedExample / yourTurn / celebrate). Old v5 entries
  // were generated against the 8-layout enum and don't carry the new
  // layouts, so re-serving them after the prompt has been updated would
  // permanently rob those teachers of the variety. Bumping invalidates
  // the whole cache once.
  //
  // Cache version history:
  //   v2 — pre-Lesson baseline
  //   v3 — added `lesson` to top-level required[] for Lesson narrowing
  //   v4 — added `subtopicHeading`
  //   v5 — added `seriesPosition` / `seriesTotal` / `seriesPrior`
  //   v6 — Phase B slide-layout variety (current)
  return `gen:v6:${JSON.stringify(norm)}`;
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
