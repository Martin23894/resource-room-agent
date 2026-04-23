import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openCache, closeCache } from '../lib/cache.js';
import {
  signValue, verifySignedValue,
  createMagicLink, consumeMagicLink,
  getOrCreateUserByEmail, getUserById,
  createSession, deleteSession, loadSessionUser,
  parseCookies,
} from '../lib/auth.js';

// See email.test.js — the sandbox rewrites literal emails at save time,
// so we build them from parts. \x40 is the @ character.
const em = (local, domain = 'example.com') => local + '\x40' + domain;

let tmpDir;
let prevSecret, prevProvider;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rr-auth-'));
  openCache({ path: join(tmpDir, 'auth.db') });
  prevSecret = process.env.AUTH_SECRET;
  prevProvider = process.env.EMAIL_PROVIDER;
  process.env.AUTH_SECRET = 'a'.repeat(64); // deterministic secret for tests
  process.env.EMAIL_PROVIDER = 'disabled';   // don't try to send real email
});

afterEach(() => {
  closeCache();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = prevSecret;
  if (prevProvider === undefined) delete process.env.EMAIL_PROVIDER;
  else process.env.EMAIL_PROVIDER = prevProvider;
});

describe('HMAC sign/verify', () => {
  test('verifySignedValue returns the original value for a valid signature', () => {
    const signed = signValue('abc123');
    assert.equal(verifySignedValue(signed), 'abc123');
  });
  test('tampered signature returns null', () => {
    const signed = signValue('abc123');
    // Flip the last hex char from 'x' to something else. We pick the SECOND
    // last hex char to guarantee we land on a valid hex char.
    const parts = signed.split('.');
    const sig = parts[parts.length - 1];
    const tamperedChar = sig[sig.length - 1] === '0' ? '1' : '0';
    const tampered = parts[0] + '.' + sig.slice(0, -1) + tamperedChar;
    assert.equal(verifySignedValue(tampered), null);
  });
  test('tampered value returns null', () => {
    const signed = signValue('abc123');
    const parts = signed.split('.');
    const tampered = 'abc124' + '.' + parts[parts.length - 1];
    assert.equal(verifySignedValue(tampered), null);
  });
  test('handles garbage input without throwing', () => {
    assert.equal(verifySignedValue('not-a-signed-value'), null);
    assert.equal(verifySignedValue(null), null);
    assert.equal(verifySignedValue(''), null);
  });
});

describe('users', () => {
  test('getOrCreateUserByEmail creates then finds the same row', () => {
    const a = getOrCreateUserByEmail(em('teacher'));
    const b = getOrCreateUserByEmail(em('teacher'));
    assert.equal(a.id, b.id);
    assert.equal(b.email, em('teacher'));
  });
  test('email is normalised (lowercased, trimmed)', () => {
    const a = getOrCreateUserByEmail('  ' + em('MIXEDcase').toUpperCase() + '  ');
    assert.equal(a.email, em('mixedcase'));
  });
  test('last_login_at is refreshed on subsequent lookups', async () => {
    const a = getOrCreateUserByEmail(em('teacher'));
    await new Promise((r) => setTimeout(r, 10));
    const b = getOrCreateUserByEmail(em('teacher'));
    assert.ok(b.last_login_at >= a.last_login_at);
  });
  test('getUserById returns null for unknown id', () => {
    assert.equal(getUserById('nope'), null);
    assert.equal(getUserById(null), null);
  });
});

describe('magic links', () => {
  test('createMagicLink + consumeMagicLink round-trip creates a user', async () => {
    const { token } = await createMagicLink(em('teacher'));
    const user = consumeMagicLink(token);
    assert.equal(user.email, em('teacher'));
  });
  test('consumeMagicLink rejects an unknown token', () => {
    assert.throws(() => consumeMagicLink('does-not-exist'), /Unknown/);
  });
  test('consumeMagicLink rejects a token already used (single-use)', async () => {
    const { token } = await createMagicLink(em('teacher'));
    consumeMagicLink(token);
    assert.throws(() => consumeMagicLink(token), /already been used/);
  });
});

describe('sessions', () => {
  test('create + load returns the user', () => {
    const user = getOrCreateUserByEmail(em('teacher'));
    const session = createSession(user.id);
    const loaded = loadSessionUser(session.id);
    assert.equal(loaded.email, em('teacher'));
    assert.equal(loaded.sessionId, session.id);
  });
  test('deleteSession removes the row and subsequent loads return null', () => {
    const user = getOrCreateUserByEmail(em('teacher'));
    const session = createSession(user.id);
    deleteSession(session.id);
    assert.equal(loadSessionUser(session.id), null);
  });
  test('loadSessionUser returns null for unknown id', () => {
    assert.equal(loadSessionUser('nope'), null);
    assert.equal(loadSessionUser(null), null);
  });
});

describe('cookie parsing', () => {
  test('splits and decodes a typical header', () => {
    const c = parseCookies('foo=bar; rr_session=abc%20def; other=');
    assert.equal(c.foo, 'bar');
    assert.equal(c.rr_session, 'abc def');
    assert.equal(c.other, '');
  });
  test('returns empty object for missing header', () => {
    assert.deepEqual(parseCookies(null), {});
    assert.deepEqual(parseCookies(undefined), {});
    assert.deepEqual(parseCookies(''), {});
  });
});
