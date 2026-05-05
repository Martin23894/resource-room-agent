import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openCache, closeCache } from '../lib/cache.js';
import { getOrCreateUserByEmail } from '../lib/auth.js';
import settingsHandler from '../api/user-settings.js';
import historyHandler from '../api/user-history.js';
import profileHandler from '../api/user-profile.js';

const em = (local) => local + '\x40example.com';

function makeReq({ method = 'GET', body = null, query = {}, params = {}, user = null } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.body = body;
  req.query = query;
  req.params = params;
  req.headers = {};
  req.user = user;
  req.log = { info: () => {}, warn: () => {}, error: () => {} };
  return req;
}

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = null;
  res.jsonBody = null;
  res.ended = false;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (body) => { res.jsonBody = body; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

let tmpDir;
let user;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rr-endpoints-'));
  openCache({ path: join(tmpDir, 'endpoints.db') });
  user = getOrCreateUserByEmail(em('teacher'));
});

afterEach(() => {
  closeCache();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('/api/user/settings', () => {
  test('GET returns null settings for a fresh user', async () => {
    const req = makeReq({ method: 'GET', user });
    const res = makeRes();
    await settingsHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.settings, null);
  });

  test('GET without auth is a 401', async () => {
    const req = makeReq({ method: 'GET', user: null });
    const res = makeRes();
    await settingsHandler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.jsonBody.code, 'UNAUTHENTICATED');
  });

  test('PUT saves and GET returns the same object', async () => {
    const putReq = makeReq({
      method: 'PUT',
      user,
      body: { settings: { grade: '5', rubric: true } },
    });
    const putRes = makeRes();
    await settingsHandler(putReq, putRes);
    assert.equal(putRes.statusCode, 200);
    assert.deepEqual(putRes.jsonBody.settings, { grade: '5', rubric: true });

    const getReq = makeReq({ method: 'GET', user });
    const getRes = makeRes();
    await settingsHandler(getReq, getRes);
    assert.deepEqual(getRes.jsonBody.settings, { grade: '5', rubric: true });
  });

  test('PUT rejects non-object body', async () => {
    const req = makeReq({ method: 'PUT', user, body: null });
    const res = makeRes();
    await settingsHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  test('PUT rejects missing settings key', async () => {
    const req = makeReq({ method: 'PUT', user, body: { foo: 1 } });
    const res = makeRes();
    await settingsHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  test('PUT rejects array as settings', async () => {
    const req = makeReq({ method: 'PUT', user, body: { settings: [1, 2] } });
    const res = makeRes();
    await settingsHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  test('PUT rejects oversized payload', async () => {
    const huge = {};
    for (let i = 0; i < 1000; i++) huge['k' + i] = 'x'.repeat(20);
    const req = makeReq({ method: 'PUT', user, body: { settings: huge } });
    const res = makeRes();
    await settingsHandler(req, res);
    assert.equal(res.statusCode, 413);
  });

  test('POST is a 405', async () => {
    const req = makeReq({ method: 'POST', user, body: {} });
    const res = makeRes();
    await settingsHandler(req, res);
    assert.equal(res.statusCode, 405);
  });

  test('per-user isolation — A cannot read B\'s settings', async () => {
    const b = getOrCreateUserByEmail(em('b'));
    const putReq = makeReq({ method: 'PUT', user: b, body: { settings: { grade: 'B-only' } } });
    await settingsHandler(putReq, makeRes());

    const getReq = makeReq({ method: 'GET', user });
    const getRes = makeRes();
    await settingsHandler(getReq, getRes);
    assert.equal(getRes.jsonBody.settings, null);
  });
});

describe('/api/user/history', () => {
  const VALID_ENTRY = {
    subj: 'Mathematics', topic: 'Fractions', rtype: 'Test',
    lang: 'English', diff: 'on', grade: 6, term: 3,
    previewSnippet: 'preview',
  };

  test('GET returns an empty list initially', async () => {
    const req = makeReq({ method: 'GET', user });
    const res = makeRes();
    await historyHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.jsonBody.history, []);
  });

  test('GET without auth is a 401', async () => {
    const req = makeReq({ method: 'GET', user: null });
    const res = makeRes();
    await historyHandler(req, res);
    assert.equal(res.statusCode, 401);
  });

  test('POST then GET round-trips an entry', async () => {
    const postReq = makeReq({ method: 'POST', user, body: { entry: VALID_ENTRY } });
    const postRes = makeRes();
    await historyHandler(postReq, postRes);
    assert.equal(postRes.statusCode, 201);
    assert.ok(postRes.jsonBody.entry.id);
    assert.equal(postRes.jsonBody.entry.subj, 'Mathematics');

    const getReq = makeReq({ method: 'GET', user });
    const getRes = makeRes();
    await historyHandler(getReq, getRes);
    assert.equal(getRes.jsonBody.history.length, 1);
    assert.equal(getRes.jsonBody.history[0].subj, 'Mathematics');
  });

  test('POST accepts bare entry (no "entry" wrapper)', async () => {
    const req = makeReq({ method: 'POST', user, body: VALID_ENTRY });
    const res = makeRes();
    await historyHandler(req, res);
    assert.equal(res.statusCode, 201);
  });

  test('POST rejects missing required subject', async () => {
    const req = makeReq({
      method: 'POST', user,
      body: { entry: { ...VALID_ENTRY, subj: '' } },
    });
    const res = makeRes();
    await historyHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.jsonBody.error, /subj/i);
  });

  test('POST rejects out-of-range grade', async () => {
    const req = makeReq({
      method: 'POST', user,
      body: { entry: { ...VALID_ENTRY, grade: 99 } },
    });
    const res = makeRes();
    await historyHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  test('DELETE /:id removes only that entry', async () => {
    const postRes = makeRes();
    await historyHandler(
      makeReq({ method: 'POST', user, body: { entry: VALID_ENTRY } }),
      postRes,
    );
    const id = postRes.jsonBody.entry.id;

    const delReq = makeReq({ method: 'DELETE', user, params: { id } });
    const delRes = makeRes();
    await historyHandler(delReq, delRes);
    assert.equal(delRes.statusCode, 204);

    const getRes = makeRes();
    await historyHandler(makeReq({ method: 'GET', user }), getRes);
    assert.equal(getRes.jsonBody.history.length, 0);
  });

  test('DELETE /:id is a 404 for unknown id', async () => {
    const req = makeReq({ method: 'DELETE', user, params: { id: 'nope' } });
    const res = makeRes();
    await historyHandler(req, res);
    assert.equal(res.statusCode, 404);
  });

  test('DELETE without id clears everything for that user', async () => {
    await historyHandler(makeReq({ method: 'POST', user, body: { entry: VALID_ENTRY } }), makeRes());
    await historyHandler(makeReq({ method: 'POST', user, body: { entry: VALID_ENTRY } }), makeRes());

    const req = makeReq({ method: 'DELETE', user });
    const res = makeRes();
    await historyHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.cleared, 2);
  });

  test('one user cannot delete another user\'s entry', async () => {
    const b = getOrCreateUserByEmail(em('b'));
    const postRes = makeRes();
    await historyHandler(
      makeReq({ method: 'POST', user: b, body: { entry: VALID_ENTRY } }),
      postRes,
    );
    const bId = postRes.jsonBody.entry.id;

    // User A tries to delete B's entry
    const delReq = makeReq({ method: 'DELETE', user, params: { id: bId } });
    const delRes = makeRes();
    await historyHandler(delReq, delRes);
    assert.equal(delRes.statusCode, 404);

    // Confirm B still has the entry
    const getRes = makeRes();
    await historyHandler(makeReq({ method: 'GET', user: b }), getRes);
    assert.equal(getRes.jsonBody.history.length, 1);
  });

  test('PUT is a 405', async () => {
    const req = makeReq({ method: 'PUT', user, body: {} });
    const res = makeRes();
    await historyHandler(req, res);
    assert.equal(res.statusCode, 405);
  });
});

describe('/api/user/profile', () => {
  test('GET without auth is a 401', async () => {
    const req = makeReq({ method: 'GET', user: null });
    const res = makeRes();
    await profileHandler(req, res);
    assert.equal(res.statusCode, 401);
  });

  test('GET returns an empty profile (complete=false) for a fresh user', async () => {
    const req = makeReq({ method: 'GET', user });
    const res = makeRes();
    await profileHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.profile.complete, false);
    assert.equal(res.jsonBody.profile.displayName, null);
    assert.deepEqual(res.jsonBody.profile.gradesTaught, []);
  });

  test('PUT saves profile and flips complete=true', async () => {
    const putReq = makeReq({
      method: 'PUT',
      user,
      body: {
        displayName: 'Thandi Khumalo',
        school: 'Sandton Primary',
        role: 'Intermediate Phase Teacher',
        gradesTaught: [4, 6],
        subjectsTaught: ['Mathematics'],
        province: 'Gauteng',
      },
    });
    const putRes = makeRes();
    await profileHandler(putReq, putRes);
    assert.equal(putRes.statusCode, 200);
    assert.equal(putRes.jsonBody.profile.displayName, 'Thandi Khumalo');
    assert.equal(putRes.jsonBody.profile.school, 'Sandton Primary');
    assert.equal(putRes.jsonBody.profile.complete, true);
    assert.deepEqual(putRes.jsonBody.profile.gradesTaught, [4, 6]);
    assert.deepEqual(putRes.jsonBody.profile.subjectsTaught, ['Mathematics']);

    const completedAt = putRes.jsonBody.profile.completedAt;
    assert.ok(completedAt);

    // A second PUT with new values must NOT shift completedAt forward.
    await new Promise((r) => setTimeout(r, 5));
    const putReq2 = makeReq({
      method: 'PUT',
      user,
      body: {
        displayName: 'Thandi K.',
        gradesTaught: [4, 5, 6],
        subjectsTaught: [],
      },
    });
    const putRes2 = makeRes();
    await profileHandler(putReq2, putRes2);
    assert.equal(putRes2.statusCode, 200);
    assert.equal(putRes2.jsonBody.profile.displayName, 'Thandi K.');
    assert.deepEqual(putRes2.jsonBody.profile.gradesTaught, [4, 5, 6]);
    assert.equal(putRes2.jsonBody.profile.completedAt, completedAt);
  });

  test('PUT requires displayName', async () => {
    const req = makeReq({
      method: 'PUT', user,
      body: { displayName: '   ', school: 'X' },
    });
    const res = makeRes();
    await profileHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.jsonBody.error, /displayName/);
  });

  test('PUT rejects an invalid province', async () => {
    const req = makeReq({
      method: 'PUT', user,
      body: { displayName: 'A', province: 'Atlantis' },
    });
    const res = makeRes();
    await profileHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.jsonBody.error, /province/i);
  });

  test('PUT silently drops out-of-range grades', async () => {
    const req = makeReq({
      method: 'PUT', user,
      body: { displayName: 'A', gradesTaught: [3, 4, 7, 8, 'six'] },
    });
    const res = makeRes();
    await profileHandler(req, res);
    assert.equal(res.statusCode, 200);
    // Only 4 and 7 are valid (3 and 8 out of range, 'six' non-numeric).
    assert.deepEqual(res.jsonBody.profile.gradesTaught, [4, 7]);
  });

  test('per-user isolation — A cannot read B\'s profile', async () => {
    const b = getOrCreateUserByEmail(em('b'));
    await profileHandler(
      makeReq({ method: 'PUT', user: b, body: { displayName: 'Bee' } }),
      makeRes(),
    );
    const res = makeRes();
    await profileHandler(makeReq({ method: 'GET', user }), res);
    assert.equal(res.jsonBody.profile.displayName, null);
  });

  test('POST is a 405', async () => {
    const req = makeReq({ method: 'POST', user, body: {} });
    const res = makeRes();
    await profileHandler(req, res);
    assert.equal(res.statusCode, 405);
  });
});
