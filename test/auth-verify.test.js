import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openCache, closeCache } from '../lib/cache.js';
import { createMagicLink, peekMagicLink, consumeMagicLink } from '../lib/auth.js';
import authVerifyHandler from '../api/auth-verify.js';

const em = (local) => local + '\x40example.com';

function makeReq({ method = 'GET', query = {}, body = null, user = null } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.query = query;
  req.body = body;
  req.headers = {};
  req.user = user;
  req.log = { info: () => {}, warn: () => {}, error: () => {} };
  return req;
}

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = null;
  res.body = null;
  res.headers = {};
  res.cookies = {};
  res.redirected = null;
  res.status = (c) => { res.statusCode = c; return res; };
  res.type = (t) => { res.headers['Content-Type'] = t; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.cookie = (name, val, _opts) => { res.cookies[name] = val; return res; };
  res.redirect = (code, location) => {
    res.statusCode = typeof code === 'number' ? code : 302;
    res.redirected = typeof code === 'number' ? location : code;
    return res;
  };
  return res;
}

let tmpDir;
let prevSecret;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rr-verify-'));
  openCache({ path: join(tmpDir, 'verify.db') });
  prevSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'a'.repeat(64);
  process.env.EMAIL_PROVIDER = 'disabled';
});

afterEach(() => {
  closeCache();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = prevSecret;
});

describe('peekMagicLink (non-consuming)', () => {
  test('returns the row for a valid unused token', async () => {
    const { token } = await createMagicLink(em('teacher'));
    const info = peekMagicLink(token);
    assert.equal(info.email, em('teacher'));
    assert.equal(info.token, token);
  });

  test('can be called multiple times without consuming', async () => {
    const { token } = await createMagicLink(em('teacher'));
    peekMagicLink(token);
    peekMagicLink(token);
    peekMagicLink(token);
    // Token is still consumable afterwards — proves peek doesn't mark used_at
    const user = consumeMagicLink(token);
    assert.equal(user.email, em('teacher'));
  });

  test('rejects unknown token', () => {
    assert.throws(() => peekMagicLink('deadbeef' + 'a'.repeat(56)), /Unknown/);
  });

  test('rejects an already-consumed token', async () => {
    const { token } = await createMagicLink(em('teacher'));
    consumeMagicLink(token);
    assert.throws(() => peekMagicLink(token), /already been used/);
  });
});

describe('GET /api/auth/verify — renders confirm page, does NOT consume', () => {
  test('valid token → 200 HTML with sign-in form + the user email', async () => {
    const { token } = await createMagicLink(em('teacher'));
    const res = makeRes();
    await authVerifyHandler(makeReq({ method: 'GET', query: { token } }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'html');
    assert.match(res.body, /method="POST" action="\/api\/auth\/verify"/);
    assert.match(res.body, new RegExp('value="' + token + '"'));
    assert.match(res.body, new RegExp('example\\.com'));
    assert.match(res.body, /Sign in/);

    // Token is STILL consumable after a GET — this is the whole point
    const user = consumeMagicLink(token);
    assert.equal(user.email, em('teacher'));
  });

  test('scanner pre-fetching does not burn the token (simulated 3 GETs)', async () => {
    const { token } = await createMagicLink(em('teacher'));
    // Gmail Safe Links, Outlook Defender, Chrome prefetch — all GET it
    await authVerifyHandler(makeReq({ method: 'GET', query: { token } }), makeRes());
    await authVerifyHandler(makeReq({ method: 'GET', query: { token } }), makeRes());
    await authVerifyHandler(makeReq({ method: 'GET', query: { token } }), makeRes());

    // The real user's POST from the confirm page still works
    const res = makeRes();
    await authVerifyHandler(makeReq({ method: 'POST', body: { token } }), res);
    assert.equal(res.statusCode, 302);
    assert.equal(res.redirected, '/app');
    assert.ok(res.cookies.rr_session, 'session cookie should be set');
  });

  test('invalid token format → 400 error page', async () => {
    const res = makeRes();
    await authVerifyHandler(makeReq({ method: 'GET', query: { token: 'not-hex' } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Invalid link/);
  });

  test('already-used token → 400 with helpful hint about scanners', async () => {
    const { token } = await createMagicLink(em('teacher'));
    consumeMagicLink(token);

    const res = makeRes();
    await authVerifyHandler(makeReq({ method: 'GET', query: { token } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /already been used/);
    // The friendlier hint points users at the likely cause
    assert.match(res.body, /email provider/i);
  });

  test('GET with an active session → 302 to /app', async () => {
    const { token } = await createMagicLink(em('teacher'));
    const req = makeReq({
      method: 'GET', query: { token },
      user: { id: 'u1', email: em('teacher') },
    });
    const res = makeRes();
    await authVerifyHandler(req, res);
    assert.equal(res.statusCode, 302);
    assert.equal(res.redirected, '/app');
  });
});

describe('POST /api/auth/verify — consumes the token', () => {
  test('accepts form-urlencoded body', async () => {
    const { token } = await createMagicLink(em('teacher'));
    const res = makeRes();
    await authVerifyHandler(makeReq({ method: 'POST', body: { token } }), res);
    assert.equal(res.statusCode, 302);
    assert.equal(res.redirected, '/app');
    assert.ok(res.cookies.rr_session);
  });

  test('second POST with same token → 400 already-used', async () => {
    const { token } = await createMagicLink(em('teacher'));
    await authVerifyHandler(makeReq({ method: 'POST', body: { token } }), makeRes());

    const res = makeRes();
    await authVerifyHandler(makeReq({ method: 'POST', body: { token } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /already been used/);
  });

  test('POST without token → 400 invalid', async () => {
    const res = makeRes();
    await authVerifyHandler(makeReq({ method: 'POST', body: {} }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /malformed/);
  });

  test('POST with malformed token → 400 invalid', async () => {
    const res = makeRes();
    await authVerifyHandler(makeReq({ method: 'POST', body: { token: 'not-a-token' } }), res);
    assert.equal(res.statusCode, 400);
  });
});

describe('rendered HTML safety', () => {
  test('confirm page escapes a crafted email in the display', async () => {
    // Not a realistic threat (emails are validated upstream) but prove the
    // escape path handles </script> / quotes / tag characters correctly.
    // Since the email goes through getOrCreateUserByEmail normalisation we
    // test the safe() helper indirectly by injecting an odd token.
    const res = makeRes();
    await authVerifyHandler(makeReq({ method: 'GET', query: { token: 'deadbeef<script>' } }), res);
    // Malformed → error page, not an XSS vector
    assert.equal(res.statusCode, 400);
    assert.doesNotMatch(res.body, /<script>/);
  });
});
