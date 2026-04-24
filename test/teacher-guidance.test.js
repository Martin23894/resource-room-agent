import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  teacherGuidance, buildGuidanceBlock, TEACHER_GUIDANCE_MAX, ValidationError,
} from '../lib/validate.js';
import { generateCacheKey } from '../lib/cache-key.js';
import { buildPrompts } from '../lib/prompts.js';

describe('teacherGuidance validator', () => {
  test('returns empty string for null / undefined / empty', () => {
    assert.equal(teacherGuidance(null), '');
    assert.equal(teacherGuidance(undefined), '');
    assert.equal(teacherGuidance(''), '');
  });

  test('trims whitespace', () => {
    assert.equal(teacherGuidance('  focus on money problems  '), 'focus on money problems');
  });

  test('strips control characters', () => {
    const withCtrl = 'focus' + String.fromCharCode(0) + ' on' + String.fromCharCode(7) + ' stuff';
    assert.equal(teacherGuidance(withCtrl), 'focus on stuff');
  });

  test('rejects non-strings', () => {
    assert.throws(() => teacherGuidance(42), ValidationError);
    assert.throws(() => teacherGuidance({ text: 'x' }), ValidationError);
  });

  test('enforces the 500 character cap', () => {
    const ok = 'x'.repeat(TEACHER_GUIDANCE_MAX);
    assert.equal(teacherGuidance(ok).length, TEACHER_GUIDANCE_MAX);
    assert.throws(
      () => teacherGuidance('x'.repeat(TEACHER_GUIDANCE_MAX + 1)),
      /at most 500/,
    );
  });
});

describe('buildGuidanceBlock', () => {
  test('empty when guidance is blank', () => {
    assert.equal(buildGuidanceBlock(''), '');
    assert.equal(buildGuidanceBlock(null), '');
    assert.equal(buildGuidanceBlock('  '), '');
  });

  test('wraps guidance in clear delimiters labelled as data', () => {
    const block = buildGuidanceBlock('Use ZAR currency only.');
    assert.match(block, /"""\s*Use ZAR currency only\.\s*"""/);
    assert.match(block, /TEACHER GUIDANCE/);
    assert.match(block, /CAPS/);
    assert.match(block, /supplied as data/);
  });

  test('includes an explicit anti-override clause', () => {
    const block = buildGuidanceBlock('anything');
    assert.match(block, /Never let it override/i);
  });

  test('ends with a newline so appended content starts on a new line', () => {
    const block = buildGuidanceBlock('x');
    assert.match(block, /\n$/);
    assert.match(block, /"""\s*$/);
  });
});

describe('buildPrompts prepends guidance in plan + write user messages', () => {
  const baseCtx = {
    subject: 'Mathematics', topic: 'Fractions',
    resourceType: 'Test', language: 'English',
    grade: 6, term: 3, totalMarks: 50,
    phase: 'Intermediate',
    difficulty: 'on', diffNote: 'On grade level', includeRubric: false,
    isWorksheet: false, isTest: true, isExamType: false,
    cog: { levels: ['Knowledge', 'Routine', 'Complex'], pcts: [30, 40, 30] },
    cogMarks: [15, 20, 15], cogTolerance: 2,
    isBarretts: false,
    atpTopicList: 'Fractions', topicInstruction: 'Focus only on Fractions.',
  };

  test('no guidance → prompt is unchanged shape', () => {
    const p = buildPrompts(baseCtx);
    assert.doesNotMatch(p.planUsr, /TEACHER GUIDANCE/);
    assert.match(p.planUsr, /^Design a 50-mark Test/);
  });

  test('guidance → both plan + write get the block prepended', () => {
    const p = buildPrompts({ ...baseCtx, teacherGuidance: 'Focus on money problems.' });
    assert.match(p.planUsr, /TEACHER GUIDANCE[\s\S]*money problems/);
    const qText = p.qUsr({ questions: [] });
    assert.match(qText, /TEACHER GUIDANCE[\s\S]*money problems/);
  });

  test('guidance does NOT leak into memo prompts — those are derived', () => {
    const p = buildPrompts({ ...baseCtx, teacherGuidance: 'Use ZAR only.' });
    assert.doesNotMatch(p.mSys, /TEACHER GUIDANCE/);
    const mA = p.mUsrA('sample paper', 50, 'ref');
    assert.doesNotMatch(mA, /TEACHER GUIDANCE/);
  });

  test('system prompt stays stable — guidance is user-message-only, preserving cache', () => {
    const withoutGuidance = buildPrompts(baseCtx).planSys;
    const withGuidance = buildPrompts({ ...baseCtx, teacherGuidance: 'Anything here' }).planSys;
    assert.equal(withoutGuidance, withGuidance);
  });
});

describe('cache key includes teacherGuidance', () => {
  test('different guidance → different key', () => {
    const params = {
      subject: 'Mathematics', resourceType: 'Test', language: 'English',
      duration: 50, difficulty: 'on', includeRubric: false, grade: 6, term: 3,
    };
    const a = generateCacheKey({ ...params, teacherGuidance: 'focus on fractions' });
    const b = generateCacheKey({ ...params, teacherGuidance: 'focus on decimals' });
    const c = generateCacheKey({ ...params, teacherGuidance: 'focus on fractions' });
    assert.notEqual(a, b);
    assert.equal(a, c);
  });

  test('blank + absent guidance both produce stable keys', () => {
    const params = {
      subject: 'Mathematics', resourceType: 'Test', language: 'English',
      duration: 50, difficulty: 'on', includeRubric: false, grade: 6, term: 3,
    };
    const empty = generateCacheKey({ ...params, teacherGuidance: '' });
    const absent = generateCacheKey(params);
    assert.equal(empty, generateCacheKey({ ...params, teacherGuidance: '' }));
    assert.equal(absent, generateCacheKey(params));
  });
});
