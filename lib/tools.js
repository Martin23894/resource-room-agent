// Anthropic tool definitions used to force structured JSON output.
//
// Each tool has the shape Anthropic's Messages API expects:
//   { name, description, input_schema }
//
// Use with callAnthropicTool({ tool: planTool({ cogLevels }), ... }) — the
// returned object is guaranteed to satisfy `input_schema`, so callers can
// drop the defensive JSON.parse() / try-catch dance.
//
// Some tools take parameters because their schema depends on the request
// (e.g. cogLevel must be one of the framework's specific levels).

/**
 * Phase 1 — submit a question plan.
 * @param {string[]} cogLevels  Allowed cognitive-level labels for this subject.
 */
export function planTool(cogLevels) {
  return {
    name: 'submit_question_plan',
    description: 'Submit a CAPS-aligned question plan for the requested assessment. Each question has its number, type, topic, mark allocation and cognitive level.',
    input_schema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              number:   { type: 'string', description: 'Question label like "Q1", "Q2", "Q3.1".' },
              type:     { type: 'string', description: 'Question type: MCQ, True/False, Short Answer, Multi-step, Word Problem, Investigation, etc.' },
              topic:    { type: 'string', description: 'CAPS topic the question covers — must be drawn from the provided ATP topic list.' },
              marks:    { type: 'integer', minimum: 1, description: 'Mark value for this question (whole number).' },
              cogLevel: { type: 'string', enum: cogLevels, description: "Cognitive level — exactly one of the framework's labels." },
            },
            required: ['number', 'type', 'topic', 'marks', 'cogLevel'],
          },
        },
      },
      required: ['questions'],
    },
  };
}

/**
 * Phase 2b — flag any design flaws in the generated question paper.
 */
export const qualityTool = {
  name: 'flag_question_paper_issues',
  description: 'Report design flaws in the question paper (ordering questions with equal values, MCQs with multiple/no correct answers, ambiguous data, impossible questions, off-term topics). Return clean=true with empty flaws when nothing is wrong.',
  input_schema: {
    type: 'object',
    properties: {
      clean: { type: 'boolean', description: 'True when no flaws were found.' },
      flaws: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'Sub-question reference like "4.3".' },
            type: {
              type: 'string',
              enum: [
                'ORDERING_EQUAL_VALUES',
                'MCQ_MULTIPLE_CORRECT',
                'MCQ_NO_CORRECT',
                'DATA_AMBIGUOUS',
                'QUESTION_IMPOSSIBLE',
                'WRONG_TERM_TOPIC',
              ],
            },
            detail: { type: 'string', description: 'Brief explanation of the flaw.' },
            fix:    { type: 'string', description: 'Concrete edit that resolves the flaw.' },
          },
          required: ['question', 'type', 'detail', 'fix'],
        },
      },
    },
    required: ['clean', 'flaws'],
  },
};

/**
 * Phase 4 — flag accuracy errors in the memorandum.
 */
export const memoVerifyTool = {
  name: 'flag_memo_errors',
  description: 'Report arithmetic, profit/loss, count, rounding, or cognitive-level-total errors in the memorandum. Return clean=true with empty arrays when the memo is correct.',
  input_schema: {
    type: 'object',
    properties: {
      clean: { type: 'boolean', description: 'True when the memo has no errors.' },
      errors: {
        type: 'array',
        description: 'Per-row memo errors. ANSWER_GUIDANCE_CONTRADICTION fires when the ANSWER cell of a row contradicts its own MARKING GUIDANCE cell (e.g. answer says "Thandi is incorrect" but guidance computes a result that proves Thandi correct). The other check types apply to single-cell errors.',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'Sub-question reference like "7.1a".' },
            check: {
              type: 'string',
              enum: [
                'ARITHMETIC',
                'PROFIT_LOSS',
                'COUNT',
                'ROUNDING',
                'ANSWER_GUIDANCE_CONTRADICTION',
              ],
            },
            found:   { type: 'string', description: 'The incorrect value currently in the memo.' },
            correct: { type: 'string', description: 'The correct value.' },
            fix:     { type: 'string', description: 'Concrete edit that resolves the error.' },
          },
          required: ['question', 'check', 'found', 'correct', 'fix'],
        },
      },
      cogLevelErrors: {
        type: 'array',
        description: 'Cognitive-level totals that disagree between the memo table and the analysis table. COG_BREAKDOWN_INCOMPLETE fires when sub-questions visible in the answer table are missing from the breakdown text. COG_BREAKDOWN_MATH_ERROR fires when the listed items in a level\'s breakdown text do not arithmetically sum to the total claimed for that level. The default kind (legacy) is the table-vs-analysis sum mismatch.',
        items: {
          type: 'object',
          properties: {
            level:           { type: 'string', description: 'Cognitive level label.' },
            kind: {
              type: 'string',
              enum: [
                'TABLE_ANALYSIS_MISMATCH',
                'COG_BREAKDOWN_INCOMPLETE',
                'COG_BREAKDOWN_MATH_ERROR',
              ],
              description: 'Which kind of cog-level discrepancy this is. Default to TABLE_ANALYSIS_MISMATCH for the legacy check.',
            },
            foundInTable:    { type: 'string', description: 'Total currently shown in the analysis table for this level.' },
            foundInAnalysis: { type: 'string', description: 'Sum of MARK values across rows for this level in the memo (or the actual sum of the breakdown items for math errors).' },
            missingItems:    { type: 'string', description: 'For COG_BREAKDOWN_INCOMPLETE: comma-separated sub-question references that are missing from this level\'s breakdown. Empty otherwise.' },
            fix:             { type: 'string', description: 'Concrete edit that resolves the discrepancy.' },
          },
          required: ['level', 'kind', 'foundInTable', 'foundInAnalysis', 'fix'],
        },
      },
    },
    required: ['clean', 'errors', 'cogLevelErrors'],
  },
};

/**
 * Teacha marketplace product listing.
 */
export const coverTool = {
  name: 'submit_teacha_listing',
  description: 'Submit a Teacha Resources marketplace product listing for the configured CAPS resource pack.',
  input_schema: {
    type: 'object',
    properties: {
      productTitle:   { type: 'string', description: 'Compelling, searchable product title.' },
      tagline:        { type: 'string', description: 'One-sentence tagline.' },
      description:    { type: 'string', description: '3–4 sentence description explaining the value to SA teachers.' },
      whatIncluded:   { type: 'array', minItems: 4, items: { type: 'string' }, description: '4–6 bullet points listing what is in the pack.' },
      suitableFor:    { type: 'string', description: 'Who the resource is for (e.g. "Grade 6 Natural Sciences and Technology teachers, Term 3").' },
      keywords:       { type: 'array', minItems: 6, items: { type: 'string' }, description: '6–8 search keywords SA teachers would use.' },
      suggestedPrice: { type: 'string', description: 'Suggested ZAR price like "R80" (range R30–R120 depending on resource type).' },
    },
    required: ['productTitle', 'tagline', 'description', 'whatIncluded', 'suitableFor', 'keywords', 'suggestedPrice'],
  },
};
