import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  openCache, cacheGet, cacheSet, cacheDelete, cacheClear, cacheSize, closeCache,
} from '../lib/cache.js';

let tmpDir;
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rr-cache-'));
  openCache({ path: join(tmpDir, 'cache.db'), logger: silentLogger });
});

afterEach(() => {
  closeCache();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('cache get/set', () => {
  test('round-trips a plain object', () => {
    cacheSet('k1', { hello: 'world', n: 42 });
    assert.deepEqual(cacheGet('k1'), { hello: 'world', n: 42 });
  });

  test('returns null on miss', () => {
    assert.equal(cacheGet('does-not-exist'), null);
  });

  test('overwrites an existing key', () => {
    cacheSet('k', 'first');
    cacheSet('k', 'second');
    assert.equal(cacheGet('k'), 'second');
    assert.equal(cacheSize(), 1);
  });

  test('cacheDelete removes a key', () => {
    cacheSet('k', 'value');
    assert.equal(cacheDelete('k'), true);
    assert.equal(cacheGet('k'), null);
    assert.equal(cacheDelete('k'), false);
  });

  test('cacheClear wipes every entry', () => {
    cacheSet('a', 1);
    cacheSet('b', 2);
    cacheSet('c', 3);
    assert.equal(cacheSize(), 3);
    cacheClear();
    assert.equal(cacheSize(), 0);
  });

  test('stores large base64 payload intact', () => {
    // Simulate a real DOCX base64 — ~30KB.
    const big = 'A'.repeat(30000);
    cacheSet('k', { docxBase64: big });
    const out = cacheGet('k');
    assert.equal(out.docxBase64.length, 30000);
  });
});

describe('cache TTL', () => {
  test('expired entries are removed on read', async () => {
    cacheSet('k', 'value', 1); // 1 second TTL
    assert.equal(cacheGet('k'), 'value');
    // Fast-forward by stashing a past expires_at via a 0-second TTL after the write.
    // Simpler: set with a negative TTL and assert miss.
    cacheSet('k', 'value', -1);
    assert.equal(cacheGet('k'), null);
    assert.equal(cacheSize(), 0);
  });

  test('ttlSeconds=0 means no expiry', () => {
    cacheSet('k', 'value', 0);
    // Sleep isn't needed; expires_at is null so it never expires.
    assert.equal(cacheGet('k'), 'value');
  });

  test('startup pruning removes already-expired entries', () => {
    cacheSet('k', 'value', -10);
    // Re-open — openCache prunes expired rows.
    closeCache();
    openCache({ path: join(tmpDir, 'cache.db'), logger: silentLogger });
    assert.equal(cacheSize(), 0);
  });
});
