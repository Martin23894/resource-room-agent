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
3. Every question must have: number (Q1, Q2...), type, topic (see Topic Coverage rules below), marks (whole number ≥ 1), cogLevel
4. Questions must sum to EXACTLY ${totalMarks} marks
5. Minimum ${isWorksheet ? '4' : '6'} questions.

TOPIC COVERAGE RULES — strict and non-negotiable:
   A. The "topic" field on EACH question MUST be copied VERBATIM from the
      ATP list above. Do NOT paraphrase, summarise, or shorten an ATP entry.
      Do NOT split one ATP entry into multiple variant strings (e.g. do NOT
      label one question "barter system" and another "paper money" if BOTH
      come from the SAME ATP entry on the history of money). The validator
      counts distinct ATP ENTRIES, not distinct topic strings, so labelling
      tricks will not pass.
   B. The plan MUST use at least ${minDistinctTopics} distinct ATP entr${minDistinctTopics === 1 ? 'y' : 'ies'}.
      Each question's "topic" must match a DIFFERENT ATP entry wherever
      possible. Do not concentrate the whole paper on one ATP entry.
   C. No single ATP entry may account for more than ${maxMarksPerTopic} marks
      (half the paper). Spread the mark budget across ATP entries.
   D. Prefer breadth over depth: a CAPS assessment tests the whole prescribed
      scope, not one chapter. Aim to touch every major ATP entry at least
      once before loading extra marks onto any single one.

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

MARK vs SCOPE DISCIPLINE — non-negotiable:
Each mark on a question = ONE discrete markable action (one fact stated,
one point argued, one calculation step, one piece of evidence). Do NOT
compress multiple tasks into a low-mark question just because the plan
assigns a high cognitive level.

Instruction verbs imply minimum mark allocations:
- "Name / State / List / Identify / Give ONE" → 1 mark is fine
- "Describe briefly" → at least 2 marks
- "Explain" → at least 2 marks (3+ if it requires linking two concepts)
- "Compare", "Analyse", "Evaluate", "Justify with evidence" → at least 3 marks each
- "Discuss", "To what extent" → at least 4 marks

At ≤ 2 marks, ask for AT MOST TWO discrete actions in the question stem.
Three or more discrete actions ALWAYS require ≥ 3 marks AND splitting into
labelled sub-parts (a) (b) (c) — never compress 3+ verbs into 2 marks.

A "discrete action" is anything that earns its own mark: identify, explain,
compare, evaluate, justify, name an example, give a reason. If you find
yourself stringing them with "and" or "then" inside one question stem at
≤ 2 marks, the scope is too large — either drop a verb or split the
question into sub-parts at higher mark value.

If the plan assigns a question 2 marks at a high cognitive level, write a
FOCUSED 2-mark high-order question — a single analytical claim to support,
or a single justification to give. The cognitive LEVEL is set by HOW the
learner must think (recall vs reason vs evaluate), NOT by stacking multiple
instruction verbs in one prompt.

If a question's mark value is 3 or more AND the natural response requires
multiple discrete actions, BREAK IT INTO LABELLED SUB-PARTS (a) (b) (c)
with individual mark allocations that SUM to the parent question's plan
mark value. Example:

  7.1 Study the two statements and answer the following. (4)
      (a) Identify who held power under the colonial system. (1)
      (b) Explain how that power shaped each person's experience. (2)
      (c) Which statement gives a more reliable picture? (1)

SUB-PART MARK RULE — non-negotiable (Bug 11 prevention):
When you split a question into (a) (b) (c) sub-parts, EVERY sub-part MUST
end with its own (X) mark. The PARENT line keeps the total (X) and acts
ONLY as a header. The sub-part marks MUST sum to the parent total.

  CORRECT (parent = sum of sub-parts; both halves of the contract present):
    8.1 Bereken: (2)
        (a) 6 254 + 3 879 − 2 456 (1)
        (b) 18 × 250 + 500 (1)

  WRONG — DO NOT WRITE IT THIS WAY (parent says 2 marks, sub-parts have
  no marks at all — the memo will mis-allocate marks across (a)(b)):
    8.1 Bereken: (2)
        (a) 6 254 + 3 879 − 2 456
        (b) 18 × 250 + 500

  Also WRONG (each sub-part claims the full parent value, total exceeds parent):
    8.1 Bereken: (2)
        (a) 6 254 + 3 879 − 2 456 (2)
        (b) 18 × 250 + 500 (2)

If you can't split the parent's mark across the sub-parts, do NOT use
sub-parts — write ONE question with ONE (X) mark.

NEVER write a question like: "(2) Identify X, explain Y, compare Z, and
justify W." That is 4 tasks for 2 marks — impossible to mark fairly and
overwhelms the learner. If you catch yourself writing three or more
instruction verbs in one question stem at 3 marks or less, split it.

COGNITIVE LEVEL OF SPECIFIC QUESTION TYPES — non-negotiable:
The following question shapes are PURE RECALL and MUST be tagged at the
LOWEST cognitive level (Knowledge / Literal / Low Order — whichever applies
for this subject's framework):
- One-word fill-in-the-blank with a single recall answer (e.g. "Coal, oil
  and gas are examples of _____ fuels")
- Identifying a known figure of speech in a sentence (simile, metaphor,
  personification, alliteration)
- Giving a synonym or antonym for a single word
- Naming a known item, place, person, or term that the learner is expected
  to recall directly from the curriculum

Even if these questions touch a topic that "feels" higher-order (mains
electricity, language analysis), the COGNITIVE TASK on the learner is
recall. Tagging them as Middle / Inferential / Evaluation is a category
error and will be flagged in moderation.

DO NOT INCLUDE:
- NO cover page, title, header, name/date fields, or instructions — start DIRECTLY with Question 1 or SECTION A
- NO cognitive level labels in the learner paper
- NO notes, commentary, or meta-text of any kind
- NO marking-rubric guidance on the learner paper (e.g. "Award 1 mark for…", "Up to 2 marks for content", "Deduct marks if…"). Marking rubrics belong ONLY in the memo, never in the question paper.

SCENARIO COHERENCE — non-negotiable:
When a question opens with a SCENARIO or stimulus paragraph (e.g. "Zanele
plans a road trip from Johannesburg to Cape Town. She drives 248 km on
Day 1…"), EVERY sub-question under that scenario MUST refer to objects,
people, or quantities in that scenario. Do NOT graft an unrelated stub
onto the scenario (e.g. inside a road-trip scenario do NOT ask "If 1
metre of fabric costs R15…"). If a question doesn't fit the scenario,
move it to a new question with its own context — never share a scenario
heading with an unrelated calculation.

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
- MCQ: ALWAYS write the question stem FIRST on its own line, ending with the (X) mark. THEN list ALL FOUR options a. / b. / c. / d. in order on consecutive lines. THEN one answer line. Never split options across the stem.

  CORRECT layout:
    1.1 Which gas is most abundant in air? (1)
    a. Oxygen
    b. Carbon dioxide
    c. Nitrogen
    d. Hydrogen
    ${L?.answerLabel || 'Answer'}: _______________________________________________

  WRONG — DO NOT WRITE LIKE THIS (options before the stem, or option d. dropped after the stem):
    a. Oxygen
    b. Carbon dioxide
    c. Nitrogen
    ${L?.answerLabel || 'Answer'}: _______________________________________________
    Which gas is most abundant in air? (1)
    d. Hydrogen

  The CORRECT order is ALWAYS: stem → a → b → c → d → answer line. Never put any option above its stem. Never put the answer line above option d.

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
${isExamType ? `- USE SECTION A / B / C / D headers — the letters MUST run
  CONSECUTIVELY (A then B then C then D, no gaps, no skips). It is NOT
  acceptable to write SECTION A, then unlabelled question groups, then
  SECTION C — every group of questions must sit under a section header,
  and the headers must be sequential. If you only have three sections,
  use A / B / C (not A / B / D and not A / C / D — Bug 22 prevention).` : ''}
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

SUB-PART MARK RULE (Bug 11): If a parent line shows "(N)" marks AND has
labelled sub-parts (a)(b)(c) WITHOUT their own bracketed marks, the
parent (N) covers ALL sub-parts together — the per-sub-part rows in the
memo MUST sum to N, NOT be N each. Read the marks off the QUESTION
PAPER line — never invent sub-part marks the paper doesn't show.

Example (parent has 2 marks, two sub-parts with no own marks):
  Paper:
    8.1 Bereken: (2)
        (a) 6 254 + 3 879 − 2 456
        (b) 18 × 250 + 500
  Memo (correct — split the 2 evenly):
    | 8.1(a) | 7 677 | working | Routine Procedures | 1 |
    | 8.1(b) | 5 000 | working | Routine Procedures | 1 |
  Memo (WRONG — Bug 11 leak):
    | 8.1(a) | 7 677 | working | Routine Procedures | 2 |
    | 8.1(b) | 5 000 | working | Routine Procedures | 2 |

After the table write: ${L.totalLabel}: ${actualTotal} ${L.marksWord}
Do NOT write the cognitive level analysis table, extension activity, or rubric here.
Return JSON: {"content":"memorandum table and TOTAL line only"}`;

  const mUsrB = (memoTable, actualTotal) => `Grade ${g} ${subject} — ${resourceType} — Term ${t}

Completed memorandum table (${actualTotal} marks total):
${memoTable}

YOUR TASK: Write the following sections based on the table above.

SECTION: COGNITIVE LEVEL ANALYSIS (${taxLabel})
Write this pipe table. The Prescribed Marks column is GIVEN — copy these
numbers VERBATIM, do NOT recompute them and do NOT use the percentages as
mark values. The Prescribed Marks numbers below ALREADY add up to ${actualTotal}.

Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual %
${cog.levels.map((l, i) => l + ' | ' + cog.pcts[i] + '% | ' + cogMarks[i] + ' | <fill> | <fill>').join('\n')}
${L.totalLabel || 'TOTAL'} | 100% | ${actualTotal} | ${actualTotal} | 100%

For EACH non-total row, FILL the Actual Marks and Actual % cells:
- Actual Marks = add up the MARK column from the memo table above for every
  row whose COGNITIVE LEVEL exactly matches this row's level. Do the addition
  silently — do NOT show the sum, do NOT show the question list inside the table.
- Actual % = (Actual Marks ÷ ${actualTotal}) × 100, rounded to 1 decimal place.
- The four Actual Marks values MUST sum to EXACTLY ${actualTotal}. Recheck the sum
  before emitting the table. If it does not sum to ${actualTotal}, fix the per-level
  sums — do NOT change the Prescribed Marks column to make it balance.
- Do NOT add a "this paper does not meet…" note. Just emit the numbers.

Then write ONE summary line per level:
[Level] ([X] marks): Q1.1 (1) + Q2.3 (2) + ... = [X] marks

${includeRubric ? `SECTION: MEMO MARKING RUBRIC — TEACHER USE ONLY
Bug 15 ordering: this rubric MUST be written BEFORE the extension activity
so it is unambiguously paired with the memo answer table. The rubric is a
TEACHER reference for the WHOLE PAPER. It must NOT be presented as if it
applies to the extension activity below.

Heading must read EXACTLY: "MEMO MARKING RUBRIC — TEACHER USE ONLY"
(or in Afrikaans: "MEMO NASIENRUBRIEK — SLEGS VIR ONDERWYSER").

Then a pipe table with these columns:
CRITERIA | Level 5 Outstanding (90-100%) | Level 4 Good (75-89%) | Level 3 Satisfactory (60-74%) | Level 2 Needs Improvement (40-59%) | Level 1 Not Achieved (0-39%)
Write 3-4 subject-relevant criteria rows for ${subject}.` : ''}

${!isWorksheet ? `SECTION: EXTENSION ACTIVITY
Write one challenging question beyond the paper scope. Include the
complete step-by-step model answer. The model answer is FOR THE TEACHER —
do NOT include any rubric, marking guidance, or "Award N marks for X"
text inside the extension activity.` : ''}

Return JSON: {"content":"cognitive level analysis + rubric + extension"}`;

  return {
    planSys, planUsr,
    qSys, qUsr,
    mSys, mUsrA, mUsrB,
    taxLabel,
  };
}
