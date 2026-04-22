import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ensureAnswerSpace } from '../lib/answer-space.js';

const BLANK = '_______________________________________________';

function blanksAfter(out, anchor) {
  const lines = out.split('\n');
  const idx = lines.findIndex((l) => l.includes(anchor));
  assert.ok(idx >= 0, `anchor "${anchor}" not found in output`);
  let n = 0;
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].trim() === BLANK) n++;
    else break;
  }
  return n;
}

describe('ensureAnswerSpace — injects lines when missing', () => {
  test('1-mark short answer gets 2 blank lines', () => {
    const input = '8.1 Name ONE Moon phase during which spring tides occur. (1)';
    const out = ensureAnswerSpace(input);
    assert.equal(blanksAfter(out, '8.1'), 2);
  });

  test('2-mark "list" question scales by the item count', () => {
    const input = '6.1 Write down the names of the eight planets of our Solar System. (2)';
    const out = ensureAnswerSpace(input);
    // "eight" → 8 lines for 8 items
    assert.equal(blanksAfter(out, '6.1'), 8);
  });

  test('2-mark "describe" question gets 2 blank lines', () => {
    const input = '7.1 Describe the steps Sipho should follow to separate all three substances. (2)';
    const out = ensureAnswerSpace(input);
    assert.equal(blanksAfter(out, '7.1'), 2);
  });

  test('5-mark long-answer question gets 4 blank lines', () => {
    const input = '9.1 Explain in detail how photosynthesis works in green plants. (5)';
    const out = ensureAnswerSpace(input);
    assert.equal(blanksAfter(out, '9.1'), 4);
  });

  test('8-mark extended answer gets 4 blank lines', () => {
    const input = '10.1 Discuss the causes and consequences of the 1976 Soweto Uprising. (8)';
    const out = ensureAnswerSpace(input);
    assert.equal(blanksAfter(out, '10.1'), 4);
  });
});

describe('ensureAnswerSpace — skips injection when space already exists', () => {
  test('MCQ with options is left untouched', () => {
    const input = [
      '1.1 Zanele wants to separate iron filings from sand. Which method? (1)',
      'a. Filtration',
      'b. Evaporation',
      'c. Magnetism',
      'd. Chromatography',
    ].join('\n');
    const out = ensureAnswerSpace(input);
    assert.equal(blanksAfter(out, '1.1'), 0);
  });

  test('question followed by existing underscore line is left untouched', () => {
    const input = [
      '2.1 Short answer question. (2)',
      BLANK,
      BLANK,
    ].join('\n');
    const out = ensureAnswerSpace(input);
    // Should still have exactly two blanks, no extras added.
    assert.equal(blanksAfter(out, '2.1'), 2);
  });

  test('calculation with Working:/Answer: is left untouched', () => {
    const input = [
      '3.1 Calculate 125 × 8. (3)',
      'Working: ' + BLANK,
      'Answer: ' + BLANK,
    ].join('\n');
    const out = ensureAnswerSpace(input);
    assert.equal(blanksAfter(out, '3.1'), 0);
  });

  test('fill-in-the-blank (underscores in the question itself) is left untouched', () => {
    const input = '4.1 The capital city of Gauteng is _______________. (1)';
    const out = ensureAnswerSpace(input);
    assert.equal(blanksAfter(out, '4.1'), 0);
  });

  test('true/false question is left untouched', () => {
    const input = '5.1 True or False: The Sun is a planet. (1)';
    const out = ensureAnswerSpace(input);
    assert.equal(blanksAfter(out, '5.1'), 0);
  });

  test('matching question with pipe table is left untouched', () => {
    const input = [
      '6.1 Match the columns below. (4)',
      '| Column A | Column B |',
      '|----------|----------|',
      '| Sun | Star |',
      '| Moon | Satellite |',
    ].join('\n');
    const out = ensureAnswerSpace(input);
    assert.equal(blanksAfter(out, '6.1'), 0);
  });
});

describe('ensureAnswerSpace — leaves non-question content alone', () => {
  test('question headings (no mark on the line) are ignored', () => {
    const input = 'Question 1: Separating Mixtures';
    assert.equal(ensureAnswerSpace(input), input);
  });

  test('section block totals like [10] are ignored', () => {
    const input = 'End of Section A [10]';
    assert.equal(ensureAnswerSpace(input), input);
  });

  test('empty string returns empty string', () => {
    assert.equal(ensureAnswerSpace(''), '');
    assert.equal(ensureAnswerSpace(null), null);
    assert.equal(ensureAnswerSpace(undefined), undefined);
  });

  test('is idempotent — running twice gives the same result', () => {
    const input = [
      '1.1 Short answer. (1)',
      '1.2 Another short answer. (2)',
      '1.3 Long answer. (5)',
    ].join('\n');
    const once = ensureAnswerSpace(input);
    const twice = ensureAnswerSpace(once);
    assert.equal(twice, once);
  });
});
