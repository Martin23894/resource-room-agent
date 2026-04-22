import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { generateCacheKey, canonicalizeForTest } from '../lib/cache-key.js';

describe('generateCacheKey', () => {
  test('same params produce same key regardless of field order', () => {
    const a = generateCacheKey({
      subject: 'Mathematics', topic: 'Fractions', resourceType: 'Test',
      language: 'English', duration: 50, difficulty: 'on',
      includeRubric: false, grade: 6, term: 3,
    });
    const b = generateCacheKey({
      term: 3, grade: 6, includeRubric: false, difficulty: 'on',
      duration: 50, language: 'English', resourceType: 'Test',
      topic: 'Fractions', subject: 'Mathematics',
    });
    assert.equal(a, b);
  });

  test('different topic produces different key', () => {
    const base = {
      subject: 'Mathematics', resourceType: 'Test', language: 'English',
      duration: 50, difficulty: 'on', includeRubric: false, grade: 6, term: 3,
    };
    const a = generateCacheKey({ ...base, topic: 'Fractions' });
    const b = generateCacheKey({ ...base, topic: 'Decimals' });
    assert.notEqual(a, b);
  });

  test('different language produces different key (EN vs AF)', () => {
    const base = {
      subject: 'Mathematics', topic: 'Fractions', resourceType: 'Test',
      duration: 50, difficulty: 'on', includeRubric: false, grade: 6, term: 3,
    };
    const a = generateCacheKey({ ...base, language: 'English' });
    const b = generateCacheKey({ ...base, language: 'Afrikaans' });
    assert.notEqual(a, b);
  });

  test('different mark total produces different key', () => {
    const base = {
      subject: 'Mathematics', topic: 'Fractions', resourceType: 'Test',
      language: 'English', difficulty: 'on', includeRubric: false, grade: 6, term: 3,
    };
    const a = generateCacheKey({ ...base, duration: 40 });
    const b = generateCacheKey({ ...base, duration: 50 });
    assert.notEqual(a, b);
  });

  test('ignores unknown fields (clientId, timestamp, etc.)', () => {
    const base = {
      subject: 'Mathematics', topic: 'Fractions', resourceType: 'Test',
      language: 'English', duration: 50, difficulty: 'on',
      includeRubric: false, grade: 6, term: 3,
    };
    const a = generateCacheKey(base);
    const b = generateCacheKey({ ...base, clientId: 'abc', timestamp: 99999, _nonce: 'random' });
    assert.equal(a, b);
  });

  test('key is namespaced with gen: prefix and is SHA-256 hex', () => {
    const key = generateCacheKey({
      subject: 'Mathematics', topic: 'x', resourceType: 'Test',
      language: 'English', duration: 50, difficulty: 'on',
      includeRubric: false, grade: 6, term: 3,
    });
    assert.match(key, /^gen:[0-9a-f]{64}$/);
  });

  test('canonical form has keys sorted alphabetically', () => {
    const canonical = canonicalizeForTest({
      subject: 'Mathematics', topic: 't', resourceType: 'Test',
      language: 'English', duration: 50, difficulty: 'on',
      includeRubric: false, grade: 6, term: 3,
    });
    // The first key after the opening brace must be "difficulty" (alphabetically first).
    assert.ok(canonical.startsWith('{"difficulty":'));
  });

  test('undefined and null fields are dropped, not included as "null"', () => {
    const withTopic = generateCacheKey({
      subject: 'Mathematics', topic: 'Fractions', resourceType: 'Test',
      language: 'English', duration: 50, difficulty: 'on',
      includeRubric: false, grade: 6, term: 3,
    });
    const topicMissing = generateCacheKey({
      subject: 'Mathematics', topic: undefined, resourceType: 'Test',
      language: 'English', duration: 50, difficulty: 'on',
      includeRubric: false, grade: 6, term: 3,
    });
    // Different keys — topic absent vs topic present.
    assert.notEqual(withTopic, topicMissing);
  });
});
