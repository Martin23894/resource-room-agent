import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseTableRow, isTableRow } from '../lib/docx-builder.js';

describe('parseTableRow', () => {
  test('strips the outer pipes and returns trimmed cells', () => {
    assert.deepEqual(
      parseTableRow('| Measured Angle | Type of Angle |'),
      ['Measured Angle', 'Type of Angle'],
    );
  });

  test('preserves empty middle cells (answer space)', () => {
    // Regression: "| 15° | |" used to drop the empty cell, breaking both
    // the table-row detector and the render.
    assert.deepEqual(parseTableRow('| 15° | |'), ['15°', '']);
    assert.deepEqual(parseTableRow('| 112° | |'), ['112°', '']);
  });

  test('handles three+ columns with a mix of filled and empty cells', () => {
    assert.deepEqual(
      parseTableRow('| Term | Meaning | Example |'),
      ['Term', 'Meaning', 'Example'],
    );
    assert.deepEqual(
      parseTableRow('| photosynthesis | | |'),
      ['photosynthesis', '', ''],
    );
  });

  test('strips markdown bold wrappers inside cells', () => {
    assert.deepEqual(
      parseTableRow('| **TOTAL** | **100%** | **40** |'),
      ['TOTAL', '100%', '40'],
    );
  });

  test('handles rows without leading or trailing pipes', () => {
    // Markdown style tables sometimes omit the outer pipes.
    assert.deepEqual(parseTableRow('Term|Meaning'), ['Term', 'Meaning']);
  });
});

describe('isTableRow', () => {
  test('recognises a normal two-column row', () => {
    assert.equal(isTableRow('| Column A | Column B |'), true);
  });

  test('recognises an answer row with an empty second cell', () => {
    // The bug we're fixing: "| 15° | |" must qualify as a table row
    // even though only one cell is non-empty.
    assert.equal(isTableRow('| 15° | |'), true);
    assert.equal(isTableRow('| Answer goes here | |'), true);
  });

  test('rejects lines without pipes', () => {
    assert.equal(isTableRow('just a paragraph'), false);
    assert.equal(isTableRow(''), false);
  });

  test('rejects a single-column line like "|solo|"', () => {
    assert.equal(isTableRow('|solo|'), false);
  });

  test('handles markdown-separator rows', () => {
    // The separator row itself has 2+ cells in the parse — it's recognised
    // as a table row but parseText skips it explicitly before iterating.
    assert.equal(isTableRow('|---|---|'), true);
  });
});
