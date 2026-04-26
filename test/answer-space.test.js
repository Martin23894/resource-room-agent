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
  test('MCQ gets a single "Answer:" line after the last option', () => {
    const input = [
      '1.1 Zanele wants to separate iron filings from sand. Which method? (1)',
      'a. Filtration',
      'b. Evaporation',
      'c. Magnetism',
      'd. Chromatography',
    ].join('\n');
    const out = ensureAnswerSpace(input);
    const lines = out.split('\n');
    const optDIdx = lines.findIndex((l) => /^d\.\s/.test(l));
    assert.ok(optDIdx >= 0);
    assert.match(lines[optDIdx + 1], /^Answer:/);
    // No stray blank-underscore lines directly after the question.
    assert.equal(blanksAfter(out, '1.1'), 0);
  });

  test('MCQ with existing Answer: line is left untouched', () => {
    const input = [
      '1.1 Which gas? (1)',
      'a. Oxygen',
      'b. Nitrogen',
      'c. Carbon dioxide',
      'd. Hydrogen',
      'Answer: _______________________________________________',
    ].join('\n');
    const out = ensureAnswerSpace(input);
    // Should still have exactly one Answer line, not two.
    const answerCount = (out.match(/^Answer:/gm) || []).length;
    assert.equal(answerCount, 1);
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

describe('ensureAnswerSpace — reorders MCQ options misplaced after answer line (Bug 6)', () => {
  test('option E placed after Answer line is moved to before it', () => {
    const input = [
      '1.4 Rangskik die volgende. (4)',
      '',
      'A. opt A',
      'B. opt B',
      'C. opt C',
      'D. opt D',
      'Answer: ' + BLANK,
      'E. opt E',
    ].join('\n');
    const out = ensureAnswerSpace(input).split('\n');
    const eIdx = out.findIndex((l) => l.startsWith('E. opt E'));
    const ansIdx = out.findIndex((l) => /^Answer:\s*_/.test(l));
    assert.ok(eIdx > 0, 'E option should still be present');
    assert.ok(ansIdx > eIdx, 'Answer line must come AFTER option E');
  });

  test('does NOT steal MCQ options from the next sub-question', () => {
    const input = [
      '1.5 Rangskik (4)',
      'A. a','B. b','C. c','D. d',
      'Answer: ' + BLANK,
      'E. e',
      '',
      '1.6 Watter is korrek? (1)',
      'A. eerste','B. tweede','C. derde','D. vierde',
    ].join('\n');
    const out = ensureAnswerSpace(input).split('\n');
    // Q1.6's options must still appear AFTER the "1.6 …" header line.
    const q16Idx = out.findIndex((l) => l.startsWith('1.6 '));
    const aEersteIdx = out.findIndex((l) => l.includes('A. eerste'));
    const bTweedeIdx = out.findIndex((l) => l.includes('B. tweede'));
    assert.ok(aEersteIdx > q16Idx, '"A. eerste" must follow "1.6 …", not be hoisted before Q1.5 answer');
    assert.ok(bTweedeIdx > q16Idx, '"B. tweede" must follow "1.6 …", not be hoisted before Q1.5 answer');
  });

  test('Afrikaans Antwoord stub also triggers the reorder', () => {
    const input = [
      '1.4 Rangskik (4)',
      'A. a','B. b','C. c','D. d',
      'Antwoord: ' + BLANK,
      'E. e',
    ].join('\n');
    const out = ensureAnswerSpace(input, { language: 'Afrikaans' }).split('\n');
    const eIdx = out.findIndex((l) => l.startsWith('E. e'));
    const ansIdx = out.findIndex((l) => /^Antwoord:\s*_/.test(l));
    assert.ok(ansIdx > eIdx, 'Antwoord line must come AFTER option E');
  });

  test('Nat Sci pattern: option d after stub + stem in between is recovered', () => {
    // Real Grade 7 Afrikaans Nat Sci sample: AI emits options a/b/c for the
    // NEXT MCQ before that MCQ's stem, then a stub, then the stem, then the
    // stranded "d" option. The reorder must move "d" back above the stub
    // even though the question stem and blank lines sit between them. The
    // stem here (no leading 1.1 prefix) does NOT match SUBQ_WITH_MARKS, so
    // the reorder loop must walk past it.
    const input = [
      'a. Die Indiese Oseaan',
      'b. Die lug wat ons asemhaal',
      'c. Die rotsgrond van die Drakensberge',
      'Answer: ' + BLANK,
      '',
      "Watter een van die volgende is 'n voorbeeld van die LITOSFER? (1)",
      '',
      "d. 'n Wolk bo Durban",
    ].join('\n');
    const out = ensureAnswerSpace(input, { language: 'Afrikaans' }).split('\n');
    const dIdx = out.findIndex((l) => l.startsWith("d. 'n Wolk"));
    const ansIdx = out.findIndex((l) => /^Answer:\s*_/.test(l));
    assert.ok(dIdx >= 0, 'option d must still exist');
    assert.ok(ansIdx > dIdx, 'Answer stub must end up AFTER option d, not before');
  });
});

describe('ensureAnswerSpace — places injected stub after the TRUE last option (a–h)', () => {
  test('5-option sequencing: injected stub goes after E, not after D', () => {
    // When the question stem itself uses a numbered prefix (so the main
    // injection loop fires), the last-option search must use a-h not a-d
    // — otherwise a sequencing question's stub gets jammed between D and E.
    const input = [
      '1.4 Rangskik die gebeure in volgorde. (4)',
      'A. opt A',
      'B. opt B',
      'C. opt C',
      'D. opt D',
      'E. opt E',
    ].join('\n');
    const out = ensureAnswerSpace(input).split('\n');
    const eIdx = out.findIndex((l) => l.startsWith('E. opt E'));
    const ansIdx = out.findIndex((l) => /^Answer:\s*_/.test(l));
    assert.ok(eIdx >= 0, 'E option preserved');
    assert.ok(ansIdx > eIdx, 'Answer stub must follow E, not be wedged between D and E');
  });
});
