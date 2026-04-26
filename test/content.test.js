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

describe('extractContent — Bug 21: phase commentary + JSON wrapper leakage', () => {
  test('strips leading "Q7.x: ..." phase commentary lines before JSON', () => {
    const raw =
      'Q7.2: The error report confirms the answer is already correct (R29 000) and says "No change — calculation is correct." So Q7.2 requires no change.\n' +
      '\n' +
      'Q7.4: The working needs to explicitly state that Option B requires a positive monthly profit.\n' +
      '\n' +
      '{"content":"| NO. | ANSWER | MARKING | LEVEL | MARK |\\n| 1.1 | b | x | y | 1 |"}';

    const out = extractContent(raw);
    assert.doesNotMatch(out, /Q7\.2:/, 'leading commentary must be stripped');
    assert.doesNotMatch(out, /Q7\.4:/, 'leading commentary must be stripped');
    assert.match(out, /\| NO\. \| ANSWER/);
    assert.match(out, /\| 1\.1 \| b \| x \| y \| 1 \|/);
  });

  test('extracts content from a ```json fence anywhere in the response', () => {
    const raw =
      'Some preamble text.\n' +
      '\n' +
      '```json\n' +
      '{"content":"MEMORANDUM\\n| 1.1 | answer |"}\n' +
      '```\n' +
      'Some trailing text.';
    const out = extractContent(raw);
    assert.match(out, /MEMORANDUM/);
    assert.match(out, /\| 1\.1 \| answer \|/);
    assert.doesNotMatch(out, /preamble/);
    assert.doesNotMatch(out, /trailing/);
  });

  test('recovers content even when the JSON is truncated mid-string', () => {
    // The JSON object is unterminated (no closing "}). This is the exact
    // failure mode that produced the Paper 11 leak — extractContent must
    // not return the whole malformed envelope verbatim.
    const raw =
      'Q7.4: Some preamble note.\n' +
      '\n' +
      '```json\n' +
      '{"content":"| NO. | ANSWER |\\n|---|---|\\n| 1.1 | b. Barter system | Low Order | 1 |\\n';
    const out = extractContent(raw);
    assert.doesNotMatch(out, /Q7\.4:/, 'preamble note must not survive');
    assert.doesNotMatch(out, /```json/, 'fence wrapper must not survive');
    assert.doesNotMatch(out, /^\{"content"/, 'raw JSON envelope must not survive');
    assert.match(out, /\| 1\.1 \| b\. Barter system/, 'recovered table content present');
  });

  test('strips a stray trailing JSON close-brace pair when content is otherwise plain', () => {
    const raw =
      'MEMORANDUM\n' +
      '| 1.1 | answer | guidance | level | 1 |\n' +
      '"}';
    const out = extractContent(raw);
    assert.match(out, /^MEMORANDUM/);
    assert.doesNotMatch(out, /^"\}$/m, 'the lone "} closer must be removed');
  });
});
