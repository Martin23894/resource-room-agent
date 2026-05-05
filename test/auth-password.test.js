// Tests for the email + password auth surface:
//   - lib/password.js (hash/verify, validation)
//   - POST /api/auth/signup
//   - POST /api/auth/signin
//   - POST /api/auth/forgot
//   - GET/POST /api/auth/reset
//   - POST /api/auth/resend-verification
//
// These exercise the handler functions directly against a temporary SQLite
// DB. They don't boot the Express app.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openCache, closeCache } from '../lib/cache.js';
import {
  getOrCreateUserByEmail, getUserByEmail, createMagicLink, peekMagicLink,
  loadSessionUser, verifySignedValue, COOKIE_NAME,
} from '../lib/auth.js';
import {
  hashPassword, verifyPassword, validatePassword,
  MIN_PASSWORD_LENGTH,
} from '../lib/password.js';
import signupHandler, { __exposedForTests } from '../api/auth-signup.js';
import signinHandler from '../api/auth-signin.js';
import forgotHandler from '../api/auth-forgot.js';
import resetHandler from '../api/auth-reset.js';
import resendVerificationHandler from '../api/auth-resend-verification.js';

const em = (local) => local + '\x40example.com';

function makeReq({ method = 'POST', body = null, query = {}, user = null } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.body = body;
  req.query = query;
  req.headers = {};
  req.user = user;
  req.log = { info: () => {}, warn: () => {}, error: () => {} };
  return req;
}

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = null;
  res.jsonBody = null;
  res.body = null;
  res.headers = {};
  res.cookies = {};
  res.redirected = null;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.jsonBody = b; return res; };
  res.type = (t) => { res.headers['Content-Type'] = t; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.cookie = (name, value) => { res.cookies[name] = value; return res; };
  res.redirect = (code, location) => {
    res.statusCode = typeof code === 'number' ? code : 302;
    res.redirected = typeof code === 'number' ? location : code;
    return res;
  };
  return res;
}

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rr-pw-'));
  openCache({ path: join(tmpDir, 'pw.db') });
  // Force the email driver to disabled so signup-side createMagicLink calls
  // can't hit the network and tests stay deterministic.
  process.env.EMAIL_PROVIDER = 'disabled';
});

afterEach(() => {
  closeCache();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────
// lib/password.js
// ─────────────────────────────────────────────────────────────────────────

describe('lib/password — hashPassword / verifyPassword', () => {
  test('round-trips a password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
    assert.equal(await verifyPassword('correct horse battery staple', hash), true);
    assert.equal(await verifyPassword('wrong password!!', hash), false);
  });

  test('hashes are unique per call (salted)', async () => {
    const a = await hashPassword('A long enough password');
    const b = await hashPassword('A long enough password');
    assert.notEqual(a, b);
  });

  test('validatePassword rejects too-short passwords', () => {
    assert.throws(() => validatePassword('short'));
  });

  test('validatePassword rejects whitespace-only', () => {
    assert.throws(() => validatePassword(' '.repeat(20)));
  });

  test(`validatePassword accepts ${MIN_PASSWORD_LENGTH}+ chars`, () => {
    validatePassword('x'.repeat(MIN_PASSWORD_LENGTH));
  });

  test('verifyPassword returns false for malformed hashes', async () => {
    assert.equal(await verifyPassword('whatever', 'not-a-hash'), false);
    assert.equal(await verifyPassword('whatever', 'scrypt$1$1'), false);
    assert.equal(await verifyPassword('whatever', null), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /api/auth/signup
// ─────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/signup', () => {
  test('creates a user, sets a password hash, mints a session cookie', async () => {
    const res = makeRes();
    await signupHandler(makeReq({
      body: { email: em('new'), password: 'a-strong-password' },
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.ok, true);
    assert.equal(res.jsonBody.requiresVerification, true);

    const user = getUserByEmail(em('new'));
    assert.ok(user);
    assert.ok(user.password_hash);
    assert.equal(user.email_verified_at, null);

    // Session cookie was set and decodes back to a valid session user.
    const cookie = res.cookies[COOKIE_NAME];
    assert.ok(cookie);
    const sessionId = verifySignedValue(cookie);
    assert.ok(sessionId);
    const sessionUser = loadSessionUser(sessionId);
    assert.equal(sessionUser.email, em('new'));
  });

  test('rejects bad email', async () => {
    const res = makeRes();
    await signupHandler(makeReq({
      body: { email: 'not-an-email', password: 'a-strong-password' },
    }), res);
    assert.equal(res.statusCode, 400);
  });

  test('rejects too-short password', async () => {
    const res = makeRes();
    await signupHandler(makeReq({
      body: { email: em('a'), password: 'short' },
    }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.jsonBody.error, /password/i);
  });

  test('signup with an email that already has a password is a no-op (no overwrite)', async () => {
    // First signup
    await signupHandler(makeReq({
      body: { email: em('dup'), password: 'first-password!' },
    }), makeRes());
    const original = getUserByEmail(em('dup'));
    const originalHash = original.password_hash;

    // Second signup attempt with a different password — must NOT overwrite
    const res = makeRes();
    await signupHandler(makeReq({
      body: { email: em('dup'), password: 'second-password!' },
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.ok, true);
    // No verification flag on the heads-up branch
    assert.equal(res.jsonBody.requiresVerification, undefined);

    const after = getUserByEmail(em('dup'));
    assert.equal(after.password_hash, originalHash, 'existing hash must NOT be overwritten');
  });

  test('signup attaches a password to a magic-link-only existing user', async () => {
    // Pre-create a user via the legacy magic-link flow (no password)
    getOrCreateUserByEmail(em('legacy'));
    const before = getUserByEmail(em('legacy'));
    assert.equal(before.password_hash, null);

    const res = makeRes();
    await signupHandler(makeReq({
      body: { email: em('legacy'), password: 'legacy-upgrade-pass' },
    }), res);
    assert.equal(res.statusCode, 200);

    const after = getUserByEmail(em('legacy'));
    assert.ok(after.password_hash, 'password was attached');
  });

  test('buildWelcomeEmail produces the expected content', () => {
    const { buildWelcomeEmail } = __exposedForTests;
    const { subject, text, html } = buildWelcomeEmail();
    assert.match(subject, /Welcome/i);
    // Key bits a teacher needs in the body
    assert.match(text, /14-day free trial/);
    assert.match(text, /Quick start/);
    assert.match(text, /\/help/);
    assert.match(text, /\/app/);
    // HTML version mirrors the plain-text one
    assert.match(html, /Quick start/);
    assert.match(html, /href="[^"]*\/help"/);
    assert.match(html, /href="[^"]*\/app"/);
  });

  test('signup sends both a verification email AND a welcome email', async () => {
    // Use console driver so sendEmail / createMagicLink push entries through
    // the injected logger we can inspect.
    process.env.EMAIL_PROVIDER = 'console';
    const events = [];
    const captureLog = {
      info: (a, b) => events.push({ kind: 'info', a, b }),
      warn: (a, b) => events.push({ kind: 'warn', a, b }),
      error: (a, b) => events.push({ kind: 'error', a, b }),
    };
    const req = makeReq({
      body: { email: em('welcome'), password: 'a-strong-pass-1' },
    });
    req.log = captureLog;
    const res = makeRes();
    await signupHandler(req, res);
    assert.equal(res.statusCode, 200);

    // The console email driver logs once per email with the subject in the
    // bindings object — we assert we got both subjects.
    const subjects = events
      .filter((e) => e.a && typeof e.a.subject === 'string')
      .map((e) => e.a.subject);
    assert.ok(
      subjects.some((s) => /Confirm your email/i.test(s)),
      'verification email subject should appear in log: ' + JSON.stringify(subjects),
    );
    assert.ok(
      subjects.some((s) => /Welcome to The Resource Room/i.test(s)),
      'welcome email subject should appear in log: ' + JSON.stringify(subjects),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /api/auth/signin
// ─────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/signin', () => {
  beforeEach(async () => {
    await signupHandler(makeReq({
      body: { email: em('login'), password: 'good-strong-pass' },
    }), makeRes());
  });

  test('correct credentials return 200 + cookie', async () => {
    const res = makeRes();
    await signinHandler(makeReq({
      body: { email: em('login'), password: 'good-strong-pass' },
    }), res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.cookies[COOKIE_NAME]);
  });

  test('wrong password returns 401 with a generic error', async () => {
    const res = makeRes();
    await signinHandler(makeReq({
      body: { email: em('login'), password: 'wrong-password!' },
    }), res);
    assert.equal(res.statusCode, 401);
    assert.match(res.jsonBody.error, /Incorrect/i);
  });

  test('unknown email returns the SAME 401 error (no enumeration)', async () => {
    const res = makeRes();
    await signinHandler(makeReq({
      body: { email: em('unknown'), password: 'good-strong-pass' },
    }), res);
    assert.equal(res.statusCode, 401);
    assert.match(res.jsonBody.error, /Incorrect/i);
  });

  test('user with no password set returns 401 (forces forgot-password path)', async () => {
    getOrCreateUserByEmail(em('legacy2'));
    const res = makeRes();
    await signinHandler(makeReq({
      body: { email: em('legacy2'), password: 'whatever' },
    }), res);
    assert.equal(res.statusCode, 401);
  });

  test('reports requiresVerification on first sign-in', async () => {
    const res = makeRes();
    await signinHandler(makeReq({
      body: { email: em('login'), password: 'good-strong-pass' },
    }), res);
    assert.equal(res.jsonBody.requiresVerification, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /api/auth/forgot + /api/auth/reset
// ─────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/forgot', () => {
  test('returns 200 ok regardless of whether the email exists', async () => {
    const res1 = makeRes();
    await forgotHandler(makeReq({ body: { email: em('nobody') } }), res1);
    assert.equal(res1.statusCode, 200);
    assert.equal(res1.jsonBody.ok, true);

    getOrCreateUserByEmail(em('somebody'));
    const res2 = makeRes();
    await forgotHandler(makeReq({ body: { email: em('somebody') } }), res2);
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.jsonBody.ok, true);
  });

  test('rejects malformed email with 400', async () => {
    const res = makeRes();
    await forgotHandler(makeReq({ body: { email: 'no-at-sign' } }), res);
    assert.equal(res.statusCode, 400);
  });
});

describe('POST /api/auth/reset', () => {
  test('valid reset token sets a new password and signs the user in', async () => {
    // Set up a user with an old password
    await signupHandler(makeReq({
      body: { email: em('rst'), password: 'OLD-pass-value' },
    }), makeRes());

    // Mint a reset token
    const { token } = await createMagicLink(em('rst'), { purpose: 'reset' });

    const res = makeRes();
    await resetHandler(makeReq({
      method: 'POST', body: { token, password: 'BRAND-new-pass' },
    }), res);
    assert.equal(res.statusCode, 302);
    assert.equal(res.redirected, '/app');
    assert.ok(res.cookies[COOKIE_NAME], 'session cookie minted');

    // Old password must NOT work
    const oldRes = makeRes();
    await signinHandler(makeReq({
      body: { email: em('rst'), password: 'OLD-pass-value' },
    }), oldRes);
    assert.equal(oldRes.statusCode, 401);

    // New password DOES
    const newRes = makeRes();
    await signinHandler(makeReq({
      body: { email: em('rst'), password: 'BRAND-new-pass' },
    }), newRes);
    assert.equal(newRes.statusCode, 200);
  });

  test('reset also marks the email as verified', async () => {
    await signupHandler(makeReq({
      body: { email: em('rst-v'), password: 'a-strong-password' },
    }), makeRes());
    const before = getUserByEmail(em('rst-v'));
    assert.equal(before.email_verified_at, null);

    const { token } = await createMagicLink(em('rst-v'), { purpose: 'reset' });
    await resetHandler(makeReq({
      method: 'POST', body: { token, password: 'a-different-strong-pass' },
    }), makeRes());

    const after = getUserByEmail(em('rst-v'));
    assert.ok(after.email_verified_at, 'email_verified_at was set by reset');
  });

  test('GET renders form for valid reset token', async () => {
    getOrCreateUserByEmail(em('rst-form'));
    const { token } = await createMagicLink(em('rst-form'), { purpose: 'reset' });
    const res = makeRes();
    await resetHandler(makeReq({ method: 'GET', query: { token } }), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /Set a new password/);
    assert.match(res.body, new RegExp('value="' + token + '"'));
    // Token must remain consumable — peek doesn't consume
    const info = peekMagicLink(token, { expectedPurpose: 'reset' });
    assert.equal(info.email, em('rst-form'));
  });

  test('GET rejects a verify-purpose token (cross-purpose protection)', async () => {
    getOrCreateUserByEmail(em('cross'));
    const { token } = await createMagicLink(em('cross'), { purpose: 'verify' });
    const res = makeRes();
    await resetHandler(makeReq({ method: 'GET', query: { token } }), res);
    assert.equal(res.statusCode, 400);
  });

  test('weak password is rejected and the form is re-rendered', async () => {
    getOrCreateUserByEmail(em('weak'));
    const { token } = await createMagicLink(em('weak'), { purpose: 'reset' });
    const res = makeRes();
    await resetHandler(makeReq({
      method: 'POST', body: { token, password: 'short' },
    }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Set a new password|password/i);
    // Token must NOT have been consumed by a failed attempt
    peekMagicLink(token, { expectedPurpose: 'reset' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /api/auth/resend-verification
// ─────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/resend-verification', () => {
  test('401 when not signed in', async () => {
    const res = makeRes();
    await resendVerificationHandler(makeReq({ user: null }), res);
    assert.equal(res.statusCode, 401);
  });

  test('returns alreadyVerified=true when email_verified_at is set', async () => {
    const user = getOrCreateUserByEmail(em('verified'));
    user.email_verified_at = Date.now();
    const res = makeRes();
    await resendVerificationHandler(makeReq({ user }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.alreadyVerified, true);
  });

  test('sends a verify-purpose link when unverified', async () => {
    const user = getOrCreateUserByEmail(em('unv'));
    const res = makeRes();
    await resendVerificationHandler(makeReq({ user }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.ok, true);
  });
});
