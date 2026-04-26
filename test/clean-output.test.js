import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { cleanOutput, localiseLabels } from '../lib/clean-output.js';

describe('cleanOutput — drops commentary lines', () => {
  test('drops STEP N headers', () => {
    const out = cleanOutput('STEP 1 — Count marks\n1.1 What is 2+2? (1)');
    assert.doesNotMatch(out, /STEP 1/);
    assert.match(out, /1\.1/);
  });

  test('drops CORRECTED / UPDATED meta-headers', () => {
    const out = cleanOutput(['CORRECTED MEMORANDUM', 'UPDATED Answer: 42', 'Real content'].join('\n'));
    assert.doesNotMatch(out, /CORRECTED/);
    assert.doesNotMatch(out, /UPDATED/);
    assert.match(out, /Real content/);
  });

  test('drops branding leaks from content', () => {
    const out = cleanOutput('THE RESOURCE ROOM\n\n1.1 Question? (1)');
    assert.doesNotMatch(out, /THE RESOURCE ROOM/);
    assert.match(out, /1\.1/);
  });

  test("drops 'Let me try / I must recheck' reasoning", () => {
    const out = cleanOutput([
      'Let me try again.',
      'I must recheck the count.',
      'RECHECK: 4+4+2 = 10',
      '1.1 What is 10? (1)',
    ].join('\n'));
    assert.doesNotMatch(out, /Let me try/i);
    assert.doesNotMatch(out, /I must recheck/i);
    assert.doesNotMatch(out, /RECHECK:/);
    assert.match(out, /1\.1/);
  });

  test('drops placeholder diagram lines', () => {
    const out = cleanOutput('[diagram of plant cell]\n[figure 1]\n[image goes here]\nReal content');
    assert.doesNotMatch(out, /\[diagram/i);
    assert.doesNotMatch(out, /\[figure/i);
    assert.doesNotMatch(out, /\[image/i);
    assert.match(out, /Real content/);
  });

  test('collapses long recount scratchpad lines to empty', () => {
    const scratch = 'Let me recount: ' + Array.from({ length: 40 }, (_, i) => `${i + 1} + ${i + 2}`).join(' already counted cumulative ');
    assert.ok(scratch.length > 300);
    const out = cleanOutput(scratch + '\n1.1 Real question (1)');
    assert.doesNotMatch(out, /already counted/);
    assert.match(out, /1\.1 Real question/);
  });

  test('collapses consecutive blank lines to one', () => {
    const out = cleanOutput('Line 1\n\n\n\n\nLine 2');
    const blanks = out.split('\n').filter((l) => l.trim() === '').length;
    assert.equal(blanks, 1);
  });

  test('drops the ⚠ DISTRIBUTION NOTE commentary block (one-line variant)', () => {
    // The real leak observed in a Grade 6 History project — Claude writes
    // the entire warning on a single long line.
    const input = [
      'High Order | 20% | 8 | 0 | 0.0%',
      '',
      "**⚠ COGNITIVE LEVEL DISTRIBUTION NOTE:** This paper does not meet the prescribed cognitive level distribution. The prescribed allocation requires Middle Order = 50% (20 marks) and High Order = 20% (8 marks). However, the actual paper allocates Middle Order = 70% (28 marks) and High Order = 0% (0 marks). No High Order questions have been included in this paper. The question paper should be revised to include High Order questions worth 8 marks.",
      '',
      'Low Order (12 marks): Q1.1 (1) + Q1.2 (1) = 12 marks',
    ].join('\n');
    const out = cleanOutput(input);
    assert.doesNotMatch(out, /DISTRIBUTION NOTE/i);
    assert.doesNotMatch(out, /This paper does not meet/i);
    assert.doesNotMatch(out, /⚠/);
    // Surrounding legitimate content must survive.
    assert.match(out, /High Order \| 20%/);
    assert.match(out, /Low Order \(12 marks\)/);
  });

  test('drops a multi-line DISTRIBUTION NOTE block', () => {
    const input = [
      'High Order | 20% | 8 | 0 | 0.0%',
      '',
      '⚠ COGNITIVE LEVEL DISTRIBUTION NOTE:',
      'This paper does not meet the prescribed cognitive level distribution.',
      'The question paper should be revised to include High Order questions.',
      'No High Order questions have been included.',
      '',
      'Low Order (12 marks): Q1.1 (1) + Q1.2 (1) = 12 marks',
    ].join('\n');
    const out = cleanOutput(input);
    assert.doesNotMatch(out, /DISTRIBUTION NOTE/i);
    assert.doesNotMatch(out, /This paper does not meet/i);
    assert.doesNotMatch(out, /No High Order questions/i);
    assert.doesNotMatch(out, /The question paper should be revised/i);
    assert.match(out, /Low Order \(12 marks\)/);
  });

  test('keeps only the LAST Cognitive Level table when Claude iterates', () => {
    // Regression: Claude sometimes writes a table, recounts aloud, writes a
    // corrected table. The final table is the one we want.
    const input = [
      'Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual %',
      'Low Order | 50% | 20 | 20 | 50.0%',
      'Middle Order | 35% | 14 | 13 | 32.5%',
      'High Order | 15% | 6 | 7 | 17.5%',
      'TOTAL | 100% | 40 | 40 | 100%',
      '',
      'High Order (7 marks): Q9.1 (1) + Q9.2 (2) + Q10.3 was not listed; confirmed sum: = 6 marks',
      'High Order (7 marks): Q9.1 (1) + [remaining 1 mark from Q10 total] = 7 marks',
      '',
      'Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual %',
      'Low Order | 50% | 20 | 20 | 50.0%',
      'Middle Order | 35% | 14 | 14 | 35.0%',
      'High Order | 15% | 6 | 6 | 15.0%',
      'TOTAL | 100% | 40 | 40 | 100%',
    ].join('\n');
    const out = cleanOutput(input);
    const tables = out.match(/Cognitive Level \| Prescribed %/g) || [];
    assert.equal(tables.length, 1, 'should collapse to one table');
    // The surviving table is the corrected one (Middle=14, High=6).
    assert.match(out, /Middle Order \| 35% \| 14 \| 14/);
    assert.match(out, /High Order \| 15% \| 6 \| 6/);
    // The reasoning noise is gone.
    assert.doesNotMatch(out, /was not listed/);
    assert.doesNotMatch(out, /confirmed sum/);
    assert.doesNotMatch(out, /\[remaining/);
  });

  test('preserves the Cognitive Level analysis table in full', () => {
    // Regression: an earlier dedup rule matched both the section heading
    // "COGNITIVE LEVEL ANALYSIS" and the case-insensitive table column
    // header "Cognitive Level", so the analysis table was cut off at its
    // own first row. The whole table must survive.
    const input = [
      'SECTION: COGNITIVE LEVEL ANALYSIS (Bloom\'s Taxonomy)',
      '',
      'Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual %',
      'Low Order | 30% | 15 | 13 | 26%',
      'Middle Order | 50% | 25 | 22 | 44%',
      'High Order | 20% | 10 | 15 | 30%',
      '',
      'SECTION: EXTENSION ACTIVITY',
      'Write one challenging question.',
    ].join('\n');
    const out = cleanOutput(input);
    assert.match(out, /Low Order \| 30%/);
    assert.match(out, /Middle Order \| 50%/);
    assert.match(out, /High Order \| 20%/);
    assert.match(out, /EXTENSION ACTIVITY/);
  });
});

describe('cleanOutput — preserves real content', () => {
  test('keeps section headers, question numbers and marks', () => {
    const input = [
      'SECTION A: Comprehension',
      '1.1 What is photosynthesis? (2)',
      '1.2 Name the green substance. (1)',
      'TOTAL: _____ / 3 marks',
    ].join('\n');
    const out = cleanOutput(input);
    assert.match(out, /SECTION A/);
    assert.match(out, /1\.1/);
    assert.match(out, /1\.2/);
    assert.match(out, /TOTAL: _____/);
  });

  test('keeps blank answer lines', () => {
    const input = '1.1 Answer in full. (2)\n_______________________________________________\n_______________________________________________';
    const out = cleanOutput(input);
    const underscoreLines = out.split('\n').filter((l) => /^_{5,}$/.test(l.trim())).length;
    assert.equal(underscoreLines, 2);
  });

  test('keeps Afrikaans content untouched', () => {
    const input = 'Vraag 1: Fotosintese\n1.1 Wat is fotosintese? (2)';
    const out = cleanOutput(input);
    assert.match(out, /Vraag 1:/);
    assert.match(out, /Wat is fotosintese/);
  });

  test('empty string returns empty string', () => {
    assert.equal(cleanOutput(''), '');
    assert.equal(cleanOutput(null), null);
    assert.equal(cleanOutput(undefined), undefined);
  });

  test('unescapes \\_ markdown escapes to plain underscores', () => {
    // Regression: True/False questions came out as
    //   "A cube has 6 faces. \\_\\_\\_\\_\\_\\_\\_\\_ (1)"
    // The backslashes (markdown underscore escapes) rendered literally AND
    // broke the /_{3,}/ detection in ensureAnswerSpace, triggering extra
    // blank answer lines below.
    const input = '2.1 A cube has 6 faces. \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_ (1)';
    const out = cleanOutput(input);
    assert.match(out, /_{10,}/, 'should collapse into a run of plain underscores');
    assert.doesNotMatch(out, /\\_/);
  });

  test('unescapes \\* markdown escapes to plain asterisks', () => {
    const input = 'A formula like a \\* b = c';
    const out = cleanOutput(input);
    assert.match(out, /a \* b = c/);
    assert.doesNotMatch(out, /\\\*/);
  });
});

describe('localiseLabels — Afrikaans answer/working stub localisation (Bug 3)', () => {
  test('English papers are unchanged', () => {
    const input = 'Working: ___\nAnswer: ___';
    assert.equal(localiseLabels(input, 'English'), input);
  });
  test('Afrikaans papers get Antwoord:/Werking: at line start', () => {
    const out = localiseLabels('Working: ___\nAnswer: ___', 'Afrikaans');
    assert.equal(out, 'Werking: ___\nAntwoord: ___');
  });
  test('does NOT replace the words mid-sentence (passage text safe)', () => {
    const input = "Sipho will answer: he doesn't know.\nThe answer: not yet given.";
    const out = localiseLabels(input, 'Afrikaans');
    assert.equal(out, input, 'mid-sentence "answer:" must not be touched');
  });
  test('null / undefined / empty input is safe', () => {
    assert.equal(localiseLabels('', 'Afrikaans'), '');
    assert.equal(localiseLabels(null, 'Afrikaans'), null);
    assert.equal(localiseLabels(undefined, 'Afrikaans'), undefined);
  });
});

describe('cleanOutput — Afrikaans cog table dedup (Bug 1)', () => {
  test('keeps only the LAST Kognitiewe Vlak table when there are two', () => {
    const input = [
      '| Kognitiewe Vlak | Voorgeskrewe % |',
      '| Letterlik | 20% |',
      'some recount commentary',
      '| Kognitiewe Vlak | Voorgeskrewe % |',
      '| Letterlik | 25% |',
    ].join('\n');
    const out = cleanOutput(input);
    const headers = (out.match(/Kognitiewe Vlak/g) || []).length;
    assert.equal(headers, 1, 'should keep only one Kognitiewe Vlak header');
    assert.match(out, /25%/, 'should keep the LAST table (25%)');
    assert.doesNotMatch(out, /20%/, 'should drop the first table (20%)');
  });
});

describe('cleanOutput — Afrikaans META_COMMENTARY_RULES (Bug 2)', () => {
  test('drops "Wag —" thinking-aloud lines', () => {
    const out = cleanOutput('Wag — laat my dit weer probeer\n1.1 Vraag (1)');
    assert.doesNotMatch(out, /Wag —/);
    assert.match(out, /1\.1 Vraag/);
  });
  test('drops "Laat my probeer" lines', () => {
    const out = cleanOutput('Laat my probeer weer\n1.1 Vraag (1)');
    assert.doesNotMatch(out, /Laat my probeer/);
    assert.match(out, /1\.1 Vraag/);
  });
  test('drops "Eintlik —" lines', () => {
    const out = cleanOutput('Eintlik — ek het 8 punte gemis\n1.1 Vraag (1)');
    assert.doesNotMatch(out, /Eintlik —/);
  });
  test('drops Afrikaans VERSPREIDINGSNOTA paragraph', () => {
    const out = cleanOutput('Hierdie vraestel voldoen nie aan CAPS nie\n1.1 Vraag (1)');
    assert.doesNotMatch(out, /Hierdie vraestel voldoen nie/i);
  });
});
