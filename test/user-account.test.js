// Tests for the POPIA right-to-erasure flow:
//   - lib/auth.js#deleteUserCascade
//   - DELETE /api/user/account handler
//
// Both exercise a temporary SQLite DB; no Express app is booted.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openCache, closeCache, getDb } from '../lib/cache.js';
import {
  getOrCreateUserByEmail, getUserByEmail, getUserById,
  createMagicLink, createSession, deleteUserCascade,
} from '../lib/auth.js';
import { addUserHistory, getUserSettings, setUserSettings } from '../lib/user-state.js';
import accountHandler from '../api/user-account.js';

const em = (local) => local + '\x40example.com';

function makeReq({ method = 'DELETE', body = null, user = null } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.body = body;
  req.headers = {};
  req.user = user;
  req.log = { info: () => {}, warn: () => {}, error: () => {} };
  return req;
}

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = null;
  res.jsonBody = null;
  res.cookiesCleared = [];
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.jsonBody = b; return res; };
  res.clearCookie = (name) => { res.cookiesCleared.push(name); return res; };
  return res;
}

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rr-acct-'));
  openCache({ path: join(tmpDir, 'acct.db') });
  // Email driver disabled so the confirmation send never hits the network.
  process.env.EMAIL_PROVIDER = 'disabled';
});

afterEach(() => {
  closeCache();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────
// lib/auth — deleteUserCascade
// ─────────────────────────────────────────────────────────────────────────

describe('deleteUserCascade', () => {
  test('removes the user row and every related state row', async () => {
    const user = getOrCreateUserByEmail(em('victim'));

    // Populate every table that references the user
    setUserSettings(user.id, { grade: 6 });
    addUserHistory(user.id, {
      subj: 'Mathematics', topic: 'Fractions', rtype: 'Test',
      lang: 'English', diff: 'on', grade: 6, term: 2,
    });
    createSession(user.id);
    await createMagicLink(em('victim'), { purpose: 'reset' });

    // Sanity-check we set up state
    const db = getDb();
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(user.id).n, 1);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM user_settings WHERE user_id = ?').get(user.id).n, 1);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM user_history WHERE user_id = ?').get(user.id).n, 1);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM magic_links WHERE email = ?').get(em('victim')).n, 1);

    const result = deleteUserCascade(user.id, user.email);
    assert.equal(result.user, 1);
    assert.equal(result.sessions, 1);
    assert.equal(result.settings, 1);
    assert.equal(result.history, 1);
    assert.equal(result.magicLinks, 1);

    // Everything related is gone
    assert.equal(getUserById(user.id), null);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(user.id).n, 0);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM user_settings WHERE user_id = ?').get(user.id).n, 0);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM user_history WHERE user_id = ?').get(user.id).n, 0);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM magic_links WHERE email = ?').get(em('victim')).n, 0);
  });

  test('does not touch other users\' data', () => {
    const a = getOrCreateUserByEmail(em('a'));
    const b = getOrCreateUserByEmail(em('b'));
    setUserSettings(a.id, { grade: 4 });
    setUserSettings(b.id, { grade: 7 });
    addUserHistory(b.id, {
      subj: 'English', topic: 'X', rtype: 'Worksheet',
      lang: 'English', diff: 'on', grade: 7, term: 1,
    });

    deleteUserCascade(a.id, a.email);

    // B is untouched
    assert.ok(getUserById(b.id));
    assert.deepEqual(getUserSettings(b.id)?.settings, { grade: 7 });
    const db = getDb();
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM user_history WHERE user_id = ?').get(b.id).n, 1);
  });

  test('throws on missing userId', () => {
    assert.throws(() => deleteUserCascade(null, 'foo'));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/user/account handler
// ─────────────────────────────────────────────────────────────────────────

describe('DELETE /api/user/account', () => {
  test('401 without auth', async () => {
    const res = makeRes();
    await accountHandler(makeReq({ user: null, body: { confirmEmail: em('a') } }), res);
    assert.equal(res.statusCode, 401);
  });

  test('400 when confirmEmail is missing', async () => {
    const user = getOrCreateUserByEmail(em('a'));
    const res = makeRes();
    await accountHandler(makeReq({ user, body: {} }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.jsonBody.error, /Type your account email/);
  });

  test('400 when confirmEmail does not match the signed-in email', async () => {
    const user = getOrCreateUserByEmail(em('a'));
    const res = makeRes();
    await accountHandler(makeReq({ user, body: { confirmEmail: em('different') } }), res);
    assert.equal(res.statusCode, 400);
  });

  test('happy path deletes the user, clears the cookie, returns counts', async () => {
    const user = getOrCreateUserByEmail(em('a'));
    setUserSettings(user.id, { grade: 5 });
    createSession(user.id);

    const res = makeRes();
    await accountHandler(makeReq({ user, body: { confirmEmail: em('a') } }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.ok, true);
    assert.equal(res.jsonBody.deleted.user, 1);
    assert.deepEqual(res.cookiesCleared, ['rr_session']);
    assert.equal(getUserById(user.id), null);
  });

  test('case-insensitive match — confirmEmail with different capitalisation works', async () => {
    const user = getOrCreateUserByEmail(em('mixedcase'));
    const res = makeRes();
    // The handler lower-cases confirmEmail before comparing
    await accountHandler(makeReq({ user, body: { confirmEmail: em('MixedCase').toUpperCase() } }), res);
    assert.equal(res.statusCode, 200);
  });

  test('one user cannot delete another user\'s account by spoofing confirmEmail', async () => {
    const attacker = getOrCreateUserByEmail(em('attacker'));
    const target = getOrCreateUserByEmail(em('target'));
    // Attacker passes their own session but tries to confirm the target's email
    const res = makeRes();
    await accountHandler(makeReq({
      user: attacker,
      body: { confirmEmail: em('target') },
    }), res);
    assert.equal(res.statusCode, 400);
    // Both users still exist
    assert.ok(getUserById(attacker.id));
    assert.ok(getUserById(target.id));
  });

  test('non-DELETE methods → 405', async () => {
    const user = getOrCreateUserByEmail(em('a'));
    for (const method of ['GET', 'POST', 'PUT', 'PATCH']) {
      const res = makeRes();
      await accountHandler(makeReq({ method, user, body: {} }), res);
      assert.equal(res.statusCode, 405);
    }
  });
});
