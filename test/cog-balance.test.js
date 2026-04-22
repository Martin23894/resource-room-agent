import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { verifyCogBalance, formatImbalances } from '../lib/cog-balance.js';
import { getCogLevels, largestRemainder } from '../lib/cognitive.js';

// Fixed context for Grade 6 Maths (Bloom's 25/45/20/10) at 40 marks.
// cogMarks = [10, 18, 8, 4] — sums to 40.
const COG = getCogLevels('Mathematics');
const MARKS = largestRemainder(40, COG.pcts);
const TOLERANCE = 1;

function makePlan(assignments) {
  // assignments: [['Q1', 'Knowledge'], ['Q2', 'Routine Procedures'], ...]
  return {
    questions: assignments.map(([number, cogLevel], i) => ({
      number,
      type: 'Short Answer',
      topic: 'test',
      marks: 1,
      cogLevel,
    })),
  };
}

describe('verifyCogBalance — mapping', () => {
  test('maps paper sub-questions (1.1, 1.2) to plan parent (Q1)', () => {
    const plan = makePlan([
      ['Q1', 'Knowledge'],
      ['Q2', 'Routine Procedures'],
      ['Q3', 'Complex Procedures'],
      ['Q4', 'Problem Solving'],
    ]);
    const paper = [
      '1.1 Simple recall. (2)',
      '1.2 Another recall. (2)',
      '2.1 Routine step. (3)',
      '3.1 Multi-step. (2)',
      '4.1 Problem. (1)',
    ].join('\n');
    const result = verifyCogBalance({ paper, plan, cog: COG, cogMarks: [4, 3, 2, 1], tolerance: 0 });
    assert.equal(result.actualByLevel.Knowledge, 4);
    assert.equal(result.actualByLevel['Routine Procedures'], 3);
    assert.equal(result.actualByLevel['Complex Procedures'], 2);
    assert.equal(result.actualByLevel['Problem Solving'], 1);
    assert.equal(result.clean, true);
  });

  test('handles nested sub-questions (1.2.1 → Q1)', () => {
    const plan = makePlan([['Q1', 'Knowledge']]);
    const paper = '1.2.1 Deep sub-question. (5)';
    const result = verifyCogBalance({ paper, plan, cog: COG, cogMarks: [5, 0, 0, 0], tolerance: 0 });
    assert.equal(result.actualByLevel.Knowledge, 5);
  });

  test('handles letter-suffixed sub-questions (7.1a → Q7)', () => {
    const plan = makePlan([['Q7', 'Problem Solving']]);
    const paper = '7.1a Something. (4)';
    const result = verifyCogBalance({ paper, plan, cog: COG, cogMarks: [0, 0, 0, 4], tolerance: 0 });
    assert.equal(result.actualByLevel['Problem Solving'], 4);
  });

  test('prefers exact match when plan uses sub-question numbers', () => {
    // If the plan explicitly lists "3.1" as Knowledge but "Q3" as Complex,
    // the exact match wins.
    const plan = {
      questions: [
        { number: 'Q3', type: 'x', topic: 'x', marks: 5, cogLevel: 'Complex Procedures' },
        { number: '3.1', type: 'x', topic: 'x', marks: 2, cogLevel: 'Knowledge' },
      ],
    };
    const paper = '3.1 Specific sub-question. (2)';
    const result = verifyCogBalance({ paper, plan, cog: COG, cogMarks: [2, 0, 0, 0], tolerance: 0 });
    assert.equal(result.actualByLevel.Knowledge, 2);
    assert.equal(result.actualByLevel['Complex Procedures'], 0);
  });

  test('unmapped sub-questions are listed, not counted', () => {
    const plan = makePlan([['Q1', 'Knowledge']]);
    const paper = [
      '1.1 Mapped. (2)',
      '9.1 Orphan — no Q9 in plan. (3)',
    ].join('\n');
    const result = verifyCogBalance({ paper, plan, cog: COG, cogMarks: [2, 0, 0, 0], tolerance: 0 });
    assert.equal(result.actualByLevel.Knowledge, 2);
    assert.deepEqual(result.unmapped, [{ number: '9.1', marks: 3 }]);
  });

  test('handles plans without the Q prefix', () => {
    const plan = { questions: [{ number: '1', type: 'x', topic: 'x', marks: 5, cogLevel: 'Knowledge' }] };
    const paper = '1.1 Recall. (5)';
    const result = verifyCogBalance({ paper, plan, cog: COG, cogMarks: [5, 0, 0, 0], tolerance: 0 });
    assert.equal(result.actualByLevel.Knowledge, 5);
  });
});

describe('verifyCogBalance — drift detection', () => {
  test('flags an over-allocated level', () => {
    const plan = makePlan([
      ['Q1', 'Routine Procedures'],
      ['Q2', 'Routine Procedures'],
    ]);
    const paper = [
      '1.1 Routine. (10)',
      '2.1 Routine. (10)',
    ].join('\n');
    const result = verifyCogBalance({ paper, plan, cog: COG, cogMarks: [0, 5, 0, 0], tolerance: 1 });
    assert.equal(result.clean, false);
    assert.equal(result.imbalances.length, 1);
    assert.equal(result.imbalances[0].level, 'Routine Procedures');
    assert.equal(result.imbalances[0].drift, 15);
  });

  test('flags an under-allocated level', () => {
    const plan = makePlan([['Q1', 'Problem Solving']]);
    const paper = '1.1 Problem. (2)';
    const result = verifyCogBalance({ paper, plan, cog: COG, cogMarks: [0, 0, 0, 10], tolerance: 1 });
    assert.equal(result.clean, false);
    assert.equal(result.imbalances[0].level, 'Problem Solving');
    assert.equal(result.imbalances[0].drift, -8);
  });

  test('accepts drift within tolerance', () => {
    const plan = makePlan([['Q1', 'Knowledge']]);
    const paper = '1.1 Recall. (11)';
    // tolerance=1, prescribed=10, actual=11 → drift=+1, within tolerance.
    const result = verifyCogBalance({ paper, plan, cog: COG, cogMarks: [10, 0, 0, 0], tolerance: 1 });
    assert.equal(result.clean, true);
    assert.equal(result.imbalances.length, 0);
  });

  test('reports drift of exactly tolerance as CLEAN', () => {
    const plan = makePlan([['Q1', 'Knowledge']]);
    const paper = '1.1 Recall. (11)';
    // drift=+1 equals tolerance; Math.abs(1) > 1 is false.
    const result = verifyCogBalance({ paper, plan, cog: COG, cogMarks: [10, 0, 0, 0], tolerance: 1 });
    assert.equal(result.clean, true);
  });
});

describe('verifyCogBalance — low-confidence guard', () => {
  test('sets lowConfidence=true and empty imbalances when >20% unmapped', () => {
    const plan = makePlan([['Q1', 'Knowledge']]);
    const paper = [
      '1.1 Mapped. (5)',
      '8.1 Unmapped. (10)',
      '9.1 Unmapped. (10)',
    ].join('\n');
    // Mapped = 5, unmapped = 20, ratio = 5/25 = 0.2 → lowConfidence.
    const result = verifyCogBalance({ paper, plan, cog: COG, cogMarks: [0, 0, 0, 0], tolerance: 0 });
    assert.equal(result.lowConfidence, true);
    assert.deepEqual(result.imbalances, []);
  });
});

describe('formatImbalances', () => {
  test('produces a human-readable feedback string', () => {
    const result = {
      imbalances: [
        { level: 'Knowledge',          prescribed: 10, actual: 12, drift: 2 },
        { level: 'Problem Solving',    prescribed: 4,  actual: 0,  drift: -4 },
      ],
    };
    const out = formatImbalances(result);
    assert.match(out, /Knowledge: plan requires 10 marks, paper has 12 \(drift \+2\)/);
    assert.match(out, /Problem Solving: plan requires 4 marks, paper has 0 \(drift -4\)/);
  });
});
