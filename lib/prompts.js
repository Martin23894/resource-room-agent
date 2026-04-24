// Prompt builders for the standard (non-RTT) generation pipeline.
//
// These were previously inlined in api/generate.js. Moving them here makes
// them easier to read and tune without scrolling past 500 lines of handler
// code. The Response-to-Text pipeline has its own section-level prompts that
// currently stay inside generate.js — they can follow later.

import { i18n } from './i18n.js';
import { buildGuidanceBlock } from './validate.js';

/**
 * Build the full prompt set for one standard generation request.
 * `ctx` bundles the request state the prompts need. Returns an object with:
 *   planSys, planUsr           — Phase 1 (plan)
 *   qSys(plan), qUsr(plan)     — Phase 2 (question paper)
 *   mSys                       — Phase 3 system prompt
 *   mUsrA(qp, actualTotal, ref), mUsrB(memoTable, actualTotal) — Phase 3A/3B
 *   taxLabel                   — "Bloom's Taxonomy" or "Barrett's Taxonomy"
 */
export function buildPrompts(ctx) {
  const {
    subject, topic,       // eslint-disable-line no-unused-vars
    resourceType, language,
    grade, term, totalMarks,
    phase,
    difficulty,           // eslint-disable-line no-unused-vars
    diffNote,
    includeRubric,
    isWorksheet, isTest, isExamType,
    cog, cogMarks, cogTolerance,
    isBarretts,
    atpTopicList, topicInstruction,
    atpTopics = [],       // the array form — used to size the topic-diversity rule
    teacherGuidance,      // optional pre-prompt from the config panel
  } = ctx;

  // Pre-prompt block — prepended to the user message on the plan + write
  // phases only. Memo/verify prompts are mechanical derivatives of the
  // already-generated paper, so additional guidance there adds no value.
  const guidancePrefix = buildGuidanceBlock(teacherGuidance);

  // Topic-diversity thresholds — must match lib/plan.js planContext() so
  // the prompt's rule and the validator's check agree. If these drift the
  // validator rejects plans that the prompt said were fine.
  const minDistinctTopics = atpTopics.length >= 3 ? 3 : Math.max(1, atpTopics.length);
  const maxMarksPerTopic = Math.ceil(totalMarks * 0.5);

  const g = grade;
  const t = term;
  const L = i18n(language);
  const taxLabel = isBarretts ? "Barrett's Taxonomy" : "Bloom's Taxonomy (DoE cognitive levels)";

  const planSys = `You are a South African CAPS ${phase} Phase assessment designer.
Return ONLY valid JSON — no markdown, no explanation.
Schema: {"questions":[{"number":"Q1","type":"MCQ","topic":"string","marks":5,"cogLevel":"${cog.levels[0]}"},...]}
cogLevel must be exactly one of: ${cog.levels.join(' | ')}`;

  const planUsr = `${guidancePrefix}Design a ${totalMarks}-mark ${resourceType} question plan for: Grade ${g} ${subject} Term ${t} in ${language}.

${topicInstruction}

${taxLabel} cognitive level targets — marks must hit each level within ±${cogTolerance} marks:
${cog.levels.map((l, i) => `  ${l}: ${cogMarks[i]} marks (${cog.pcts[i]}%)`).join('\n')}

QUESTION TYPE RULES — strict and non-negotiable:
1. MCQ and True/False questions are LOW DEMAND — they address recall only.
   Total marks from MCQ + True/False combined must NOT exceed ${cogMarks[0]} marks.
   MCQ and True/False can ONLY serve the "${cog.levels[0]}" level.

2. The following levels MUST use higher-order question types:
${cog.levels.slice(1).map((l, i) => '   "' + l + '": use ' + (i === 0 ? 'Short Answer, Structured Question, Fill in the blank, Calculations' : i === cog.levels.length - 2 ? 'Multi-step, Structured Question, Analysis, Problem-solving' : 'Word Problem, Extended Response, Essay, Investigation')).join('\n')}
3. Every question must have: number (Q1, Q2...), type, topic (MUST be one of the ATP topics above — copy wording verbatim where possible), marks (whole number ≥ 1), cogLevel
4. Questions must sum to EXACTLY ${totalMarks} marks
5. Minimum ${isWorksheet ? '4' : '6'} questions.

TOPIC COVERAGE RULES — strict and non-negotiable:
   A. The plan MUST use at least ${minDistinctTopics} distinct topic${minDistinctTopics === 1 ? '' : 's'} from the ATP list.
      Assign each question's "topic" field to a DIFFERENT ATP entry wherever
      possible. Do not concentrate the whole paper on one topic.
   B. No single topic may account for more than ${maxMarksPerTopic} marks
      (half the paper). Spread the mark budget across topics.
   C. Prefer breadth over depth: a CAPS term assessment tests the whole term's
      work, not one chapter. Aim to touch every major ATP topic area at least
      once before loading extra marks onto any single topic.

Return only the JSON object, nothing else.`;

  const mathsRange = subject.toLowerCase().includes('math') || subject.toLowerCase().includes('wiskunde')
    ? `MATHS NUMBER RANGE RULE FOR GRADE ${g}:
${g <= 4 ? '- Use numbers up to 4-digit (up to 9,999). Do NOT use 5-digit or larger numbers.' : ''}${g === 5 ? '- Use numbers up to 6-digit (up to 999,999). Do NOT use 7-digit or larger numbers.' : ''}${g === 6 ? `- Use numbers up to 9-digit where CAPS requires it, but VARY your number sizes:
  * Some questions must use small numbers (hundreds: 100–999)
  * Some questions must use medium numbers (thousands: 1,000–99,999)
  * Some questions must use large numbers only where CAPS explicitly requires it (up to 9 million max for Grade 6 tests)
  * Do NOT use numbers in the hundreds of millions (100,000,000+) — these are too large for Grade 6 tests
  * Whole number place value may go to 9-digit for ordering/comparing ONLY` : ''}${g === 7 ? '- Use numbers appropriate for Grade 7 — whole numbers up to 9-digit where needed, decimals to 3 places, fractions with mixed numbers. Vary sizes — not all numbers should be in the millions.' : ''}`
    : '';

  const qSys = () => `You are a South African CAPS ${phase} Phase teacher writing a ${resourceType} question paper in ${language}.
Use SA context (rands, names: Sipho, Ayanda, Zanele, Thandi, Pieter, Anri, SA places like Johannesburg, Cape Town, Durban, Pretoria).
DIFFICULTY: ${diffNote}
CAPS: Grade ${g} Term ${t} ${subject}

CRITICAL TOPIC RULE — NON-NEGOTIABLE:
This assessment covers ONLY these CAPS-prescribed topics for Grade ${g} ${subject}:
- ${atpTopicList}
Do NOT include questions on topics from other terms. This is a CAPS compliance requirement.
Every question topic field in the plan maps to this list — trust the plan.

CRITICAL: Follow the question plan EXACTLY.
- Do not change any mark values.
- Do not add or remove questions.
- Every question's "cogLevel" in the plan is MANDATORY. If the plan says Q5 is "${cog.levels[cog.levels.length - 1]}", then Q5 MUST be written at that cognitive level — use a genuinely higher-order question type (multi-step, analysis, problem-solving, extended response). Do NOT silently downgrade to a simpler question because the topic feels easier.
- A paper with 0 marks at any prescribed level is NOT CAPS-compliant. Honour every level in the plan.
The plan guarantees CAPS cognitive level compliance — trust it and write accordingly.

DO NOT INCLUDE:
- NO cover page, title, header, name/date fields, or instructions — start DIRECTLY with Question 1 or SECTION A
- NO cognitive level labels in the learner paper
- NO notes, commentary, or meta-text of any kind

NO DIAGRAMS RULE (applies to ALL subjects — non-negotiable):
This system cannot render diagrams, graphs, drawings, or images.
Do NOT write any question requiring the learner to look at a drawn diagram, drawn shape, drawn graph, drawn map, or drawn image.
INSTEAD use text-only alternatives:
- Angles: provide the value → "An angle measures 65°. Classify this angle."
- Shapes: describe dimensions in words → "A rectangle is 10 cm long and 4 cm wide."
- Graphs/charts: provide data as a text table using pipe format
- Maps/scenarios: describe in words → "A garden is 14 m long and 9 m wide."
- Food webs/circuits/ecosystems: describe relationships in words or use a text table
This rule applies to EVERY subject. No exceptions.

FORMAT RULES:
- Numbering: Question 1: [heading] then 1.1, 1.2, 1.2.1 etc.
- EVERY sub-question MUST show its mark in brackets (X) on the SAME LINE as the question text
- Question block totals: [X] right-aligned at end of each question block

ANSWER SPACE RULES — apply to EVERY sub-question, non-negotiable:
- MCQ: show (1) on the question line BEFORE the a. b. c. d. options. After the LAST option (d.), add one answer line:
    Answer: _______________________________________________
- True/False: statement then blank then (marks) all on ONE line. No answer line.
- Fill-in-the-blank: the question sentence contains the blank (e.g. "The capital of Gauteng is ____________."). No extra line.
- Matching: present as a two-column pipe table. No answer line.
- Short answer / naming / labelling / one-word (1-2 marks): leave ONE blank line immediately after the question:
    _______________________________________________
- Descriptive / "Describe" / "Explain" / "Give reasons" (2-4 marks): leave TWO blank lines after the question.
- Multi-part list (e.g. "List the eight planets" / "Name four biomes"): leave as many blank lines as the question asks items for, or a minimum of TWO.
- Long-answer / paragraph / extended explanation (5+ marks): leave FOUR blank lines after the question.
- Calculation (numeric answer): include a "Working:" line followed by an "Answer:" line:
    Working: _______________________________________________
    Answer: _______________________________________________

Every blank answer line is EXACTLY this: _______________________________________________
${isTest ? '- NO SECTION headers. Use Question 1, Question 2 etc.' : ''}
${isExamType ? '- USE SECTION A / B / C / D headers' : ''}
- Write fractions as plain text: 3/4 not ¾
- No Unicode box characters or Unicode fraction symbols

ORDERING QUESTION RULE:
- Never include two values that are mathematically equal
- Convert ALL values to decimals to verify all are distinct before writing

${mathsRange}

NO DIAGRAMS rule: Do not write "Use the diagram/graph/map/figure below."
End with: ${L.totalLabel}: _____ / ${totalMarks} ${L.marksWord}
Return JSON: {"content":"question paper text only"}`;

  const qUsr = (plan) => `${guidancePrefix}Write the question paper following this EXACT plan:
${JSON.stringify(plan.questions, null, 2)}

Subject: ${subject} | Grade: ${g} | Term: ${t} | Language: ${language}
${topicInstruction}
Total must be: ${totalMarks} marks`;

  const mSys = `You are a South African CAPS Grade ${g} ${subject} teacher creating a memorandum in ${language}.
Use pipe | tables only. No Unicode box characters. Write fractions as plain text.
Output ONLY the memorandum content — no headings like "STEP 1", "CORRECTED", "Updated" etc.
No reasoning, notes or adjustments outside tables. Generate each cognitive level table ONCE only.
Do NOT question or adjust mark allocation — use marks exactly as shown in the paper.

NO COMPLIANCE NOTES — non-negotiable:
- Do NOT add warning notes, compliance notes, distribution notes, or ⚠ paragraphs.
- If the Actual Marks per cognitive level differ from the Prescribed Marks, just report the actual numbers in the table. Do NOT explain the mismatch. Do NOT suggest revisions. Do NOT write "This paper does not meet…" or any similar commentary.
- The teacher does not want editorial notes — only the memo tables.

WRITE EACH TABLE ONCE — non-negotiable:
- Emit the Cognitive Level Analysis table exactly once. Do NOT write it, recount, and rewrite it.
- If you realise a mark is off while writing, silently do the arithmetic first and then emit the FINAL correct table only.
- Do NOT include phrases like "was not listed", "confirmed sum", "[remaining N marks]", "but Middle Order recount", or any other "thinking out loud" about your own counts.
- Do NOT use markdown bold (**TOTAL**, **100%**) inside table cells — cells must be plain text.

COGNITIVE FRAMEWORK: ${taxLabel}
Levels used: ${cog.levels.join(', ')}

MEDIAN RULE: Sort ALL values from smallest to largest first. Count total n.
If n is odd: median = value at position (n+1)/2.
If n is even: median = average of values at positions n/2 and (n/2)+1.
Count position by position — do not skip repeated values.

STEM-AND-LEAF COUNT RULE: Count every individual leaf digit. Write count per stem, then add them.

DECIMAL ROUNDING RULE: Round non-terminating decimals to 1 decimal place. Use same value throughout.

COGNITIVE LEVEL TABLE RULE: Fill the table by mechanically adding MARK values per level from the memo rows above.
Actual Marks for each level MUST equal the sum of that level's rows. All Actual Marks MUST sum to the paper total.

Return JSON: {"content":"memorandum text"}`;

  const mUsrA = (qp, actualTotal, cogLevelRef) => `Grade ${g} ${subject} — ${resourceType} — Term ${t}

Question paper:
${qp}

This paper totals ${actualTotal} marks.

COGNITIVE LEVEL REFERENCE (${taxLabel}) — copy these exactly, do not change:
${cogLevelRef}

YOUR ONLY TASK: Write the MEMORANDUM TABLE.
Columns: ${L.memo.no} | ${L.memo.answer} | ${L.memo.guidance} | ${L.memo.cogLevel} | ${L.memo.mark}

- List EVERY SINGLE sub-question from the paper — scan every question block
- Include ALL sub-parts (e.g. 5.1a, 5.1b)
- Do NOT skip any question
- Use the EXACT (X) mark shown on each question line
- Copy ${L.memo.cogLevel} from the reference above — do not reassign
- For financial questions: income > cost = PROFIT; cost > income = LOSS
- For stem-and-leaf: count every leaf individually

After the table write: ${L.totalLabel}: ${actualTotal} ${L.marksWord}
Do NOT write the cognitive level analysis table, extension activity, or rubric here.
Return JSON: {"content":"memorandum table and TOTAL line only"}`;

  const mUsrB = (memoTable, actualTotal) => `Grade ${g} ${subject} — ${resourceType} — Term ${t}

Completed memorandum table (${actualTotal} marks total):
${memoTable}

YOUR TASK: Write the following sections based on the table above.

SECTION: COGNITIVE LEVEL ANALYSIS (${taxLabel})
Write this pipe table:
Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual %
${cog.levels.map((l, i) => l + ' | ' + cog.pcts[i] + '% | ' + cogMarks[i]).join('\n')}

For EACH row:
- Actual Marks = add up MARK column from memo table for all rows where COGNITIVE LEVEL matches
- Actual % = (Actual Marks ÷ ${actualTotal}) × 100, rounded to 1 decimal place
- All Actual Marks MUST sum to ${actualTotal}

Then write ONE summary line per level:
[Level] ([X] marks): Q1.1 (1) + Q2.3 (2) + ... = [X] marks

${!isWorksheet ? `SECTION: EXTENSION ACTIVITY
Write one challenging question beyond the paper scope. Include complete step-by-step model answer.` : ''}

${includeRubric ? `SECTION: MARKING RUBRIC
CRITERIA | Level 5 Outstanding (90-100%) | Level 4 Good (75-89%) | Level 3 Satisfactory (60-74%) | Level 2 Needs Improvement (40-59%) | Level 1 Not Achieved (0-39%)
Write 3-4 subject-relevant criteria rows for ${subject}.` : ''}

Return JSON: {"content":"cognitive level analysis + extension + rubric"}`;

  return {
    planSys, planUsr,
    qSys, qUsr,
    mSys, mUsrA, mUsrB,
    taxLabel,
  };
}
