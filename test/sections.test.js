import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ensureSequentialSectionLetters } from '../lib/sections.js';

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
