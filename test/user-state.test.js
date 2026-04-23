import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openCache, closeCache, getDb } from '../lib/cache.js';
import { getOrCreateUserByEmail } from '../lib/auth.js';
import {
  getUserSettings, setUserSettings,
  listUserHistory, addUserHistory,
  deleteUserHistoryEntry, clearUserHistory,
  userHistoryCount,
  __internals,
} from '../lib/user-state.js';

// Same email-hygiene trick as auth.test.js — the sandbox rewrites literal
// addresses, so we build from parts.
const em = (local) => local + '\x40example.com';

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rr-ustate-'));
  openCache({ path: join(tmpDir, 'test.db') });
});

afterEach(() => {
  closeCache();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('user settings', () => {
  test('returns null before anything is saved', () => {
    const user = getOrCreateUserByEmail(em('teacher'));
    assert.equal(getUserSettings(user.id), null);
  });

  test('round-trips a settings object', () => {
    const user = getOrCreateUserByEmail(em('teacher'));
    const result = setUserSettings(user.id, { grade: '6', term: '3', rubric: true });
    assert.deepEqual(result.settings, { grade: '6', term: '3', rubric: true });
    assert.ok(result.updatedAt > 0);

    const loaded = getUserSettings(user.id);
    assert.deepEqual(loaded.settings, { grade: '6', term: '3', rubric: true });
    assert.equal(loaded.updatedAt, result.updatedAt);
  });

  test('overwrites on second call', () => {
    const user = getOrCreateUserByEmail(em('teacher'));
    setUserSettings(user.id, { grade: '4' });
    setUserSettings(user.id, { grade: '7', subject: 'Maths' });
    const loaded = getUserSettings(user.id);
    assert.deepEqual(loaded.settings, { grade: '7', subject: 'Maths' });
  });

  test('isolates users from each other', () => {
    const a = getOrCreateUserByEmail(em('a'));
    const b = getOrCreateUserByEmail(em('b'));
    setUserSettings(a.id, { grade: '4' });
    setUserSettings(b.id, { grade: '7' });
    assert.equal(getUserSettings(a.id).settings.grade, '4');
    assert.equal(getUserSettings(b.id).settings.grade, '7');
  });

  test('returns null when userId is falsy', () => {
    assert.equal(getUserSettings(null), null);
    assert.equal(getUserSettings(''), null);
  });

  test('throws when setUserSettings called without userId', () => {
    assert.throws(() => setUserSettings(null, { a: 1 }), /userId required/);
  });
});

describe('user history', () => {
  test('list is empty for a new user', () => {
    const user = getOrCreateUserByEmail(em('teacher'));
    assert.deepEqual(listUserHistory(user.id), []);
  });

  test('addUserHistory returns an entry with an id', () => {
    const user = getOrCreateUserByEmail(em('teacher'));
    const entry = addUserHistory(user.id, {
      subj: 'Mathematics', topic: 'Fractions', rtype: 'Test',
      lang: 'English', diff: 'on', grade: 6, term: 3,
      previewSnippet: 'hello world',
    });
    assert.ok(entry.id);
    assert.equal(entry.subj, 'Mathematics');
    assert.equal(entry.grade, 6);
    assert.ok(entry.ts > 0);
  });

  test('list returns newest first', async () => {
    const user = getOrCreateUserByEmail(em('teacher'));
    addUserHistory(user.id, { subj: 'A', rtype: 'Test', grade: 6, term: 1, ts: 1000 });
    addUserHistory(user.id, { subj: 'B', rtype: 'Test', grade: 6, term: 1, ts: 3000 });
    addUserHistory(user.id, { subj: 'C', rtype: 'Test', grade: 6, term: 1, ts: 2000 });
    const rows = listUserHistory(user.id);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(r => r.subj), ['B', 'C', 'A']);
  });

  test('list respects the limit', () => {
    const user = getOrCreateUserByEmail(em('teacher'));
    for (let i = 0; i < 5; i++){
      addUserHistory(user.id, { subj: 'S' + i, rtype: 'Test', grade: 6, term: 1, ts: 1000 + i });
    }
    assert.equal(listUserHistory(user.id, { limit: 2 }).length, 2);
    assert.equal(listUserHistory(user.id, { limit: 999 }).length, 5);
  });

  test('users are isolated', () => {
    const a = getOrCreateUserByEmail(em('a'));
    const b = getOrCreateUserByEmail(em('b'));
    addUserHistory(a.id, { subj: 'A1', rtype: 'Test', grade: 6, term: 1 });
    addUserHistory(b.id, { subj: 'B1', rtype: 'Test', grade: 6, term: 1 });
    assert.equal(listUserHistory(a.id).length, 1);
    assert.equal(listUserHistory(b.id).length, 1);
    assert.equal(listUserHistory(a.id)[0].subj, 'A1');
  });

  test('prunes beyond MAX_HISTORY_PER_USER so the table stays bounded', () => {
    const user = getOrCreateUserByEmail(em('teacher'));
    const total = __internals.MAX_HISTORY_PER_USER + 5;
    for (let i = 0; i < total; i++){
      addUserHistory(user.id, { subj: 'S' + i, rtype: 'Test', grade: 6, term: 1, ts: 1000 + i });
    }
    assert.equal(userHistoryCount(user.id), __internals.MAX_HISTORY_PER_USER);
    const newest = listUserHistory(user.id, { limit: 1 })[0];
    assert.equal(newest.subj, 'S' + (total - 1));
  });

  test('deleteUserHistoryEntry removes only matching entry for that user', () => {
    const a = getOrCreateUserByEmail(em('a'));
    const b = getOrCreateUserByEmail(em('b'));
    const aEntry = addUserHistory(a.id, { subj: 'A1', rtype: 'Test', grade: 6, term: 1 });
    const bEntry = addUserHistory(b.id, { subj: 'B1', rtype: 'Test', grade: 6, term: 1 });

    // Another user can't delete someone else's row
    assert.equal(deleteUserHistoryEntry(b.id, aEntry.id), false);
    assert.equal(userHistoryCount(a.id), 1);

    // Owning user can
    assert.equal(deleteUserHistoryEntry(a.id, aEntry.id), true);
    assert.equal(userHistoryCount(a.id), 0);

    // b unaffected
    assert.equal(userHistoryCount(b.id), 1);
    assert.equal(listUserHistory(b.id)[0].id, bEntry.id);
  });

  test('deleteUserHistoryEntry returns false for unknown id', () => {
    const user = getOrCreateUserByEmail(em('teacher'));
    assert.equal(deleteUserHistoryEntry(user.id, 'nope'), false);
  });

  test('clearUserHistory wipes all rows for that user only', () => {
    const a = getOrCreateUserByEmail(em('a'));
    const b = getOrCreateUserByEmail(em('b'));
    addUserHistory(a.id, { subj: 'A1', rtype: 'Test', grade: 6, term: 1 });
    addUserHistory(a.id, { subj: 'A2', rtype: 'Test', grade: 6, term: 1 });
    addUserHistory(b.id, { subj: 'B1', rtype: 'Test', grade: 6, term: 1 });
    const cleared = clearUserHistory(a.id);
    assert.equal(cleared, 2);
    assert.equal(userHistoryCount(a.id), 0);
    assert.equal(userHistoryCount(b.id), 1);
  });

  test('cascade delete — removing a user removes their history', () => {
    const user = getOrCreateUserByEmail(em('teacher'));
    addUserHistory(user.id, { subj: 'A1', rtype: 'Test', grade: 6, term: 1 });
    // Delete the user directly; SQLite FK should cascade.
    getDb().prepare('DELETE FROM users WHERE id = ?').run(user.id);
    assert.equal(userHistoryCount(user.id), 0);
  });

  test('previewSnippet is capped at 2000 characters', () => {
    const user = getOrCreateUserByEmail(em('teacher'));
    const bigSnippet = 'x'.repeat(5000);
    const entry = addUserHistory(user.id, {
      subj: 'A', rtype: 'Test', grade: 6, term: 1, previewSnippet: bigSnippet,
    });
    assert.equal(entry.previewSnippet.length, 2000);
  });

  test('handles null/undefined fields gracefully', () => {
    const user = getOrCreateUserByEmail(em('teacher'));
    const entry = addUserHistory(user.id, { subj: 'A', rtype: 'Test', grade: 6, term: 1 });
    assert.equal(entry.topic, null);
    assert.equal(entry.lang, null);
    assert.equal(entry.previewSnippet, '');
  });
});
