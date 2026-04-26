import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ensureSequentialSectionLetters, ensureSectionCloser } from '../lib/sections.js';

describe('ensureSequentialSectionLetters — Bug 22: section letters skip', () => {
  test('renumbers A → C → D to A → B → C', () => {
    const paper = [
      'SECTION A: Compass directions',
      '1.1 X (1)',
      'SECTION C: Map skills',
      '4.1 Y (2)',
      'SECTION D: Higher order',
      '6.1 Z (3)',
    ].join('\n');
    const r = ensureSequentialSectionLetters(paper);
    assert.equal(r.changed, true);
    assert.match(r.text, /^SECTION A: Compass directions/m);
    assert.match(r.text, /^SECTION B: Map skills/m);
    assert.match(r.text, /^SECTION C: Higher order/m);
    assert.deepEqual(r.replacements, [
      { from: 'C', to: 'B' },
      { from: 'D', to: 'C' },
    ]);
  });

  test('Afrikaans AFDELING is also handled', () => {
    const paper = [
      'AFDELING A: Begrip',
      'AFDELING C: Taal',
    ].join('\n');
    const r = ensureSequentialSectionLetters(paper);
    assert.match(r.text, /^AFDELING A:/m);
    assert.match(r.text, /^AFDELING B:/m);
    assert.equal(r.changed, true);
  });

  test('leaves the paper untouched when letters are already sequential', () => {
    const paper = [
      'SECTION A: a',
      'SECTION B: b',
      'SECTION C: c',
      'SECTION D: d',
    ].join('\n');
    const r = ensureSequentialSectionLetters(paper);
    assert.equal(r.changed, false);
    assert.equal(r.text, paper);
  });

  test('returns input unchanged when there are no SECTION headers', () => {
    const paper = 'Question 1: …\n1.1 A (1)\nQuestion 2: …\n2.1 B (2)';
    const r = ensureSequentialSectionLetters(paper);
    assert.equal(r.changed, false);
    assert.equal(r.text, paper);
  });

  test('null/empty/undefined are safe', () => {
    assert.deepEqual(ensureSequentialSectionLetters(''), { text: '', changed: false, replacements: [] });
    assert.deepEqual(ensureSequentialSectionLetters(null), { text: null, changed: false, replacements: [] });
    assert.deepEqual(ensureSequentialSectionLetters(undefined), { text: undefined, changed: false, replacements: [] });
  });

  test('preserves leading whitespace on indented headers', () => {
    const paper = '   SECTION A: a\n   SECTION C: c';
    const r = ensureSequentialSectionLetters(paper);
    assert.match(r.text, /^   SECTION A:/m);
    assert.match(r.text, /^   SECTION B:/m);
  });

  test('a single SECTION header with letter B becomes A', () => {
    // If the only header is "SECTION B", that's still wrong — sections
    // must start at A.
    const paper = 'SECTION B: only';
    const r = ensureSequentialSectionLetters(paper);
    assert.equal(r.changed, true);
    assert.match(r.text, /^SECTION A:/);
  });
});

describe('ensureSectionCloser — Phase 1.3: deterministic section closers (Bugs 4, 16)', () => {
  test('Bug 4 / 16: strips a foreign-section closer (SECTION C in Section B body)', () => {
    // Resources 1 + 2 audit case: a Section B body that ended with
    // "SECTION C TOTAL: 5 marks" because Claude collapsed the B+C phase.
    // The deterministic closer must strip that and emit "SECTION B TOTAL: 10 marks".
    const body = [
      '| 2.1 | answer | guidance | Literal | 1 |',
      '| 2.2 | answer | guidance | Literal | 1 |',
      '',
      '| Cognitive Level | Questions | Marks |',
      '| Reorganisation | Content Points 1, 2, 3 | 5 |',
      '',
      'SECTION C TOTAL: 5 marks',
    ].join('\n');
    const r = ensureSectionCloser(body, 'SECTION B', 'TOTAL', 10, 'marks');
    assert.equal(r.strippedWrong, true, 'must report a foreign closer was stripped');
    assert.match(r.text, /SECTION B TOTAL: 10 marks\s*$/);
    assert.doesNotMatch(r.text, /SECTION C TOTAL/i);
  });

  test('appends canonical closer when none exists', () => {
    const body = '| 2.1 | answer | guidance | Literal | 5 |';
    const r = ensureSectionCloser(body, 'SECTION B', 'TOTAL', 10, 'marks');
    assert.equal(r.strippedExisting, false);
    assert.equal(r.strippedWrong, false);
    assert.match(r.text, /SECTION B TOTAL: 10 marks\s*$/);
  });

  test('replaces an existing closer for THIS section with the canonical one', () => {
    // If Claude wrote "SECTION B TOTAL: 9 marks" (wrong number), we strip
    // it and emit the canonical "SECTION B TOTAL: 10 marks".
    const body = [
      '| 2.1 | a | b | Literal | 5 |',
      'SECTION B TOTAL: 9 marks',
    ].join('\n');
    const r = ensureSectionCloser(body, 'SECTION B', 'TOTAL', 10, 'marks');
    assert.equal(r.strippedExisting, true);
    assert.match(r.text, /SECTION B TOTAL: 10 marks\s*$/);
    // The wrong "9 marks" line must be gone.
    assert.doesNotMatch(r.text, /SECTION B TOTAL: 9 marks/);
  });

  test('Afrikaans: AFDELING / TOTAAL / punte', () => {
    const body = '| 2.1 | answer | guidance | Letterlik | 5 |';
    const r = ensureSectionCloser(body, 'AFDELING B', 'TOTAAL', 10, 'punte');
    assert.match(r.text, /AFDELING B TOTAAL: 10 punte\s*$/);
  });

  test('handles null/empty input safely', () => {
    const r = ensureSectionCloser('', 'SECTION B', 'TOTAL', 10, 'marks');
    assert.match(r.text, /SECTION B TOTAL: 10 marks\s*$/);
  });
});
