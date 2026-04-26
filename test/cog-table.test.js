import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseMemoAnswerRows, tallyByLevel, correctCogAnalysisTable } from '../lib/cog-table.js';

describe('parseMemoAnswerRows — extracts (number, level, mark) tuples', () => {
  test('parses a standard 5-column answer table', () => {
    const memo = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | b. South | Accept b only | Low Order | 1 |',
      '| 1.2 | c. Northeast | Accept c only | Low Order | 1 |',
      '| 4.2 | Zimbabwe | Accept | Middle Order | 2 |',
      '| 6.1 | Long answer | Award rubric | High Order | 2 |',
    ].join('\n');
    const rows = parseMemoAnswerRows(memo);
    assert.equal(rows.length, 4);
    assert.deepEqual(rows[0], { number: '1.1', level: 'Low Order', mark: 1 });
    assert.deepEqual(rows[3], { number: '6.1', level: 'High Order', mark: 2 });
  });

  test('parses Afrikaans-headered answer table (NR. | ANTWOORD …)', () => {
    const memo = [
      '| NR. | ANTWOORD | NASIENRIGLYN | KOGNITIEWE VLAK | PUNT |',
      '|---|---|---|---|---|',
      '| 1.1 | Hoërskool | Aanvaar | Letterlik | 1 |',
      '| 1.4 | D, B, C, A | … | Herorganisasie | 4 |',
    ].join('\n');
    const rows = parseMemoAnswerRows(memo);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[1], { number: '1.4', level: 'Herorganisasie', mark: 4 });
  });

  test('skips header and separator rows', () => {
    const memo = [
      '| NO. | ANSWER | GUIDANCE | LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | a | b | Low Order | 1 |',
    ].join('\n');
    const rows = parseMemoAnswerRows(memo);
    assert.equal(rows.length, 1);
  });

  test('skips rows whose mark cell is non-numeric', () => {
    const memo = [
      '| 1.1 | answer | guidance | Low Order | (continued) |',
      '| 1.2 | answer | guidance | Low Order | 1 |',
    ].join('\n');
    const rows = parseMemoAnswerRows(memo);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].number, '1.2');
  });

  test('strips Q prefix from question numbers', () => {
    const memo = '| Q1.1 | a | b | Low Order | 1 |';
    const rows = parseMemoAnswerRows(memo);
    assert.equal(rows[0].number, '1.1');
  });

  test('null/empty memo returns empty array', () => {
    assert.deepEqual(parseMemoAnswerRows(''), []);
    assert.deepEqual(parseMemoAnswerRows(null), []);
    assert.deepEqual(parseMemoAnswerRows(undefined), []);
  });

  test('handles "8.1(a)" parenthesised sub-letter (Paper 10 Maths memo format)', () => {
    // Paper 10 (Grade 7 Wiskunde Eindeksamen) wrote sub-parts as
    // "8.1(a)" / "8.1(b)" — the original ROW_NUMBER_RE only allowed
    // bare-letter suffixes ("8.1a"), so the (a)(b) rows were silently
    // skipped, hiding the Bug 11 over-counting from the cog reconciliation.
    const memo = [
      '| 8.1(a) | 7 677 | working | Roetine Prosedures | 2 |',
      '| 8.1(b) | 5 000 | working | Roetine Prosedures | 2 |',
      '| 8.2 | answer | working | Roetine Prosedures | 2 |',
    ].join('\n');
    const rows = parseMemoAnswerRows(memo);
    assert.equal(rows.length, 3, 'all three Q8 sub-part rows must parse');
    assert.equal(rows[0].number, '8.1(a)');
    assert.equal(rows[1].number, '8.1(b)');
    assert.equal(rows[2].number, '8.2');
  });

  test('handles "8.1 (a)" with space before paren', () => {
    const memo = '| 8.1 (a) | answer | guidance | Routine | 1 |';
    const rows = parseMemoAnswerRows(memo);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].mark, 1);
  });

  test('keeps zero-mark rows (Bug 9: zero-marked Barrett\'s levels are valid)', () => {
    // The Bug 9 fix prompts the model to emit ALL FOUR Barrett's levels
    // even if a level has 0 marks. parseMemoAnswerRows must accept
    // zero-mark rows so tallyByLevel can still see the level exists.
    const memo = [
      '| 1.1 | answer | guidance | Literal | 5 |',
      '| 1.2 | answer | guidance | Reorganisation | 0 |',
      '| 2.1 | answer | guidance | Inferential | 10 |',
    ].join('\n');
    const rows = parseMemoAnswerRows(memo);
    assert.equal(rows.length, 3, 'zero-mark row must not be filtered out');
    assert.equal(rows[1].mark, 0);
    assert.equal(rows[1].level, 'Reorganisation');
  });

  test('rejects negative or non-numeric mark values', () => {
    const memo = [
      '| 1.1 | a | b | Level | -1 |',
      '| 1.2 | a | b | Level | abc |',
      '| 1.3 | a | b | Level | 2 |',
    ].join('\n');
    const rows = parseMemoAnswerRows(memo);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].number, '1.3');
  });
});

describe('tallyByLevel — sums marks per cognitive level', () => {
  test('sums correctly with case/whitespace tolerance', () => {
    const rows = [
      { number: '1.1', level: 'Low Order', mark: 1 },
      { number: '1.2', level: 'low order', mark: 2 },
      { number: '1.3', level: 'Low  Order', mark: 1 },
      { number: '1.4', level: 'High Order', mark: 4 },
    ];
    const t = tallyByLevel(rows);
    assert.equal(t.get('Low Order'), 4, 'collapses case + whitespace variants');
    assert.equal(t.get('High Order'), 4);
  });
});

describe('correctCogAnalysisTable — Bug 5: fixes wrong Actual Marks cells', () => {
  test('rewrites Actual Marks when claim disagrees with answer-table sum', () => {
    // This is the Paper 10 (Maths Eindeksamen) bug: the cog table claims
    // Komplekse Prosedures = 18 but the answer rows sum to 20.
    const memo = [
      '| NR. | ANTWOORD | NASIENRIGLYN | KOGNITIEWE VLAK | PUNT |',
      '|---|---|---|---|---|',
      '| 11.1 | x | y | Komplekse Prosedures | 2 |',
      '| 11.2 | x | y | Komplekse Prosedures | 2 |',
      '| 11.3 | x | y | Komplekse Prosedures | 2 |',
      '| 11.4 | x | y | Komplekse Prosedures | 4 |',
      '| 12.1 | x | y | Komplekse Prosedures | 3 |',
      '| 12.2 | x | y | Komplekse Prosedures | 2 |',
      '| 12.3 | x | y | Komplekse Prosedures | 2 |',
      '| 12.4 | x | y | Komplekse Prosedures | 1 |',
      '| 12.5 | x | y | Komplekse Prosedures | 2 |',
      '| 1.1 | a | b | Kennis | 25 |',
      '| 6.1 | a | b | Roetine Prosedures | 45 |',
      '| 13.1 | a | b | Probleemoplossing | 10 |',
      '',
      '| Kognitiewe Vlak | Voorgeskrewe % | Voorgeskrewe Punte | Werklike Punte | Werklike % |',
      '|---|---|---|---|---|',
      '| Kennis | 25% | 25 | 25 | 25.0% |',
      '| Roetine Prosedures | 45% | 45 | 45 | 45.0% |',
      '| Komplekse Prosedures | 20% | 20 | 18 | 18.0% |',
      '| Probleemoplossing | 10% | 10 | 10 | 10.0% |',
      '| Totaal | 100% | 100 | 98 | 98.0% |',
    ].join('\n');

    const result = correctCogAnalysisTable(memo, {
      levels: ['Kennis', 'Roetine Prosedures', 'Komplekse Prosedures', 'Probleemoplossing'],
      totalMarks: 100,
    });

    assert.equal(result.changed, true, 'must report a change');
    assert.equal(result.computedByLevel['Komplekse Prosedures'], 20);
    assert.equal(result.totalCounted, 100);
    // The cog table row for Komplekse Prosedures must now show 20, not 18.
    assert.match(result.text, /\| Komplekse Prosedures \| 20% \| 20 \| 20 \| 20\.0% \|/);
    // The TOTAL row must show 100, not 98.
    assert.match(result.text, /\| Totaal \| 100% \| 100 \| 100 \| 100% \|/);
    // The other rows weren't touched (their values were already correct).
    assert.match(result.text, /\| Kennis \| 25% \| 25 \| 25 \| 25\.0% \|/);
  });

  test('leaves the table unchanged when the Actual Marks already agree', () => {
    const memo = [
      '| NO. | ANSWER | GUIDANCE | LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | a | b | Low Order | 1 |',
      '| 2.1 | a | b | Middle Order | 2 |',
      '| 3.1 | a | b | High Order | 7 |',
      '',
      '| Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual % |',
      '|---|---|---|---|---|',
      '| Low Order | 10% | 1 | 1 | 10.0% |',
      '| Middle Order | 20% | 2 | 2 | 20.0% |',
      '| High Order | 70% | 7 | 7 | 70.0% |',
      '| TOTAL | 100% | 10 | 10 | 100% |',
    ].join('\n');

    const result = correctCogAnalysisTable(memo, {
      levels: ['Low Order', 'Middle Order', 'High Order'],
      totalMarks: 10,
    });
    assert.equal(result.changed, false, 'no rewrite when figures already agree');
    assert.equal(result.text, memo);
  });

  test('returns input unchanged when no answer table exists', () => {
    const memo = 'Just some prose.\nNo memo table here.';
    const result = correctCogAnalysisTable(memo, {
      levels: ['Low Order'],
      totalMarks: 10,
    });
    assert.equal(result.changed, false);
    assert.equal(result.text, memo);
  });

  test('returns input unchanged when no cog analysis table exists', () => {
    const memo = [
      '| NO. | ANSWER | GUIDANCE | LEVEL | MARK |',
      '| 1.1 | a | b | Low Order | 1 |',
    ].join('\n');
    const result = correctCogAnalysisTable(memo, {
      levels: ['Low Order'],
      totalMarks: 1,
    });
    assert.equal(result.changed, false);
    assert.equal(result.text, memo);
  });

  test('reconciles an Afrikaans memo even when caller passes English level names', () => {
    // The original design accepted a `levels` parameter and silently
    // skipped rows whose label didn't appear there — for an Afrikaans
    // Maths memo with "Kennis / Roetine Prosedures / …" labels, passing
    // English ['Knowledge','Routine Procedures',…] meant Phase 3C did
    // nothing. Now matching uses the memo's own labels, language-agnostic.
    const memo = [
      '| NR. | ANTWOORD | NASIENRIGLYN | KOGNITIEWE VLAK | PUNT |',
      '|---|---|---|---|---|',
      '| 11.1 | x | y | Komplekse Prosedures | 2 |',
      '| 11.4 | x | y | Komplekse Prosedures | 4 |',
      '| 12.1 | x | y | Komplekse Prosedures | 3 |',
      '| 12.2 | x | y | Komplekse Prosedures | 2 |',
      '| 12.3 | x | y | Komplekse Prosedures | 2 |',
      '| 12.4 | x | y | Komplekse Prosedures | 1 |',
      '| 12.5 | x | y | Komplekse Prosedures | 2 |',
      '| 11.2 | x | y | Komplekse Prosedures | 2 |',
      '| 11.3 | x | y | Komplekse Prosedures | 2 |',
      '',
      '| Kognitiewe Vlak | Voorgeskrewe % | Voorgeskrewe Punte | Werklike Punte | Werklike % |',
      '|---|---|---|---|---|',
      '| Komplekse Prosedures | 20% | 20 | 18 | 18.0% |',
    ].join('\n');

    // Caller passes ENGLISH names but the memo is Afrikaans.
    const r = correctCogAnalysisTable(memo, {
      levels: ['Knowledge', 'Routine Procedures', 'Complex Procedures', 'Problem Solving'],
      totalMarks: 100,
    });
    assert.equal(r.changed, true, 'must reconcile despite the English-vs-Afrikaans label mismatch');
    assert.match(r.text, /\| Komplekse Prosedures \| 20% \| 20 \| 20 \| 20\.0% \|/);
  });

  test('zeros out a cog-table row whose level has no answer rows', () => {
    // If the cog table claims "Inferential = 5" but there are no
    // Inferential answer rows, the cell must be reset to 0.
    const memo = [
      '| NO. | ANSWER | GUIDANCE | LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | a | b | Literal | 5 |',
      '',
      '| Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual % |',
      '|---|---|---|---|---|',
      '| Literal | 50% | 5 | 5 | 50.0% |',
      '| Inferential | 50% | 5 | 5 | 50.0% |',
    ].join('\n');
    const r = correctCogAnalysisTable(memo, { totalMarks: 10 });
    assert.equal(r.changed, true);
    // Inferential has no answer rows backing it — must zero out.
    assert.match(r.text, /\| Inferential \| 50% \| 5 \| 0 \| 0\.0% \|/);
    // Literal stays correct.
    assert.match(r.text, /\| Literal \| 50% \| 5 \| 5 \| 50\.0% \|/);
  });

  test('Barrett\'s Level header (RTT pipeline) is also recognised', () => {
    const memo = [
      "| NR. | ANTWOORD | NASIENRIGLYN | KOGNITIEWE VLAK | PUNT |",
      "| 1.1 | a | b | Letterlik | 5 |",
      "| 2.1 | a | b | Inferensieel | 10 |",
      "",
      "| Barrett se Vlak | Voorgeskrewe % | Voorgeskrewe Punte | Werklike Punte | Werklike % |",
      "|---|---|---|---|---|",
      "| Letterlik | 20% | 3 | 1 | 6.7% |",
      "| Herorganisasie | 20% | 3 | 0 | 0% |",
      "| Inferensieel | 40% | 6 | 5 | 33.3% |",
      "| Evaluering en Waardering | 20% | 3 | 0 | 0% |",
      "| TOTAAL | 100% | 15 | 6 | 40.0% |",
    ].join('\n');

    const result = correctCogAnalysisTable(memo, {
      levels: ['Letterlik', 'Herorganisasie', 'Inferensieel', 'Evaluering en Waardering'],
      totalMarks: 15,
    });
    assert.equal(result.changed, true);
    assert.equal(result.computedByLevel['Letterlik'], 5);
    assert.equal(result.computedByLevel['Inferensieel'], 10);
    assert.match(result.text, /\| Letterlik \| 20% \| 3 \| 5 \| 33\.3% \|/);
    assert.match(result.text, /\| Inferensieel \| 40% \| 6 \| 10 \| 66\.7% \|/);
  });
});
