import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { cleanOutput, localiseLabels, stripLeadingMemoBanner, scrubInCellMetaCommentary } from '../lib/clean-output.js';

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

describe('localiseLabels — tolerates leading whitespace (Bug 3 follow-up)', () => {
  test('indented Answer: line is also localised', () => {
    const input = '    Answer: ___\n  Working: ___';
    const out = localiseLabels(input, 'Afrikaans');
    assert.equal(out, '    Antwoord: ___\n  Werking: ___', 'indented stubs must localise too');
  });
});

describe('cleanOutput — MEMORANDUM dedup (Bug 4)', () => {
  test('drops a second MEMORANDUM banner that follows the first with only blanks', () => {
    const input = ['MEMORANDUM', '', '', 'MEMORANDUM', '', 'NO. | ANSWER | ...'].join('\n');
    const out = cleanOutput(input);
    const banners = (out.match(/^MEMORANDUM$/gm) || []).length;
    assert.equal(banners, 1, 'duplicate MEMORANDUM should collapse to one');
  });

  test('keeps a MEMORANDUM banner if real content separates the two', () => {
    const input = [
      'MEMORANDUM',
      'NO. | ANSWER | ...',
      '| 1.1 | a |',
      '',
      'MEMORANDUM',
      'NO. | ANSWER | ...',
    ].join('\n');
    const out = cleanOutput(input);
    const banners = (out.match(/^MEMORANDUM$/gm) || []).length;
    assert.equal(banners, 2, 'distinct memo phases separated by content keep their banners');
  });
});

describe('stripLeadingMemoBanner — drops leading memo headers from RTT phase output', () => {
  test('strips a bare MEMORANDUM line and the title that follows', () => {
    const input = [
      'MEMORANDUM',
      '',
      'Grade 6 Afrikaans Huistaal — Reaksie op Teks — Kwartaal 4',
      "CAPS-belyn | Barrett se Taksonomie-raamwerk",
      '',
      'NR. | ANTWOORD | NASIENRIGLYN | KOGNITIEWE VLAK | PUNT',
      '| 1.1 | Bergzicht Primêr | … | Literal | 1 |',
    ].join('\n');
    const out = stripLeadingMemoBanner(input);
    assert.doesNotMatch(out, /^MEMORANDUM/);
    assert.doesNotMatch(out, /CAPS-belyn/);
    assert.match(out, /^NR\./, 'first surviving line should be the answer table header');
  });

  test('passes through phase output that already starts with table content', () => {
    const input = 'NO. | ANSWER | ...\n| 1.1 | a |';
    assert.equal(stripLeadingMemoBanner(input), input);
  });

  test('null/empty/undefined are safe', () => {
    assert.equal(stripLeadingMemoBanner(''), '');
    assert.equal(stripLeadingMemoBanner(null), null);
    assert.equal(stripLeadingMemoBanner(undefined), undefined);
  });

  test('strips TWO consecutive banner blocks (Bug 4: Paper 9 leak shape)', () => {
    // Real Paper 9 leak: model emitted an outer banner + framework, then a
    // second banner with a passage-title reprise, then the actual answer
    // table. Both banner blocks must be stripped — the outer assembly
    // prepends its own single banner.
    const input = [
      'MEMORANDUM',
      '',
      'Graad 6 Afrikaans Huistaal — Reaksie op Teks — Kwartaal 2',
      'CAPS-belyn | Barrett se Taksonomie-raamwerk',
      '',
      'MEMORANDUM',
      '',
      'Graad 6 Afrikaans Huistaal | Die Groot Skoolfees',
      '',
      '| NR. | ANTWOORD | NASIENRIGLYN | KOGNITIEWE VLAK | PUNT |',
      '|---|---|---|---|---|',
      '| 1.1 | Hoërskool Uitenhage | … | Letterlik | 1 |',
    ].join('\n');
    const out = stripLeadingMemoBanner(input);
    const banners = (out.match(/^MEMORANDUM\b/gm) || []).length;
    assert.equal(banners, 0, 'both leading MEMORANDUM banners must be stripped');
    assert.doesNotMatch(out, /CAPS-belyn/, 'framework line stripped');
    assert.doesNotMatch(out, /Die Groot Skoolfees/, 'passage-title reprise stripped');
    assert.match(out, /^\| NR\.\s*\|/m, 'answer table is the first surviving content');
    assert.match(out, /Hoërskool Uitenhage/, 'answer rows preserved');
  });

  test('preserves a "PART N —" header when it follows the banner block', () => {
    // RTT memoBC starts with `MEMORANDUM\n\nPART 1 — AFDELING B …\n\n| NR. | …`
    // The banner block is removed, but the PART 1 — heading stays.
    const input = [
      'MEMORANDUM',
      '',
      'PART 1 — AFDELING B: VISUELE TEKS [10]',
      '',
      '| NR. | ANTWOORD | … |',
    ].join('\n');
    const out = stripLeadingMemoBanner(input);
    assert.doesNotMatch(out, /^MEMORANDUM/);
    assert.match(out, /^PART 1 —/);
  });

  test('handles a third banner emitted between the framework and the body', () => {
    const input = [
      'MEMORANDUM',
      '',
      'Subtitle 1',
      '',
      'MEMORANDUM',
      '',
      'Subtitle 2',
      '',
      'MEMORANDUM',
      '',
      'Subtitle 3',
      '',
      '| 1.1 | a | b | level | 1 |',
    ].join('\n');
    const out = stripLeadingMemoBanner(input);
    assert.doesNotMatch(out, /^MEMORANDUM/);
    assert.match(out, /^\| 1\.1 \|/);
  });
});

describe('cleanOutput — Bug 21: phase-commentary preamble lines', () => {
  test('drops "Q7.2: The error report confirms…" leaked phase commentary', () => {
    const out = cleanOutput([
      'Q7.2: The error report confirms the answer is already correct (R29 000) and says "No change — calculation is correct." So Q7.2 requires no change.',
      'Q7.4: The working needs to explicitly state that Option B requires a positive monthly profit.',
      '',
      '| 1.1 | b. Barter | Accept b only | Low Order | 1 |',
    ].join('\n'));
    assert.doesNotMatch(out, /Q7\.2:/);
    assert.doesNotMatch(out, /Q7\.4:/);
    assert.doesNotMatch(out, /error report/i);
    assert.match(out, /\| 1\.1 \| b\. Barter/);
  });

  test('drops "Q3.1: Already correct…" style notes', () => {
    const out = cleanOutput('Q3.1: Already correct — no change needed\n| 3.1 | answer |');
    assert.doesNotMatch(out, /Already correct/i);
    assert.match(out, /\| 3\.1 \| answer \|/);
  });

  test('keeps memo answer rows whose first cell is "Q7.4" (Q-prefix table rows)', () => {
    // Some memos use "Q7.4" / "Q1.1" as the first-cell row label inside a
    // pipe table. Those are CONTENT, not commentary — must survive.
    const out = cleanOutput('| Q7.4 | R12 000 + R1 800 = R13 800 | Award 1 mark | High Order | 2 |');
    assert.match(out, /\| Q7\.4 \| R12 000/);
  });

  test('keeps a legitimate "Q1.2: This table shows…" question stem', () => {
    // Bug 21 regex must not over-match. A learner question that starts
    // with "This" after the question number is real content.
    const out = cleanOutput('Q1.2: This table shows the rainfall figures for 2024. (3)');
    assert.match(out, /This table shows the rainfall figures/);
  });

  test('keeps a legitimate "Q3.1: The working principle of …" stem', () => {
    // Same — "The working" inside a real question stem must not be stripped.
    const out = cleanOutput('Q3.1: The working principle of a battery involves chemical reactions. Discuss. (4)');
    assert.match(out, /working principle of a battery/);
  });

  test('keeps a legitimate "Q4.1: The answer is …" stem', () => {
    const out = cleanOutput('Q4.1: The answer is below this line. (2)');
    assert.match(out, /The answer is below this line/);
  });

  test('still drops "Q7.4: The working needs to explicitly state…" (commentary)', () => {
    // The narrowed regex must still catch the actual Bug 21 pattern.
    const out = cleanOutput([
      'Q7.4: The working needs to explicitly state that Option B requires a positive monthly profit.',
      '| 1.1 | answer |',
    ].join('\n'));
    assert.doesNotMatch(out, /needs to explicitly state/);
    assert.match(out, /\| 1\.1 \| answer \|/);
  });

  test('still drops "Q7.2: The error report confirms…" (commentary)', () => {
    const out = cleanOutput([
      'Q7.2: The error report confirms the answer is already correct.',
      '| 1.1 | answer |',
    ].join('\n'));
    assert.doesNotMatch(out, /error report confirms/);
    assert.match(out, /\| 1\.1 \| answer \|/);
  });

  test('drops a stray ```json fence line', () => {
    const out = cleanOutput('```json\n{"content":"something"\n```\n| 1.1 | answer |');
    assert.doesNotMatch(out, /```json/);
    assert.doesNotMatch(out, /^```$/m);
    assert.match(out, /\| 1\.1 \| answer \|/);
  });

  test('drops a stray opener {"content":" line', () => {
    const out = cleanOutput('{"content":"\n| 1.1 | answer |');
    assert.doesNotMatch(out, /^\{"content"/);
    assert.match(out, /\| 1\.1 \| answer \|/);
  });

  test('drops a stray closing "} line', () => {
    const out = cleanOutput('| 1.1 | answer |\n"}');
    assert.match(out, /\| 1\.1 \| answer \|/);
    assert.doesNotMatch(out, /^"\}$/m);
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

describe('scrubInCellMetaCommentary — Phase 6: in-cell meta-commentary leaks', () => {
  test('Bug 11: NOTE TO EDUCATOR phrase removed from a marking-guidance cell', () => {
    // Resource 1 audit: the 4.7 cell included
    // "NOTE TO EDUCATOR: The original sentence 'Lerato said,' appears
    // incomplete in the question paper. Award marks based on the
    // following model if the full sentence reads…"
    const cell = 'Lerato said that she was going. NOTE TO EDUCATOR: The original sentence appears incomplete in the question paper. Award marks based on the model.';
    const out = scrubInCellMetaCommentary(cell);
    assert.doesNotMatch(out, /NOTE TO EDUCATOR/);
    assert.match(out, /Lerato said that she was going/, 'legitimate cell content preserved');
  });

  test('Bug 27: "Vraag X was onvolledig" stripped from Afrikaans memo cell', () => {
    const cell = 'Kweekhuisgasse vang hitte vas. Vraag 4.4 was onvolledig op die vraestel — beoordeel op grond van wat die leerder verstaan.';
    const out = scrubInCellMetaCommentary(cell);
    assert.doesNotMatch(out, /onvolledig op die vraestel/i);
    assert.match(out, /Kweekhuisgasse/);
  });

  test('Bug 37: "(award both marks together)" parenthetical stripped', () => {
    const cell = 'Figure 6: 30 + 12 = 42 (award both marks together for 7.2)';
    const out = scrubInCellMetaCommentary(cell);
    assert.doesNotMatch(out, /award both marks together/i);
    assert.match(out, /Figure 6: 30 \+ 12 = 42/);
  });

  test('"(see report)" parenthetical stripped', () => {
    const cell = 'Update the working (see error report).';
    const out = scrubInCellMetaCommentary(cell);
    assert.doesNotMatch(out, /see (?:error )?report/i);
  });

  test('legitimate text containing the word "note" is left alone', () => {
    const cell = 'Note that the sum is 7. Also note: this is a real answer.';
    const out = scrubInCellMetaCommentary(cell);
    assert.match(out, /Note that the sum is 7/);
  });

  test('null/empty input is safe', () => {
    assert.equal(scrubInCellMetaCommentary(''), '');
    assert.equal(scrubInCellMetaCommentary(null), null);
  });
});

describe('cleanOutput — Resource 1 Bug 10: phantom answer rows stripped', () => {
  test('"4.8 | [No question 4.8 appears in the paper..." row is removed', () => {
    const memo = [
      '| 4.7 | answer | guidance | Routine | 2 |',
      '| 4.8 | [No question 4.8 appears in the paper — marks already accounted for in 4.1–4.7 above] | N/A | N/A | — |',
      '| TOTAL | | | | 15 |',
    ].join('\n');
    const out = cleanOutput(memo);
    assert.doesNotMatch(out, /No question 4\.8 appears/);
    // The legitimate rows are preserved
    assert.match(out, /\| 4\.7 \| answer \|/);
  });
});
