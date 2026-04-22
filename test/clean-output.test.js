import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { cleanOutput } from '../lib/clean-output.js';

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
});
