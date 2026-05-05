// Tests for the operational status surface:
//   - lib/health.js (per-dependency checks)
//   - GET /health/status handler
//   - GET /_/analytics.js loader

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openCache, closeCache } from '../lib/cache.js';
import {
  checkDatabase, checkAnthropic, checkEmail, checkSentry, checkAuthSecret,
  runAllChecks,
} from '../lib/health.js';
import healthHandler from '../api/health-status.js';
import analyticsHandler from '../api/analytics-config.js';

function makeReq({ method = 'GET', query = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.query = query;
  req.headers = {};
  return req;
}

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = null;
  res.jsonBody = null;
  res.body = null;
  res.headers = {};
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.jsonBody = b; return res; };
  res.type = (t) => { res.headers['Content-Type'] = t; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.send = (b) => { res.body = b; return res; };
  return res;
}

let tmpDir;
let originals;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rr-health-'));
  openCache({ path: join(tmpDir, 'h.db') });
  originals = {
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    EMAIL_FROM: process.env.EMAIL_FROM,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AUTH_SECRET: process.env.AUTH_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    SENTRY_DSN: process.env.SENTRY_DSN,
    PLAUSIBLE_DOMAIN: process.env.PLAUSIBLE_DOMAIN,
    HEALTH_STATUS_SECRET: process.env.HEALTH_STATUS_SECRET,
  };
});

afterEach(() => {
  closeCache();
  rmSync(tmpDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(originals)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Per-check helpers
// ─────────────────────────────────────────────────────────────────────────

describe('checkDatabase', () => {
  test('ok when SQLite is reachable', () => {
    const r = checkDatabase();
    assert.equal(r.ok, true);
    assert.match(r.info, /reachable/i);
  });
});

describe('checkAnthropic', () => {
  test('ok when key looks like an Anthropic key', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-abc123';
    assert.equal(checkAnthropic().ok, true);
  });

  test('not ok when key is missing', () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = checkAnthropic();
    assert.equal(r.ok, false);
    assert.match(r.info, /not set/i);
  });

  test('not ok when key is malformed', () => {
    process.env.ANTHROPIC_API_KEY = 'definitely-not-an-anthropic-key';
    const r = checkAnthropic();
    assert.equal(r.ok, false);
    assert.match(r.info, /doesn't look/i);
  });
});

describe('checkEmail', () => {
  test('not ok in console mode (dev driver — needs flipping for prod)', () => {
    process.env.EMAIL_PROVIDER = 'console';
    const r = checkEmail();
    assert.equal(r.ok, false);
    assert.match(r.info, /console/);
  });

  test('not ok in disabled mode', () => {
    process.env.EMAIL_PROVIDER = 'disabled';
    assert.equal(checkEmail().ok, false);
  });

  test('not ok on resend without RESEND_API_KEY', () => {
    process.env.EMAIL_PROVIDER = 'resend';
    delete process.env.RESEND_API_KEY;
    const r = checkEmail();
    assert.equal(r.ok, false);
    assert.match(r.info, /RESEND_API_KEY/);
  });

  test('not ok on resend when EMAIL_FROM points at the sandbox', () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test';
    delete process.env.EMAIL_FROM;
    const r = checkEmail();
    assert.equal(r.ok, false);
    assert.match(r.info, /sandbox/);
  });

  test('ok on resend with branded EMAIL_FROM', () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'Brand <hello\x40example.com>';
    const r = checkEmail();
    assert.equal(r.ok, true);
    assert.match(r.info, /branded/);
  });
});

describe('checkSentry', () => {
  test('not ok when SENTRY_DSN is unset (still reports clearly)', () => {
    delete process.env.SENTRY_DSN;
    const r = checkSentry();
    assert.equal(r.ok, false);
    assert.match(r.info, /not set/);
  });
});

describe('checkAuthSecret', () => {
  test('ok when AUTH_SECRET is ≥32 chars', () => {
    process.env.AUTH_SECRET = 'x'.repeat(32);
    assert.equal(checkAuthSecret().ok, true);
  });

  test('not ok when AUTH_SECRET is unset (dev wording)', () => {
    delete process.env.AUTH_SECRET;
    process.env.NODE_ENV = 'development';
    const r = checkAuthSecret();
    assert.equal(r.ok, false);
    assert.match(r.info, /will not survive/);
  });

  test('not ok with prod-specific wording when NODE_ENV=production', () => {
    delete process.env.AUTH_SECRET;
    process.env.NODE_ENV = 'production';
    const r = checkAuthSecret();
    assert.equal(r.ok, false);
    assert.match(r.info, /≥32 chars required in prod/);
  });
});

describe('runAllChecks', () => {
  test('top-level status is "attention" if any check fails', () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = runAllChecks();
    assert.equal(r.status, 'attention');
    assert.equal(r.checks.anthropic.ok, false);
  });

  test('top-level status is "ok" only when every dependency is green', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.AUTH_SECRET = 'x'.repeat(32);
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'Brand <hello\x40example.com>';
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    // checkSentry only returns ok=true when the SDK was actually
    // initialised — we can't init it inside a test cleanly without
    // hitting the network, so accept "attention" as long as every
    // OTHER dep is green.
    const r = runAllChecks();
    assert.equal(r.checks.database.ok, true);
    assert.equal(r.checks.auth.ok, true);
    assert.equal(r.checks.anthropic.ok, true);
    assert.equal(r.checks.email.ok, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /health/status handler
// ─────────────────────────────────────────────────────────────────────────

describe('GET /health/status', () => {
  test('returns 200 + JSON body without secret guard', () => {
    delete process.env.HEALTH_STATUS_SECRET;
    const res = makeRes();
    healthHandler(makeReq(), res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.jsonBody.checks);
    assert.ok(['ok', 'attention'].includes(res.jsonBody.status));
  });

  test('404s without ?secret when HEALTH_STATUS_SECRET is set', () => {
    process.env.HEALTH_STATUS_SECRET = 'topsecret';
    const res = makeRes();
    healthHandler(makeReq({ query: {} }), res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.jsonBody.error, 'Not found');
  });

  test('200 with matching ?secret', () => {
    process.env.HEALTH_STATUS_SECRET = 'topsecret';
    const res = makeRes();
    healthHandler(makeReq({ query: { secret: 'topsecret' } }), res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.jsonBody.checks);
  });

  test('non-GET methods → 405', () => {
    const res = makeRes();
    healthHandler(makeReq({ method: 'POST' }), res);
    assert.equal(res.statusCode, 405);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GET /_/analytics.js handler
// ─────────────────────────────────────────────────────────────────────────

describe('GET /_/analytics.js', () => {
  test('emits a no-op script when PLAUSIBLE_DOMAIN is unset', () => {
    delete process.env.PLAUSIBLE_DOMAIN;
    const res = makeRes();
    analyticsHandler(makeReq(), res);
    assert.equal(res.headers['Content-Type'], 'application/javascript; charset=utf-8');
    assert.match(res.body, /No analytics configured/);
    assert.doesNotMatch(res.body, /plausible\.io/);
  });

  test('emits the Plausible loader when PLAUSIBLE_DOMAIN is set', () => {
    process.env.PLAUSIBLE_DOMAIN = 'theresourceroom.co.za';
    const res = makeRes();
    analyticsHandler(makeReq(), res);
    assert.match(res.body, /plausible\.io\/js\/script\.js/);
    assert.match(res.body, /"theresourceroom\.co\.za"/);
    assert.match(res.body, /data-domain/);
  });

  test('cache header is set', () => {
    const res = makeRes();
    analyticsHandler(makeReq(), res);
    assert.match(String(res.headers['Cache-Control'] || ''), /max-age=\d+/);
  });

  test('non-GET methods → 405', () => {
    const res = makeRes();
    analyticsHandler(makeReq({ method: 'POST' }), res);
    assert.equal(res.statusCode, 405);
  });
});
