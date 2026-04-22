import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { extractContent } from '../lib/content.js';

describe('extractContent — happy path', () => {
  test('parses a plain JSON response', () => {
    const raw = '{"content":"Question 1: What is 2+2?","changesSummary":"n/a"}';
    assert.equal(extractContent(raw), 'Question 1: What is 2+2?');
  });

  test('strips ```json markdown fences', () => {
    const raw = '```json\n{"content":"abc"}\n```';
    assert.equal(extractContent(raw), 'abc');
  });

  test('preserves newlines inside content', () => {
    const raw = '{"content":"line1\\nline2\\nline3"}';
    assert.equal(extractContent(raw), 'line1\nline2\nline3');
  });

  test('handles escaped quotes inside content', () => {
    const raw = '{"content":"She said \\"hello\\"."}';
    assert.equal(extractContent(raw), 'She said "hello".');
  });
});

describe('extractContent — reasoning leak (the real bug)', () => {
  test('strips leading reasoning before JSON', () => {
    const raw =
      'Current marks: Q1=4, Q2=4, Q3=2 = 10 total\n' +
      '- Change Q5.1 from (2) to (4) — makes more sense = +2\n' +
      'Total: 4+4+2+3+6+4 = 20 ✓\n' +
      '{"content":"Vraag 1: Skeiding van mengsels\\nQ1.1 Noem..."}';

    const out = extractContent(raw);
    assert.match(out, /^Vraag 1:/);
    assert.doesNotMatch(out, /Current marks/);
    assert.doesNotMatch(out, /Change Q/);
    assert.doesNotMatch(out, /Total: 4\+4/);
    assert.doesNotMatch(out, /✓/);
  });

  test('handles reasoning before AND after the JSON object', () => {
    const raw =
      'Let me work this out.\n' +
      '{"content":"Question 1: abc"}\n' +
      'That gives us 20 marks total. ✓';
    const out = extractContent(raw);
    assert.equal(out, 'Question 1: abc');
  });

  test('handles multiple { chars inside the content (e.g. set notation)', () => {
    const raw = '{"content":"The set {1, 2, 3} has three elements."}';
    assert.equal(extractContent(raw), 'The set {1, 2, 3} has three elements.');
  });
});

describe('extractContent — no JSON wrapper', () => {
  test('returns text unchanged when there is no JSON', () => {
    const raw = 'Question 1: What is 2+2? (1)\na. 3\nb. 4\nc. 5\nd. 6';
    assert.equal(extractContent(raw), raw);
  });

  test('strips commentary before the first real content marker', () => {
    const raw =
      "Here is the paper I've created based on your request:\n" +
      '\n' +
      'Question 1: Photosynthesis\n' +
      '1.1 What gas do plants absorb? (1)';
    const out = extractContent(raw);
    assert.match(out, /^Question 1:/);
    assert.doesNotMatch(out, /Here is/);
  });

  test('recognises SECTION A as a content marker', () => {
    const raw = 'Let me begin.\n\nSECTION A: Comprehension\n1.1 …';
    const out = extractContent(raw);
    assert.match(out, /^SECTION A/);
  });

  test('recognises Afrikaans AFDELING and Vraag as content markers', () => {
    const raw = 'Ek sal nou begin.\n\nVraag 1: Fotosintese\n1.1 Wat is …';
    const out = extractContent(raw);
    assert.match(out, /^Vraag 1:/);
  });

  test('recognises MEMORANDUM as a content marker', () => {
    const raw = "OK, here's the memo:\n\nMEMORANDUM\n| No. | Answer |\n|---|---|";
    const out = extractContent(raw);
    assert.match(out, /^MEMORANDUM/);
  });
});

describe('extractContent — edge cases', () => {
  test('null/undefined input returns empty string', () => {
    assert.equal(extractContent(null), '');
    assert.equal(extractContent(undefined), '');
  });

  test('coerces non-string input to string', () => {
    assert.equal(extractContent(42), '42');
  });

  test('empty string returns empty string', () => {
    assert.equal(extractContent(''), '');
  });

  test('malformed JSON with reasonable fallback', () => {
    const raw = '{"content":"incomplete';
    // Should NOT throw. Returns something non-empty.
    const out = extractContent(raw);
    assert.equal(typeof out, 'string');
  });
});
