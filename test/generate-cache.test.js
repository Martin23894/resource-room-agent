// Tests for the result-cache short-circuit on /api/generate.
//
// Verifies:
//   1. buildCacheKey is stable across object-key order and unique across
//      meaningful parameter changes.
//   2. The handler returns a cached payload without calling Anthropic when
//      a hit exists. We assert this by NOT setting ANTHROPIC_API_KEY in the
//      test env — if generate() ran, it would throw.
//   3. The {fresh:true} bypass forces a regen (same negative-API-key trick
//      surfaces it: handler tries generate(), throws, sendError fires).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import handler, { __internals } from '../api/generate.js';
import { openCache, cacheSet, cacheClear, closeCache } from '../lib/cache.js';

const { buildCacheKey } = __internals;
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

let tmpDir;
let originalApiKey;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rr-gen-cache-'));
  openCache({ path: join(tmpDir, 'cache.db'), logger: silentLogger });
  cacheClear();
  // Strip the API key so any accidental fall-through to generate() throws
  // immediately and our negative assertion is meaningful.
  originalApiKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  closeCache();
  rmSync(tmpDir, { recursive: true, force: true });
  if (originalApiKey !== undefined) process.env.ANTHROPIC_API_KEY = originalApiKey;
});

// Minimal req/res mocks. The handler only touches:
//   req: method, body, headers, log, on
//   res: status, json, headersSent
function mockReq(body) {
  const req = {
    method: 'POST',
    body,
    headers: { accept: 'application/json' },
    log: silentLogger,
    on: () => {},
  };
  return req;
}

function mockRes() {
  const res = {
    statusCode: 200,
    headersSent: false,
    payload: null,
    setTimeout: () => {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; this.headersSent = true; return this; },
    writableEnded: false,
  };
  return res;
}

describe('buildCacheKey', () => {
  test('is stable across object-key order', () => {
    const a = { subject: 'Maths', grade: 5, term: 2, language: 'English', resourceType: 'Test', totalMarks: 40, difficulty: 'on' };
    const b = { difficulty: 'on', totalMarks: 40, resourceType: 'Test', language: 'English', term: 2, grade: 5, subject: 'Maths' };
    assert.equal(buildCacheKey(a), buildCacheKey(b));
  });

  test('differs on each parameter', () => {
    const base = { subject: 'Maths', grade: 5, term: 2, language: 'English', resourceType: 'Test', totalMarks: 40, difficulty: 'on' };
    const k = buildCacheKey(base);
    assert.notEqual(k, buildCacheKey({ ...base, subject: 'NST' }));
    assert.notEqual(k, buildCacheKey({ ...base, grade: 6 }));
    assert.notEqual(k, buildCacheKey({ ...base, term: 3 }));
    assert.notEqual(k, buildCacheKey({ ...base, language: 'Afrikaans' }));
    assert.notEqual(k, buildCacheKey({ ...base, resourceType: 'Exam' }));
    assert.notEqual(k, buildCacheKey({ ...base, totalMarks: 50 }));
    assert.notEqual(k, buildCacheKey({ ...base, difficulty: 'above' }));
  });

  test('starts with stable v2 prefix for invalidation', () => {
    const k = buildCacheKey({ subject: 'Maths', grade: 5, term: 2, language: 'English', resourceType: 'Test', totalMarks: 40, difficulty: 'on' });
    assert.match(k, /^gen:v2:/);
  });
});

describe('handler cache short-circuit', () => {
  const req = {
    subject: 'Mathematics', grade: 5, term: 2,
    language: 'English', resourceType: 'Test', duration: 40, difficulty: 'on',
  };
  const cachedPayload = {
    docxBase64: 'AAAA',
    preview: 'cached preview',
    filename: 'Mathematics-Test-Grade5-Term2.docx',
    verificationStatus: 'invariants_passed',
    _meta: { pipeline: 'v2', rebalanceNudges: 0, framework: "Bloom's" },
  };

  test('returns cached payload on hit without calling generate', async () => {
    const parsed = {
      subject: 'Mathematics', grade: 5, term: 2,
      language: 'English', resourceType: 'Test', totalMarks: 40, difficulty: 'on',
    };
    cacheSet(buildCacheKey(parsed), cachedPayload);

    const r = mockRes();
    await handler(mockReq(req), r);
    assert.equal(r.statusCode, 200);
    assert.ok(r.payload, 'response should have payload');
    assert.equal(r.payload.docxBase64, cachedPayload.docxBase64);
    assert.equal(r.payload.preview, cachedPayload.preview);
    assert.equal(r.payload.filename, cachedPayload.filename);
    assert.equal(r.payload._meta.cached, true, 'cached:true marker should be set');
  });

  test('cache miss surfaces an Anthropic error (proving generate was attempted)', async () => {
    const r = mockRes();
    // No cache pre-populated; ANTHROPIC_API_KEY stripped → generate throws.
    await handler(mockReq(req), r);
    // Either a 4xx/5xx — the point is generate() was invoked.
    assert.ok(r.statusCode >= 400, `expected error status, got ${r.statusCode}`);
    assert.ok(r.payload?.error, 'error response should have a message');
  });

  test('{fresh:true} bypasses cache even when populated', async () => {
    const parsed = {
      subject: 'Mathematics', grade: 5, term: 2,
      language: 'English', resourceType: 'Test', totalMarks: 40, difficulty: 'on',
    };
    cacheSet(buildCacheKey(parsed), cachedPayload);

    const r = mockRes();
    await handler(mockReq({ ...req, fresh: true }), r);
    // generate() runs, hits the missing-API-key path, surfaces an error.
    assert.ok(r.statusCode >= 400, `expected fresh:true to bypass cache and error, got ${r.statusCode}`);
  });
});
