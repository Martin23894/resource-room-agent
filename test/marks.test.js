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

  // ─── F1 regression — Resource 5 hierarchical question double-counting ───

  test('F1 / Resource 5: parent (X) is skipped when lettered sub-parts have their own (X)', () => {
    // R5 Q12.2: parent "(4)" total + sub-parts "(a) ... (1)" and "(b) ... (3)"
    // should count as 4, not 8. Without the fix, the parent (4) was added
    // on top of the children (1)+(3), inflating the total.
    const paper = [
      '12.2 Mr Petersen\'s method represents an old trading system. (4)',
      '',
      '(a) Name this trading system. (1)',
      '',
      '(b) Explain TWO reasons. (3)',
    ].join('\n');
    assert.equal(countMarks(paper), 4);
  });

  test('F1: no double-count even when parent and (a) are adjacent (no blank line)', () => {
    const paper = [
      '12.3 Anri receives an EFT. (4)',
      '(a) What does EFT stand for? (1)',
      '(b) Calculate the amount. (1)',
      '(c) Reason. (2)',
    ].join('\n');
    assert.equal(countMarks(paper), 4);
  });

  test('F1: parent without lettered children is still counted (no false skip)', () => {
    // Plain top-level questions with no (a)/(b) sub-parts must still be
    // counted exactly once. The skip rule is conservative: it requires
    // a lettered sub-part to follow.
    const paper = [
      '7.1 Name two SA provinces. (2)',
      '7.2 Define photosynthesis. (3)',
      '7.3 Calculate 15 × 4. (2)',
    ].join('\n');
    assert.equal(countMarks(paper), 7);
  });

  test('F1: numbered sub-questions (12.1, 12.2) without parent total still sum normally', () => {
    // When the parent line has NO (X) — just a heading like "Question 12" —
    // the children sum normally with no skip applied.
    const paper = [
      'Question 12',
      '',
      '12.1 (a) Identify three. (3)',
      '(b) Explain. (3)',
      '',
      '12.2 (a) Name. (1)',
      '(b) Reasons. (3)',
    ].join('\n');
    // Q12.1 has no parent total (just sub-parts) → 3+3=6
    // Q12.2 has no parent total (just sub-parts) → 1+3=4
    // Total = 10
    assert.equal(countMarks(paper), 10);
  });

  test('F1: nested numbered children (12.1.1) do not trigger the parent-skip', () => {
    // The skip is ONLY for lettered (a)/(b) sub-parts, not for nested
    // numbered sub-questions. Nested numbers (12.1.1, 12.1.2) carry
    // their own marks and the parent should also count normally if it
    // has its own bracketed mark — but typical CAPS practice is that
    // a numbered parent has NO mark when nested numbers carry marks,
    // so this edge case is informational rather than a real failure mode.
    const paper = [
      '12.1.1 Subquestion one. (2)',
      '12.1.2 Subquestion two. (3)',
    ].join('\n');
    assert.equal(countMarks(paper), 5);
  });

  test('F1: skip stops at the next numbered question (does not steal across boundaries)', () => {
    // If a parent has NO lettered (a)/(b) and the very next numbered
    // question DOES have lettered children, we must not mistakenly
    // skip the parent's mark.
    const paper = [
      '12.1 First question. (2)',
      '',
      '12.2 Second question. (4)',
      '(a) Sub a. (1)',
      '(b) Sub b. (3)',
    ].join('\n');
    // Q12.1 (2) → counted (no lettered child of 12.1)
    // Q12.2 (4) → skipped (has lettered children)
    // Sub (a) (1) + sub (b) (3) → 4
    // Total: 2 + 4 = 6
    assert.equal(countMarks(paper), 6);
  });
});
