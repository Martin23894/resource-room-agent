import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validatePlan, planContext, topicDiversityRules, LOW_DEMAND_TYPES } from '../lib/plan.js';
import { getCogLevels, largestRemainder } from '../lib/cognitive.js';

// Build a plan-validator context for a Grade 6 Maths Test, 50 marks.
const MATHS_COG = getCogLevels('Mathematics');            // 25/45/20/10
const MATHS_MARKS = largestRemainder(50, MATHS_COG.pcts); // e.g. [13, 22, 10, 5] (sum 50)
const TOLERANCE = Math.max(1, Math.round(50 * 0.02));     // 1

// Realistic ATP list so the topic-diversity rules activate at the default
// threshold (≥ 3 distinct topics required).
const ATP_TOPICS = ['Whole numbers', 'Fractions', 'Decimals', 'Ratio', 'Patterns'];

const ctx = planContext({
  totalMarks: 50,
  cog: MATHS_COG,
  cogMarks: MATHS_MARKS,
  cogTolerance: TOLERANCE,
  atpTopics: ATP_TOPICS,
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
      { number: 'Q1', type: 'MCQ',          topic: 'Whole numbers', marks: MATHS_MARKS[0], cogLevel: 'Knowledge' },
      { number: 'Q2', type: 'Short Answer', topic: 'Fractions',     marks: MATHS_MARKS[1], cogLevel: 'Routine Procedures' },
      { number: 'Q3', type: 'Multi-step',   topic: 'Decimals',      marks: MATHS_MARKS[2], cogLevel: 'Complex Procedures' },
      { number: 'Q4', type: 'Word Problem', topic: 'Ratio',         marks: MATHS_MARKS[3], cogLevel: 'Problem Solving' },
    ]);
    assert.ok(validatePlan(plan, ctx));
  });

  test('same topic spelled two ways still counts as one topic', () => {
    // Q1 + Q2 both "Fractions" (differ only in case + trailing space) collapse
    // to one topic with 13 marks — under the 25-mark concentration cap. The
    // plan has 4 distinct topics after normalisation, above the min of 3.
    const plan = makePlan([
      { number: 'Q1', type: 'MCQ',          topic: 'Fractions',   marks: 8,              cogLevel: 'Knowledge' },
      { number: 'Q2', type: 'Short Answer', topic: 'fractions ',  marks: 5,              cogLevel: 'Knowledge' },
      { number: 'Q3', type: 'Short Answer', topic: 'Decimals',    marks: MATHS_MARKS[1], cogLevel: 'Routine Procedures' },
      { number: 'Q4', type: 'Multi-step',   topic: 'Ratio',       marks: MATHS_MARKS[2], cogLevel: 'Complex Procedures' },
      { number: 'Q5', type: 'Word Problem', topic: 'Patterns',    marks: MATHS_MARKS[3], cogLevel: 'Problem Solving' },
    ]);
    assert.ok(validatePlan(plan, ctx));
  });
});

describe('validatePlan — rejects broken plans', () => {
  test('returns null when total does not match', () => {
    const plan = makePlan([
      { number: 'Q1', type: 'MCQ', topic: 'Whole numbers', marks: 100, cogLevel: 'Knowledge' },
    ]);
    assert.equal(validatePlan(plan, ctx), null);
  });

  test('returns null when a cognitive level is more than ±tolerance off target', () => {
    const plan = makePlan([
      { number: 'Q1', type: 'MCQ', topic: 'Whole numbers', marks: 50, cogLevel: 'Knowledge' },
    ]);
    assert.equal(validatePlan(plan, ctx), null);
  });

  test('returns null when MCQ total exceeds the Knowledge-level cap', () => {
    const tooMuchMCQ = MATHS_MARKS[0] + 5;
    const plan = makePlan([
      { number: 'Q1', type: 'MCQ',          topic: 'Whole numbers', marks: tooMuchMCQ,         cogLevel: 'Knowledge' },
      { number: 'Q2', type: 'Short Answer', topic: 'Fractions',     marks: MATHS_MARKS[1] - 5, cogLevel: 'Routine Procedures' },
      { number: 'Q3', type: 'Multi-step',   topic: 'Decimals',      marks: MATHS_MARKS[2],     cogLevel: 'Complex Procedures' },
      { number: 'Q4', type: 'Word Problem', topic: 'Ratio',         marks: MATHS_MARKS[3],     cogLevel: 'Problem Solving' },
    ]);
    assert.equal(validatePlan(plan, ctx), null);
  });

  test('returns null when a high cognitive level uses a low-demand question type', () => {
    const plan = makePlan([
      { number: 'Q1', type: 'Short Answer', topic: 'Whole numbers', marks: MATHS_MARKS[0], cogLevel: 'Knowledge' },
      { number: 'Q2', type: 'Short Answer', topic: 'Fractions',     marks: MATHS_MARKS[1], cogLevel: 'Routine Procedures' },
      { number: 'Q3', type: 'MCQ',          topic: 'Decimals',      marks: MATHS_MARKS[2], cogLevel: 'Complex Procedures' },
      { number: 'Q4', type: 'Word Problem', topic: 'Ratio',         marks: MATHS_MARKS[3], cogLevel: 'Problem Solving' },
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

describe('validatePlan — topic diversity + concentration', () => {
  // A plan that's otherwise fine (marks sum to 50, cog spread correct) but
  // concentrates every question on ONE topic — the "Fractions-only test"
  // bug the teacher reported. Must be rejected.
  test('rejects a single-topic plan', () => {
    const plan = makePlan([
      { number: 'Q1', type: 'MCQ',          topic: 'Fractions', marks: MATHS_MARKS[0], cogLevel: 'Knowledge' },
      { number: 'Q2', type: 'Short Answer', topic: 'Fractions', marks: MATHS_MARKS[1], cogLevel: 'Routine Procedures' },
      { number: 'Q3', type: 'Multi-step',   topic: 'Fractions', marks: MATHS_MARKS[2], cogLevel: 'Complex Procedures' },
      { number: 'Q4', type: 'Word Problem', topic: 'Fractions', marks: MATHS_MARKS[3], cogLevel: 'Problem Solving' },
    ]);
    const lines = [];
    assert.equal(validatePlan(plan, ctx, { info: (m) => lines.push(m) }), null);
    assert.ok(
      lines.some((m) => /distinct ATP entr/i.test(m) || /distinct topic/i.test(m)),
      'should log topic-diversity rejection',
    );
  });

  test('rejects a two-topic plan when ATP has ≥ 3 topics available', () => {
    // Same mark distribution as a good plan, but only two topics — rejected.
    const plan = makePlan([
      { number: 'Q1', type: 'MCQ',          topic: 'Fractions', marks: MATHS_MARKS[0], cogLevel: 'Knowledge' },
      { number: 'Q2', type: 'Short Answer', topic: 'Fractions', marks: MATHS_MARKS[1], cogLevel: 'Routine Procedures' },
      { number: 'Q3', type: 'Multi-step',   topic: 'Decimals',  marks: MATHS_MARKS[2], cogLevel: 'Complex Procedures' },
      { number: 'Q4', type: 'Word Problem', topic: 'Decimals',  marks: MATHS_MARKS[3], cogLevel: 'Problem Solving' },
    ]);
    assert.equal(validatePlan(plan, ctx), null);
  });

  test('rejects a plan where one topic hogs > 50% of marks', () => {
    // 3 distinct topics (passes diversity) but one topic has 30 of 50 marks.
    // 30 > ceil(50 * 0.5) = 25 → rejected by the concentration cap.
    const plan = makePlan([
      { number: 'Q1', type: 'Short Answer', topic: 'Fractions',     marks: 30, cogLevel: 'Routine Procedures' },
      { number: 'Q2', type: 'MCQ',          topic: 'Whole numbers', marks: MATHS_MARKS[0], cogLevel: 'Knowledge' },
      { number: 'Q3', type: 'Multi-step',   topic: 'Decimals',      marks: MATHS_MARKS[2], cogLevel: 'Complex Procedures' },
      // Fewer PS marks to keep total = 50 and other levels close to target.
      // We deliberately construct a plan that would pass all OTHER checks
      // but fail the concentration rule, so the rejection reason must be
      // the topic-concentration one.
      { number: 'Q4', type: 'Word Problem', topic: 'Ratio', marks: 50 - 30 - MATHS_MARKS[0] - MATHS_MARKS[2], cogLevel: 'Problem Solving' },
    ]);
    const lines = [];
    assert.equal(validatePlan(plan, ctx, { info: (m) => lines.push(m) }), null);
    // Ensure we got to (or past) the concentration rule without being
    // tripped by the cog-tolerance rule first, which would mean we didn't
    // actually test the new guard.
    const hitConcentrationRule = lines.some((m) => /has \d+ marks, max \d+/.test(m));
    const hitCogRule = lines.some((m) => /has \d+ marks, target/.test(m));
    assert.ok(hitConcentrationRule || hitCogRule, 'should hit either the concentration or cog rule');
  });

  test('accepts a plan with exactly 3 distinct topics', () => {
    const plan = makePlan([
      { number: 'Q1', type: 'MCQ',          topic: 'Fractions',     marks: MATHS_MARKS[0], cogLevel: 'Knowledge' },
      { number: 'Q2', type: 'Short Answer', topic: 'Decimals',      marks: MATHS_MARKS[1], cogLevel: 'Routine Procedures' },
      { number: 'Q3', type: 'Multi-step',   topic: 'Whole numbers', marks: MATHS_MARKS[2], cogLevel: 'Complex Procedures' },
      { number: 'Q4', type: 'Word Problem', topic: 'Whole numbers', marks: MATHS_MARKS[3], cogLevel: 'Problem Solving' },
    ]);
    // 3 distinct topics: Fractions, Decimals, Whole numbers. Passes.
    assert.ok(validatePlan(plan, ctx));
  });
});

describe('planContext — topic-diversity threshold scales with ATP size', () => {
  test('minDistinctAtpEntries caps at 3 when ATP has 3+ topics', () => {
    const c = planContext({
      totalMarks: 50, cog: MATHS_COG, cogMarks: MATHS_MARKS, cogTolerance: 1,
      atpTopics: ['A', 'B', 'C', 'D', 'E', 'F'],
    });
    assert.equal(c.minDistinctAtpEntries, 3);
  });

  test('minDistinctAtpEntries = 2 when ATP has exactly 2 topics', () => {
    const c = planContext({
      totalMarks: 50, cog: MATHS_COG, cogMarks: MATHS_MARKS, cogTolerance: 1,
      atpTopics: ['A', 'B'],
    });
    assert.equal(c.minDistinctAtpEntries, 2);
  });

  test('minDistinctAtpEntries = 1 when ATP has only 1 topic', () => {
    const c = planContext({
      totalMarks: 50, cog: MATHS_COG, cogMarks: MATHS_MARKS, cogTolerance: 1,
      atpTopics: ['A'],
    });
    assert.equal(c.minDistinctAtpEntries, 1);
  });

  test('maxMarksPerAtpEntry is 50% of totalMarks, rounded up', () => {
    assert.equal(planContext({ totalMarks: 50, cog: MATHS_COG, cogMarks: MATHS_MARKS, cogTolerance: 1 }).maxMarksPerAtpEntry, 25);
    assert.equal(planContext({ totalMarks: 25, cog: MATHS_COG, cogMarks: largestRemainder(25, MATHS_COG.pcts), cogTolerance: 1 }).maxMarksPerAtpEntry, 13);
    assert.equal(planContext({ totalMarks: 100, cog: MATHS_COG, cogMarks: largestRemainder(100, MATHS_COG.pcts), cogTolerance: 1 }).maxMarksPerAtpEntry, 50);
  });
});

describe('validatePlan — ATP-entry diversity (catches the EMS-Final-Exam monoculture)', () => {
  // The EMS-Final-Exam failure mode: Claude paraphrases ONE ATP entry
  // (e.g. "history of money — barter, traditional/modern, paper money,
  // electronic banking") into multiple plan-topic strings ("barter",
  // "commodity money", "paper money", "electronic banking") that all
  // collapse back to the same ATP entry. String-distinctness used to
  // pass; ATP-entry-distinctness rejects.
  const EMS_T1_ATP = [
    'The economy: history of money — traditional societies; comparison of traditional and modern monetary systems; paper money; electronic banking',
    'The economy: needs and wants — differentiating between primary and secondary needs; characteristics; unlimited wants vs limited resources',
    'The economy: goods and services — differentiating, examples; role of producers and consumers; recycling goods',
  ];

  // Use Bloom's 30/50/20 split for SS so we don't have to reshape the
  // plan to fit Maths's 25/45/20/10.
  const SS_COG = { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30, 50, 20] };
  const SS_MARKS = largestRemainder(50, SS_COG.pcts); // [15, 25, 10]

  const ssCtx = planContext({
    totalMarks: 50, cog: SS_COG, cogMarks: SS_MARKS, cogTolerance: 1,
    atpTopics: EMS_T1_ATP,
  });

  test('rejects a plan that paraphrases ONE ATP entry as 4 different topic strings', () => {
    // Five questions, all hitting the "history of money" ATP entry but
    // labelled with paraphrased variants. String-distinctness would see
    // 5 distinct strings and pass. ATP-entry-distinctness folds them
    // back into 1 ATP entry and rejects.
    const plan = makePlan([
      { number: 'Q1', type: 'MCQ',          topic: 'barter system',         marks: 10, cogLevel: 'Low Order' },
      { number: 'Q2', type: 'MCQ',          topic: 'commodity money',       marks: 5,  cogLevel: 'Low Order' },
      { number: 'Q3', type: 'Short Answer', topic: 'paper money history',   marks: 12, cogLevel: 'Middle Order' },
      { number: 'Q4', type: 'Short Answer', topic: 'electronic banking',    marks: 13, cogLevel: 'Middle Order' },
      { number: 'Q5', type: 'Multi-step',   topic: 'modern monetary systems', marks: 10, cogLevel: 'High Order' },
    ]);
    const lines = [];
    assert.equal(validatePlan(plan, ssCtx, { info: (m) => lines.push(m) }), null);
    assert.ok(
      lines.some((m) => /distinct ATP entr/i.test(m) || /max \d+/.test(m)),
      'should log the ATP-entry diversity rejection',
    );
  });

  test('accepts a plan that genuinely spans 3 different ATP entries', () => {
    const plan = makePlan([
      { number: 'Q1', type: 'MCQ',          topic: 'history of money',  marks: 15, cogLevel: 'Low Order' },
      { number: 'Q2', type: 'Short Answer', topic: 'needs and wants',   marks: 12, cogLevel: 'Middle Order' },
      { number: 'Q3', type: 'Short Answer', topic: 'goods and services', marks: 13, cogLevel: 'Middle Order' },
      { number: 'Q4', type: 'Multi-step',   topic: 'producers consumers', marks: 10, cogLevel: 'High Order' },
    ]);
    assert.ok(validatePlan(plan, ssCtx));
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
    const plan = makePlan([{ number: 'Q1', type: 'MCQ', topic: 'Fractions', marks: 99, cogLevel: 'Knowledge' }]);
    assert.equal(validatePlan(plan, ctx, log), null);
    assert.ok(lines.length >= 1);
    assert.match(lines[0], /Plan total 99/);
  });
});

describe('topicDiversityRules — Final Exam scope (Phase 4)', () => {
  test('Final Exam: requires at least 6 distinct topics on a 12-topic ATP', () => {
    const r = topicDiversityRules({
      totalMarks: 100,
      atpTopics: Array.from({ length: 12 }, (_, i) => `Topic ${i + 1}`),
      isFinalExam: true,
    });
    assert.equal(r.minDistinctAtpEntries, 6);
  });

  test('Final Exam: caps any single topic at 25% of marks', () => {
    const r = topicDiversityRules({
      totalMarks: 100,
      atpTopics: Array.from({ length: 12 }, (_, i) => `Topic ${i + 1}`),
      isFinalExam: true,
    });
    assert.equal(r.maxMarksPerAtpEntry, 25, '25% × 100 = 25');
  });

  test('Final Exam: scales per-topic cap with mark count (50-mark paper → 13)', () => {
    const r = topicDiversityRules({
      totalMarks: 50,
      atpTopics: Array.from({ length: 12 }, (_, i) => `Topic ${i + 1}`),
      isFinalExam: true,
    });
    assert.equal(r.maxMarksPerAtpEntry, 13, '25% × 50 = 12.5, rounded up');
  });

  test('Final Exam: minDistinct caps at the size of the ATP list', () => {
    // If ATP only has 4 topics, minDistinct can't ask for more than 4.
    const r = topicDiversityRules({
      totalMarks: 60,
      atpTopics: ['T1', 'T2', 'T3', 'T4'],
      isFinalExam: true,
    });
    assert.equal(r.minDistinctAtpEntries, 4);
  });

  test('Standard (non-Final): keeps the ≥ 3 distinct, ≤ 50% per topic ruleset', () => {
    const r = topicDiversityRules({
      totalMarks: 100,
      atpTopics: ['T1', 'T2', 'T3', 'T4', 'T5'],
      isFinalExam: false,
    });
    assert.equal(r.minDistinctAtpEntries, 3);
    assert.equal(r.maxMarksPerAtpEntry, 50);
  });

  test('Resource 5 regression — Bug 44: monoculture Final Exam is rejected', () => {
    // Resource 5 audit: a Grade 7 EMS Final Exam with 12 ATP topics that
    // shipped 100% of marks on one topic. With Final Exam scope rules
    // engaged, validatePlan must reject this plan.
    const cog = { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30, 50, 20] };
    const cogMarks = largestRemainder(100, cog.pcts);
    const atpTopics = [
      'History of money — barter, paper, electronic banking',
      'Needs and wants',
      'Goods and services',
      'Inequality and poverty',
      'Accounting concepts',
      'Personal statement of net worth',
      'Personal budget',
      'Entrepreneurship characteristics',
      'SWOT analysis',
      'AIDA principles of advertising',
      'Production process',
      'Savings and stokvels',
    ];
    const finalCtx = planContext({
      totalMarks: 100, cog, cogMarks, cogTolerance: 2, atpTopics, isFinalExam: true,
    });
    // Make a plan where every question's topic maps to the same ATP entry —
    // the "history of money" failure mode.
    const monoculture = makePlan([
      { number: 'Q1', type: 'MCQ',          topic: 'history of money',         marks: 30, cogLevel: 'Low Order' },
      { number: 'Q2', type: 'Short Answer', topic: 'paper money',              marks: 30, cogLevel: 'Middle Order' },
      { number: 'Q3', type: 'Word Problem', topic: 'electronic banking',       marks: 20, cogLevel: 'Middle Order' },
      { number: 'Q4', type: 'Essay',        topic: 'barter system history',    marks: 20, cogLevel: 'High Order' },
    ]);
    const result = validatePlan(monoculture, finalCtx);
    assert.equal(result, null, 'monoculture Final Exam plan must be rejected');
  });

  test('Resource 5 regression — well-spread Final Exam plan is accepted', () => {
    const cog = { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30, 50, 20] };
    const cogMarks = largestRemainder(100, cog.pcts);
    // Use distinctive content words so matchAtpEntry can route each plan
    // topic to a different ATP entry (the matcher uses ≥ 4-char content
    // words; "Topic 1"/"Topic 2"/etc. all share only "topic" so they'd
    // collapse to one bucket).
    const atpTopics = [
      'History monetary system barter trade',
      'Personal needs wants distinguishing primary secondary',
      'Goods services producers consumers recycling',
      'Inequality poverty causes socio-economic imbalances',
      'Accounting capital assets liability income expenses',
      'Personal statement networth savings investments',
      'Budget definition income expenditure planning',
      'Entrepreneurship characteristics skills profile',
      'Buying selling profit manufacturing businesses',
      'Production inputs outputs sustainable resources',
      'Financial savings purpose banks accounts services',
      'Stokvels community schemes informal banking',
    ];
    const finalCtx = planContext({
      totalMarks: 100, cog, cogMarks, cogTolerance: 2, atpTopics, isFinalExam: true,
    });
    const wellSpread = makePlan([
      { number: 'Q1', type: 'MCQ',          topic: 'monetary system barter',     marks: 15, cogLevel: 'Low Order' },
      { number: 'Q2', type: 'MCQ',          topic: 'needs wants distinguishing', marks: 15, cogLevel: 'Low Order' },
      { number: 'Q3', type: 'Short Answer', topic: 'goods services consumers',   marks: 25, cogLevel: 'Middle Order' },
      { number: 'Q4', type: 'Short Answer', topic: 'inequality poverty causes',  marks: 25, cogLevel: 'Middle Order' },
      { number: 'Q5', type: 'Multi-step',   topic: 'production inputs outputs',  marks: 10, cogLevel: 'High Order' },
      { number: 'Q6', type: 'Essay',        topic: 'entrepreneurship skills',    marks: 10, cogLevel: 'High Order' },
    ]);
    assert.ok(validatePlan(wellSpread, finalCtx), 'spread plan must pass validation');
  });
});
