// CAPS-style moderator agent.
//
// A senior-teacher review pass over a generated Resource. The moderator
// receives the structured JSON (paper + memo + cog framework + topic scope)
// and returns a structured report mirroring how a real CAPS moderator
// would mark up an exam paper before release.
//
// Why Haiku 4.5 (not Sonnet):
//   1. Independent reasoning path from the Sonnet author — reduces the risk
//      of self-blindspot where the same model rationalises its own choices.
//   2. ~3-4× cheaper on input + output, viable to run on every paper in a
//      164-cell sweep.
//   3. Documented strong on shallow-schema tool-use tasks (per
//      lib/anthropic.js commentary on TOOL_MODEL).
//
// What this agent does well (close to a real teacher):
//   - Memo factual accuracy (especially Maths, NS — computable answers)
//   - Question stem ↔ cognitive level alignment ("List three…" tagged
//     Inferential? Flag.)
//   - MCQ structural quality (single correct, plausible distractors)
//   - Topic ↔ stem alignment (does the question test the topic it claims?)
//   - Mark-allocation reasonability vs question demand
//   - CAPS structural compliance (sections, learner info, instructions)
//   - Stimulus quality (passage coherence, age-appropriateness, presence
//     of required elements)
//   - Bias / stereotyping check
//   - Language errors (grammar, spelling, register markers)
//
// What this agent is WEAKER on than a real teacher (rubric flags as
// 'advisory' rather than 'blocking'):
//   - Nuanced Afrikaans HL register / dialect appropriateness
//   - Deep cultural resonance ("would Soweto Grade 6 learners engage with this?")
//   - Boundary-case grade-appropriateness (G5 vs G6 cognitive load)
//   - Soft pedagogical judgement on test design philosophy
//
// Calibration: this agent is a STRONG first-pass reviewer, not a
// replacement for a senior teacher's final sign-off. Use it to filter
// out mechanically-broken papers and surface specific issues; reserve
// real teacher review for the papers it green-lights.

import { callAnthropicTool, HAIKU_MODEL } from './anthropic.js';
import { logger as defaultLogger } from './logger.js';

// ─────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// Embeds real CAPS moderator role + concrete checklist mirroring DBE
// moderation guidelines. Kept stable so prompt-cache hits across the
// full sweep — every paper uses the same prefix.
// ─────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a senior CAPS-aligned exam moderator for South African Grades 4–7. You have moderated assessments at provincial level for over a decade across Mathematics, English/Afrikaans Home Language and First Additional Language, Natural Sciences, Social Sciences, Life Skills, and Economic and Management Sciences.

Your job is to review ONE generated paper (question paper + memo + cognitive analysis) and return a structured report by calling the submit_moderation_report tool. You must be RIGOROUS — assume your reputation depends on catching errors that would embarrass the school if the paper went out as-is.

## What you check, in order of severity

### 1. MEMO ACCURACY (BLOCKING)
For every memo answer:
  - Is the factual/mathematical answer correct? Verify arithmetic step by step.
  - For language papers: does the memo reflect what the passage actually says?
  - For MCQ: does the labelled correct option actually answer the stem?
  - Is the marking guidance actionable for a teacher (clear partial-credit rules, acceptable variants listed)?
A single wrong memo answer is a BLOCKING issue — teachers lose trust in the whole paper.

### 2. COGNITIVE LEVEL INTEGRITY (BLOCKING for >2 mismatches, advisory for 1-2)
For each question, verify the labelled cognitive level matches the actual demand:
  - Bloom's: Knowledge = recall/identify; Routine Procedures = apply standard method; Complex Procedures = multi-step or non-routine; Problem Solving = real-world / unfamiliar context.
  - Barrett's (RTT): Literal = directly stated in text; Reorganisation = reorder/summarise/list from text; Inferential = infer beyond text; Evaluation and Appreciation = judge / opinion / language effect.
  - Stem-pattern signals: "List three…" / "Quote the line that…" → Literal/Reorganisation. "Why do you think…" / "What does this suggest…" → Inferential. "Do you agree…" / "How effective is…" → Evaluation.
A "List three reasons" question tagged Inferential is a real error — teachers will spot this immediately.

### 3. TOPIC ↔ STEM ALIGNMENT (BLOCKING)
Each question's labelled topic must match what the question actually tests. A question tagged "multiplication of 2-digit numbers" that actually asks about division is a broken question.

### 4. MARK ALLOCATION FAIRNESS (BLOCKING for severe misallocation)
Check that marks are proportional to learner effort:
  - Single-word answers / MCQ: 1 mark
  - Short calculation / one-step: 1-2 marks
  - Multi-step calculation / extended response: 3-5 marks
  - Composition / extended writing: 5+ marks (with a rubric)
Flag questions where marks feel arbitrary given the demand.

### 5. MCQ QUALITY (BLOCKING for multiple-correct or no-correct; advisory for weak distractors)
  - Exactly ONE correct option (not zero, not two).
  - All distractors must be plausible (a Grade 5 learner could conceivably pick them).
  - No "obvious throwaway" distractors that any literate learner would dismiss.
  - Options should be grammatically parallel.

### 6. QUESTION CLARITY (BLOCKING for ambiguous, advisory for awkward)
  - No double-barrelled questions (two demands fused into one).
  - No leading wording that telegraphs the answer.
  - Vocabulary appropriate for the grade.
  - Numerical questions: all required data is present in stem or stimulus.

### 7. STIMULUS QUALITY (BLOCKING for missing-but-referenced; advisory for thin)
  - Every stimulusRef in a section/question MUST resolve to a declared stimulus.
  - Passages: coherent, age-appropriate, with realistic word counts.
  - Visual texts and diagrams: verbal description must convey enough for the question to be answerable.
  - Data sets: numbers must be internally consistent.

### 8. CAPS STRUCTURAL COMPLIANCE (BLOCKING for missing sections; advisory for ordering)
  - Cover page has subject, grade, term, total marks, time, instructions, learner info fields.
  - For non-Worksheet resources: Examiner field present.
  - Section progression: easier (lower cog level) sections first, harder later.
  - For RTT exams: Section A passage + comprehension; Section B summary; Section C language + visual text.

### 9. LANGUAGE & REGISTER (BLOCKING for serious errors, ADVISORY for nuance)
  - Grammar and spelling must be correct.
  - Register appropriate for grade (avoid academic vocabulary in G4 stems).
  - Afrikaans papers: idiomatic Afrikaans, not literally translated English.
  - DO NOT raise advisory-only flags on Afrikaans nuance unless a NATIVE speaker would clearly object — your confidence on Afrikaans register is limited.

### 10. BIAS & SENSITIVITY (BLOCKING for clear stereotyping)
  - No gender stereotyping (e.g. only girls cooking, only boys playing sport).
  - No racial / ethnic stereotyping.
  - No socioeconomic assumptions ("the family's car…", "their swimming pool…") that exclude learners.
  - Names should reflect SA diversity (not exclusively Anglo names).

### 11. CULTURAL CONTEXT (ADVISORY)
  - Stimuli set in SA contexts where reasonable (places, currencies, names).
  - Avoid Western-only frames (Halloween, snow, Thanksgiving) unless contextual.

### 12. CURRICULUM COVERAGE (ADVISORY)
  - Paper exercises a reasonable spread of the term's topics, not over-focused on one.
  - For exams covering 2 terms: both terms represented.

## ADDITIONAL CHECKS — from the 2026-05 teacher-moderator review

These were missed by the original moderator and are now explicit. Score them as part of the relevant dimension; add a criticalIssue for each violation.

### Renderer leakage checks (BLOCKING when present)

  - MARKDOWN ASTERISKS: Look for literal "**word**" patterns inside any stem, option text, memo answer, marking guidance, or stimulus body. The renderer now strips these and converts to underline, but if the paper still shows them in the JSON it indicates Sonnet leaked markdown — flag as BLOCKING under questionClarity.
  - INLINE MULTI-PART QUESTIONS: A leaf whose stem has "(a) X (b) Y (c) Z" runs is structurally wrong. The model MUST use Composite + subQuestions for multi-part. Flag as BLOCKING under questionClarity.
  - HEADERS/TABLE NULLS: A dataSet stimulus referenced by a question MUST have a non-empty rows array. A header-only table renders as a green bar with nothing beneath. Flag as BLOCKING under stimulusQuality.

### CAPS-structure checks (BLOCKING)

  - SECTION-MARK SPLIT: Where the system prompt prescribed a CAPS assessment structure (e.g. "20 + 5 + 10 + 15 = 50 for English HL Gr6 T2 June Controlled Test"), each section's leaf-mark sum MUST match. Off by ≥3 marks on any section is BLOCKING; off by 1-2 is ADVISORY.
  - OUT-OF-SCOPE CONTENT: If the system prompt included an "## Out of scope for this paper" block, no question stem may include contexts/calculations/concepts from the listed out-of-scope topics (e.g. money/Rand contexts when "Money" appears only in another term; conditional sentences when no "Conditional" subtopic appears in the term's pacing). Flag as BLOCKING under topicAlignment + curriculumCoverage.
  - WRONG-SECTION PLACEMENT: Tone, mood, attitude, or inference questions belong in the Comprehension section (Reading and Viewing) — never in Language Structures and Conventions. Flag as BLOCKING under capsCompliance.

### Creative Arts checks (BLOCKING when subject is "Life Skills — Creative Arts")

  - TASK BRIEF FORMAT: Creative Arts MUST be a practical task brief, not a Q&A paper. If you see "Define the term…", "Name three…", "Identify the…" comprehension-style questions, that paper is structurally wrong — flag as BLOCKING under capsCompliance with severity REJECT-level.
  - ART FORM PURITY: A Creative Arts paper for a single term contains EITHER Visual Arts OR Performing Arts, never both. CAPS rotates them. Flag mixed papers as BLOCKING.
  - 40 MARKS: Creative Arts is always 40 marks total. Different totals are BLOCKING.

### Question-quality checks (BLOCKING for serious, ADVISORY for borderline)

  - ANSWER GIVEN IN STEM: A syllabification stem that already shows hyphens, a stress-marking stem with marks pre-applied, a parts-of-speech stem with words pre-tagged — flag BLOCKING under questionClarity.
  - MARK ARITHMETIC IN INSTRUCTIONS: If a stem says "(2 features × 2 dances = 3 marks)", verify the math (2 × 2 = 4). Mismatches are BLOCKING under markFairness.
  - MCQ MISSING OPTIONS: A question whose stem invites a choice ("Which of the following…") with no options array is BLOCKING under mcqQuality.
  - ABBREVIATIONS: Bare "HCF", "LCM", "GCD", "LCD" in Grade 4-6 Maths stems without "Highest Common Factor" / "Lowest Common Multiple" first is ADVISORY under questionClarity.
  - VISUAL ASSET MISSING: A stimulus.kind = "visualText" or "diagram" referenced by questions, but with no source citation in description and no embeddable spec — flag BLOCKING under stimulusQuality, because the learner can't see what the question describes.
  - MEMO REFERENCES UNSEEN VISUAL: If a memo answer names a specific brand/organisation/title from an image, that image MUST be embedded or cited. If the visual is missing, the memo is unanswerable from the paper — flag BLOCKING under memoAccuracy.

## Severity definitions
  - BLOCKING: would prevent publication; must be fixed before release.
  - ADVISORY: would improve the paper; not a blocker.

## Verdict rules
  - PASS: zero BLOCKING issues; ADVISORY count ≤ 3.
  - NEEDS_WORK: 1-3 BLOCKING issues, fixable with targeted regen.
  - REJECT: 4+ BLOCKING issues OR memo arithmetic errors compounding; recommend full regeneration.

## Output rules
  - Be SPECIFIC: cite question numbers, quote stems, name the exact problem.
  - Be ACTIONABLE: every BLOCKING issue must include a concrete suggestedFix that a regen pass could implement.
  - Be HONEST: if you are uncertain (especially on Afrikaans nuance), mark the issue ADVISORY, not BLOCKING.
  - Do NOT flag the rebalance-prefix marker "[Marks awarded: N marks]" — that is a deterministic post-processing label, not model content.
  - Do NOT flag missing fields the schema already validated (e.g. assertResource caught it).

Call submit_moderation_report with the structured assessment. Do not output anything else.`;

// ─────────────────────────────────────────────────────────────────────
// TOOL SCHEMA
// One forced tool call so the response shape is guaranteed. Per-dimension
// scores let us compute aggregate quality across a sweep; criticalIssues
// is the actionable list a corrective regen pass consumes.
// ─────────────────────────────────────────────────────────────────────
const moderationTool = {
  name: 'submit_moderation_report',
  description: 'Return your structured moderation assessment of the paper.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'overallScore', 'dimensions', 'criticalIssues', 'recommendation'],
    properties: {
      verdict: {
        type: 'string',
        enum: ['PASS', 'NEEDS_WORK', 'REJECT'],
        description: 'PASS = publish-ready; NEEDS_WORK = fixable with targeted regen; REJECT = full regeneration recommended.',
      },
      overallScore: {
        type: 'integer',
        minimum: 1, maximum: 5,
        description: '1 = unusable, 5 = polished publish-ready.',
      },
      dimensions: {
        type: 'object',
        additionalProperties: false,
        required: [
          'memoAccuracy', 'cognitiveLevelIntegrity', 'topicAlignment',
          'markFairness', 'mcqQuality', 'questionClarity', 'stimulusQuality',
          'capsCompliance', 'languageRegister', 'biasSensitivity',
          'culturalContext', 'curriculumCoverage',
        ],
        properties: {
          memoAccuracy:           dimensionSchema('Are memo answers factually correct? Verify arithmetic.'),
          cognitiveLevelIntegrity: dimensionSchema('Do labelled cog levels match what each question actually tests?'),
          topicAlignment:         dimensionSchema('Does each question test the topic it claims?'),
          markFairness:           dimensionSchema('Are marks proportional to learner effort?'),
          mcqQuality:             dimensionSchema('Single correct, plausible distractors, parallel grammar.'),
          questionClarity:        dimensionSchema('Unambiguous wording, no double-barrelled questions, vocabulary fit for grade.'),
          stimulusQuality:        dimensionSchema('All refs resolve, passages coherent and age-appropriate.'),
          capsCompliance:         dimensionSchema('Cover page complete, sections ordered low-to-high cog level.'),
          languageRegister:       dimensionSchema('Grammar, spelling, register fit for grade and language. Afrikaans = mark advisory unless clearly wrong.'),
          biasSensitivity:        dimensionSchema('No gender/racial/socioeconomic stereotyping; SA-diverse names.'),
          culturalContext:        dimensionSchema('SA-relevant settings where reasonable.'),
          curriculumCoverage:     dimensionSchema('Reasonable spread of the term\'s topics.'),
        },
      },
      criticalIssues: {
        type: 'array',
        description: 'Specific issues with location and concrete fix. Order by severity then by question number.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['questionNumber', 'dimension', 'severity', 'description', 'suggestedFix'],
          properties: {
            questionNumber: { type: 'string', description: 'e.g. "1.3" or "memo:2.1" or "cover" or "stimulus:passage-1".' },
            dimension: {
              type: 'string',
              enum: [
                'memoAccuracy', 'cognitiveLevelIntegrity', 'topicAlignment',
                'markFairness', 'mcqQuality', 'questionClarity', 'stimulusQuality',
                'capsCompliance', 'languageRegister', 'biasSensitivity',
                'culturalContext', 'curriculumCoverage',
              ],
            },
            severity: { type: 'string', enum: ['BLOCKING', 'ADVISORY'] },
            description: { type: 'string', description: 'Quote the problematic content; explain why it\'s wrong.' },
            suggestedFix: { type: 'string', description: 'Concrete edit a regen pass can implement.' },
          },
        },
      },
      recommendation: {
        type: 'string',
        description: 'One paragraph summary: what\'s the publication-readiness call and why.',
      },
    },
  },
};

function dimensionSchema(description) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['score', 'notes'],
    properties: {
      score: { type: 'integer', minimum: 1, maximum: 5, description: '1 = unusable, 5 = polished. ' + description },
      notes: { type: 'string', description: 'One or two sentences explaining the score.' },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────

/**
 * Run the moderator on a single resource. Returns the structured report
 * exactly as the model emitted it (already schema-conformant via the tool).
 *
 * @param {object} resource — the schema-first Resource object
 * @param {object} opts     — { logger, signal }
 * @returns {Promise<object>} the moderation report
 */
export async function moderate(resource, opts = {}) {
  const { logger = defaultLogger, signal } = opts;
  if (!resource?.meta) throw new Error('moderate: resource.meta required');

  const user = buildUserPrompt(resource);
  const raw = await callAnthropicTool({
    system: SYSTEM_PROMPT,
    user,
    tool: moderationTool,
    model: HAIKU_MODEL,
    maxTokens: 4000,
    cacheSystem: true, // prompt is stable across all papers in a sweep
    // Moderation is a structured-output scoring task — there's no creative
    // value in high temperature, and the default (1.0) was producing wild
    // verdict swings on identical inputs (PASS 5/5 → NEEDS_WORK 3/5 across
    // consecutive runs of the same paper, per scripts/probe-moderator-stability.js).
    // 0.2 keeps just enough variance to handle borderline cases without
    // flipping verdicts.
    temperature: 0.2,
    logger,
    signal,
    phase: 'moderate',
  });
  return unwrapStringifiedBranches(raw);
}

// Haiku occasionally emits array-typed branches as JSON-encoded strings
// inside a tool input (same failure mode Sonnet has — see api/generate.js
// unwrapStringifiedBranches). Mechanical fix: detect string-where-array
// expected, JSON.parse, replace. Idempotent on already-correct objects.
function unwrapStringifiedBranches(report) {
  if (!report || typeof report !== 'object') return report;
  if (typeof report.criticalIssues === 'string') {
    try {
      const parsed = JSON.parse(report.criticalIssues);
      if (Array.isArray(parsed)) report.criticalIssues = parsed;
    } catch { /* leave as string; caller will see the type error */ }
  }
  if (typeof report.dimensions === 'string') {
    try {
      const parsed = JSON.parse(report.dimensions);
      if (parsed && typeof parsed === 'object') report.dimensions = parsed;
    } catch { /* leave as string */ }
  }
  return report;
}

function buildUserPrompt(resource) {
  // Hand the moderator the full structured Resource. JSON is more reliable
  // than rendered DOCX text for a tool-use review — the moderator can refer
  // to questionNumber, stimulusRef, etc. by id.
  return [
    'Moderate the following CAPS paper. Return your assessment via submit_moderation_report.',
    '',
    'PAPER (JSON):',
    '```json',
    JSON.stringify(resource, null, 2),
    '```',
  ].join('\n');
}

// Exposed for tests / runners.
export const __internals = { SYSTEM_PROMPT, moderationTool, buildUserPrompt };
