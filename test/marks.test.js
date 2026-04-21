import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { countMarks } from '../lib/marks.js';

describe('countMarks', () => {
  test('returns 0 for empty or missing input', () => {
    assert.equal(countMarks(''), 0);
    assert.equal(countMarks(null), 0);
    assert.equal(countMarks(undefined), 0);
  });

  test('sums per-item (N) marks at end of line', () => {
    const paper = [
      '1.1 Name two SA provinces. (2)',
      '1.2 Define photosynthesis. (3)',
      '1.3 Calculate 15 × 4. (2)',
    ].join('\n');
    assert.equal(countMarks(paper), 7);
  });

  test('falls back to [N] block totals when no per-item marks present', () => {
    const memoTable = [
      'MEMORANDUM',
      'Section A [10]',
      'Section B [15]',
      'TOTAL: 25 marks',
    ].join('\n');
    assert.equal(countMarks(memoTable), 25);
  });

  test('ignores [N] blocks when (N) per-item marks are present', () => {
    // When both patterns appear, we prefer per-item counts to avoid double-counting.
    const paper = [
      'Question 1 [5]',
      '1.1 X? (2)',
      '1.2 Y? (3)',
    ].join('\n');
    assert.equal(countMarks(paper), 5); // only the per-item (2)+(3)
  });

  test('handles multi-digit marks', () => {
    const paper = '4.1 Essay prompt. (25)\n4.2 Short answer. (5)';
    assert.equal(countMarks(paper), 30);
  });

  test('does not match (N) that is not at line end', () => {
    const paper = 'See note (1) above.\n1.1 Answer: (4)';
    // Only the (4) at line end should count; the (1) is mid-line.
    assert.equal(countMarks(paper), 4);
  });

  test('typical 50-mark paper sums correctly', () => {
    const paper = Array.from({ length: 10 }, (_, i) => `${i + 1}.1 Q? (5)`).join('\n');
    assert.equal(countMarks(paper), 50);
  });
});
