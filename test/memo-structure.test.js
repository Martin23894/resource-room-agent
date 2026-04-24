import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  hasAnswerTable, hasCogAnalysis, validateMemoStructure,
} from '../lib/memo-structure.js';

// A realistic slice of a well-formed English memo.
const COMPLETE_EN = `| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |
| 1.1 | 42 | accept equivalents | Knowledge | 1 |
| 1.2 | Cape Town | exact | Knowledge | 1 |

TOTAL: 25 marks

COGNITIVE LEVEL ANALYSIS (Bloom's Taxonomy)
| Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual % |
| Knowledge | 25% | 6 | 6 | 24% |
`;

const COMPLETE_AF = `| NR. | ANTWOORD | NASIENRIGLYN | KOGNITIEWE VLAK | PUNT |
| 1.1 | 42 | aanvaar gelykwaardiges | Kennis | 1 |

TOTAAL: 25 punte

KOGNITIEWE VLAK ANALISE
| Kognitiewe Vlak | Voorgeskrewe % | Voorgeskrewe Punte | Werklike Punte | Werklike % |
| Kennis | 25% | 6 | 6 | 24% |
`;

// Cog-analysis-only fragment (the exact shape that used to slip past the
// old `length > 500` guard and overwrite the good memo).
const COG_ONLY_FRAGMENT = `TOTAL: 22 marks

COGNITIVE LEVEL ANALYSIS (Bloom's Taxonomy)
| Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual % |
| Knowledge | 25% | 6 | 6 | 27.3% |
| Routine Procedures | 45% | 11 | 11 | 45.5% |
| Complex Procedures | 20% | 5 | 5 | 22.7% |
| Problem Solving | 10% | 3 | 3 | 4.5% |
| Total | 100% | 25 | 22 | 100% |

Knowledge (6 marks): Q1.1 (1) + Q1.2 (1) + Q1.3 (1) + Q2.1 (1) + Q2.2 (1) + Q2.3 (1) = 6 marks
Routine Procedures (10 marks): Q3.1 (1) + Q3.2 (1) = 2 marks listed
Complex Procedures (5 marks): Q6.1 (1) + Q6.2 (1) + Q6.3 (2) + Q6.4 (1) = 5 marks
Problem Solving (1 mark): Q7 (1) = 1 mark
`;

// Answer-table-only fragment (mirror failure mode).
const TABLE_ONLY_FRAGMENT = `| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |
| 1.1 | 42 | accept equivalents | Knowledge | 1 |
| 1.2 | Cape Town | exact | Knowledge | 1 |
TOTAL: 25 marks
`;

describe('hasAnswerTable', () => {
  test('recognises English NO. | ANSWER header', () => {
    assert.equal(hasAnswerTable(COMPLETE_EN), true);
  });

  test('recognises Afrikaans NR. | ANTWOORD header', () => {
    assert.equal(hasAnswerTable(COMPLETE_AF), true);
  });

  test('returns false for the cog-only fragment', () => {
    assert.equal(hasAnswerTable(COG_ONLY_FRAGMENT), false);
  });

  test('returns false for empty / non-string input', () => {
    assert.equal(hasAnswerTable(''), false);
    assert.equal(hasAnswerTable(null), false);
    assert.equal(hasAnswerTable(undefined), false);
    assert.equal(hasAnswerTable(42), false);
  });

  test('tolerates extra whitespace in the pipe row', () => {
    const s = '|  NO.  |   ANSWER  | foo |';
    assert.equal(hasAnswerTable(s), true);
  });
});

describe('hasCogAnalysis', () => {
  test('matches English header', () => {
    assert.equal(hasCogAnalysis(COMPLETE_EN), true);
  });

  test('matches Afrikaans header', () => {
    assert.equal(hasCogAnalysis(COMPLETE_AF), true);
  });

  test('returns false for the answer-table-only fragment', () => {
    assert.equal(hasCogAnalysis(TABLE_ONLY_FRAGMENT), false);
  });

  test('returns false for non-strings', () => {
    assert.equal(hasCogAnalysis(null), false);
  });
});

describe('validateMemoStructure', () => {
  test('complete English memo passes', () => {
    const r = validateMemoStructure(COMPLETE_EN);
    assert.equal(r.complete, true);
    assert.equal(r.answerTable, true);
    assert.equal(r.cogAnalysis, true);
    assert.ok(r.length > 0);
  });

  test('complete Afrikaans memo passes', () => {
    const r = validateMemoStructure(COMPLETE_AF);
    assert.equal(r.complete, true);
  });

  test('cog-only fragment is flagged incomplete with answerTable=false', () => {
    const r = validateMemoStructure(COG_ONLY_FRAGMENT);
    assert.equal(r.complete, false);
    assert.equal(r.answerTable, false);
    assert.equal(r.cogAnalysis, true);
  });

  test('answer-table-only fragment is flagged incomplete with cogAnalysis=false', () => {
    const r = validateMemoStructure(TABLE_ONLY_FRAGMENT);
    assert.equal(r.complete, false);
    assert.equal(r.answerTable, true);
    assert.equal(r.cogAnalysis, false);
  });

  test('empty string is flagged incomplete with length=0', () => {
    const r = validateMemoStructure('');
    assert.equal(r.complete, false);
    assert.equal(r.length, 0);
  });
});
