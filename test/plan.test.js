import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validatePlan, planContext, LOW_DEMAND_TYPES } from '../lib/plan.js';
import { getCogLevels, largestRemainder } from '../lib/cognitive.js';

// Build a plan-validator context for a Grade 6 Maths Test, 50 marks.
const MATHS_COG = getCogLevels('Mathematics');            // 25/45/20/10
const MATHS_MARKS = largestRemainder(50, MATHS_COG.pcts); // e.g. [13, 22, 10, 5] (sum 50)
const TOLERANCE = Math.max(1, Math.round(50 * 0.02));     // 1

const ctx = planContext({
  totalMarks: 50,
  cog: MATHS_COG,
  cogMarks: MATHS_MARKS,
  cogTolerance: TOLERANCE,
});

function makePlan(questions) {
  return { questions };
}

describe('validatePlan — accepts valid plans', () => {
  test('well-formed plan sums to total and hits every level', () => {
    const plan = makePlan([
      { number: 'Q1', type: 'MCQ',          topic: 'Whole numbers', marks: MATHS_MARKS[0], cogLevel: 'Knowledge' },
      { number: 'Q2', type: 'Short Answer', topic: 'Fractions',     marks: MATHS_MARKS[1], cogLevel: 'Routine Procedures' },
      { number: 'Q3', type: 'Multi-step',   topic: 'Decimals',      marks: MATHS_MARKS[2], cogLevel: 'Complex Procedures' },
      { number: 'Q4', type: 'Word Problem', topic: 'Ratio',         marks: MATHS_MARKS[3], cogLevel: 'Problem Solving' },
    ]);
    assert.ok(validatePlan(plan, ctx));
  });

  test('MCQ marks at or below the Knowledge cap are allowed', () => {
    const plan = makePlan([
      { number: 'Q1', type: 'MCQ',          topic: 'x', marks: MATHS_MARKS[0], cogLevel: 'Knowledge' },
      { number: 'Q2', type: 'Short Answer', topic: 'x', marks: MATHS_MARKS[1], cogLevel: 'Routine Procedures' },
      { number: 'Q3', type: 'Multi-step',   topic: 'x', marks: MATHS_MARKS[2], cogLevel: 'Complex Procedures' },
      { number: 'Q4', type: 'Word Problem', topic: 'x', marks: MATHS_MARKS[3], cogLevel: 'Problem Solving' },
    ]);
    assert.ok(validatePlan(plan, ctx));
  });
});

describe('validatePlan — rejects broken plans', () => {
  test('returns null when total does not match', () => {
    const plan = makePlan([
      { number: 'Q1', type: 'MCQ', topic: 'x', marks: 100, cogLevel: 'Knowledge' },
    ]);
    assert.equal(validatePlan(plan, ctx), null);
  });

  test('returns null when a cognitive level is more than ±tolerance off target', () => {
    // All marks on Knowledge — way too much Knowledge, way too little of the rest.
    const plan = makePlan([
      { number: 'Q1', type: 'MCQ', topic: 'x', marks: 50, cogLevel: 'Knowledge' },
    ]);
    assert.equal(validatePlan(plan, ctx), null);
  });

  test('returns null when MCQ total exceeds the Knowledge-level cap', () => {
    const tooMuchMCQ = MATHS_MARKS[0] + 5;
    const plan = makePlan([
      { number: 'Q1', type: 'MCQ',          topic: 'x', marks: tooMuchMCQ,        cogLevel: 'Knowledge' },
      { number: 'Q2', type: 'Short Answer', topic: 'x', marks: MATHS_MARKS[1] - 5, cogLevel: 'Routine Procedures' },
      { number: 'Q3', type: 'Multi-step',   topic: 'x', marks: MATHS_MARKS[2],     cogLevel: 'Complex Procedures' },
      { number: 'Q4', type: 'Word Problem', topic: 'x', marks: MATHS_MARKS[3],     cogLevel: 'Problem Solving' },
    ]);
    assert.equal(validatePlan(plan, ctx), null);
  });

  test('returns null when a high cognitive level uses a low-demand question type', () => {
    // Put an MCQ at Complex Procedures — disallowed.
    const plan = makePlan([
      { number: 'Q1', type: 'Short Answer', topic: 'x', marks: MATHS_MARKS[0], cogLevel: 'Knowledge' },
      { number: 'Q2', type: 'Short Answer', topic: 'x', marks: MATHS_MARKS[1], cogLevel: 'Routine Procedures' },
      { number: 'Q3', type: 'MCQ',          topic: 'x', marks: MATHS_MARKS[2], cogLevel: 'Complex Procedures' },
      { number: 'Q4', type: 'Word Problem', topic: 'x', marks: MATHS_MARKS[3], cogLevel: 'Problem Solving' },
    ]);
    assert.equal(validatePlan(plan, ctx), null);
  });

  test('returns null for missing or empty plan', () => {
    assert.equal(validatePlan(null, ctx), null);
    assert.equal(validatePlan({}, ctx), null);
    assert.equal(validatePlan({ questions: [] }, ctx), null);
    assert.equal(validatePlan({ questions: 'not an array' }, ctx), null);
  });
});

describe('LOW_DEMAND_TYPES — shape', () => {
  test('includes MCQ, True/False variants, and Matching', () => {
    assert.ok(LOW_DEMAND_TYPES.includes('MCQ'));
    assert.ok(LOW_DEMAND_TYPES.includes('True/False'));
    assert.ok(LOW_DEMAND_TYPES.includes('True or False'));
    assert.ok(LOW_DEMAND_TYPES.includes('Matching'));
  });
});

describe('validatePlan — rejection reasons are logged', () => {
  test('writes a log line explaining the failure', () => {
    const lines = [];
    const log = { info: (m) => lines.push(m) };
    const plan = makePlan([{ number: 'Q1', type: 'MCQ', topic: 'x', marks: 99, cogLevel: 'Knowledge' }]);
    assert.equal(validatePlan(plan, ctx, log), null);
    assert.ok(lines.length >= 1);
    assert.match(lines[0], /Plan total 99/);
  });
});
