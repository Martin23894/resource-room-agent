// Per-user sidebar settings and generation history (Phase 2.4b).
//
// Tables live on the shared SQLite DB opened by cache.js. A signed-in teacher
// sees the same settings + history on any device they sign in to. The
// frontend still writes to localStorage as an offline fallback; the server
// copy is authoritative once the user is signed in.

import crypto from 'node:crypto';

import { getDb } from './cache.js';

const MAX_HISTORY_PER_USER = 50;

// ─── Settings ────────────────────────────────────────────────

export function getUserSettings(userId) {
  if (!userId) return null;
  const db = getDb();
  const row = db
    .prepare('SELECT settings, updated_at FROM user_settings WHERE user_id = ?')
    .get(userId);
  if (!row) return null;
  try {
    return { settings: JSON.parse(row.settings), updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export function setUserSettings(userId, settings) {
  if (!userId) throw new Error('userId required');
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO user_settings (user_id, settings, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
  ).run(userId, JSON.stringify(settings), now);
  return { settings, updatedAt: now };
}

// ─── History ─────────────────────────────────────────────────

/**
 * Return up to `limit` history entries for a user, newest first.
 * Matches the shape used by the frontend (subj, topic, rtype, ...).
 */
export function listUserHistory(userId, { limit = 20 } = {}) {
  if (!userId) return [];
  const capped = Math.max(1, Math.min(Number(limit) || 20, MAX_HISTORY_PER_USER));
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, subj, topic, rtype, lang, diff, grade, term, preview_snippet, created_at
       FROM user_history
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(userId, capped);
  return rows.map(rowToEntry);
}

export function addUserHistory(userId, entry) {
  if (!userId) throw new Error('userId required');
  const id = crypto.randomUUID();
  const created = Number(entry.ts) || Date.now();
  const db = getDb();
  db.prepare(
    `INSERT INTO user_history
       (id, user_id, subj, topic, rtype, lang, diff, grade, term, preview_snippet, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    entry.subj ?? null,
    entry.topic ?? null,
    entry.rtype ?? null,
    entry.lang ?? null,
    entry.diff ?? null,
    entry.grade != null ? Number(entry.grade) : null,
    entry.term != null ? Number(entry.term) : null,
    (entry.previewSnippet || '').slice(0, 2000),
    created,
  );

  // Prune oldest rows beyond MAX_HISTORY_PER_USER so no account can grow
  // the table without bound.
  db.prepare(
    `DELETE FROM user_history
     WHERE user_id = ?
       AND id NOT IN (
         SELECT id FROM user_history
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?
       )`,
  ).run(userId, userId, MAX_HISTORY_PER_USER);

  return rowToEntry({
    id,
    subj: entry.subj ?? null,
    topic: entry.topic ?? null,
    rtype: entry.rtype ?? null,
    lang: entry.lang ?? null,
    diff: entry.diff ?? null,
    grade: entry.grade ?? null,
    term: entry.term ?? null,
    preview_snippet: (entry.previewSnippet || '').slice(0, 2000),
    created_at: created,
  });
}

export function deleteUserHistoryEntry(userId, id) {
  if (!userId || !id) return false;
  const db = getDb();
  const { changes } = db
    .prepare('DELETE FROM user_history WHERE id = ? AND user_id = ?')
    .run(id, userId);
  return changes > 0;
}

export function clearUserHistory(userId) {
  if (!userId) return 0;
  const db = getDb();
  return db.prepare('DELETE FROM user_history WHERE user_id = ?').run(userId).changes;
}

export function userHistoryCount(userId) {
  if (!userId) return 0;
  const db = getDb();
  return db
    .prepare('SELECT COUNT(*) AS n FROM user_history WHERE user_id = ?')
    .get(userId).n;
}

// ─── Internals ───────────────────────────────────────────────

function rowToEntry(row) {
  return {
    id: row.id,
    subj: row.subj,
    topic: row.topic,
    rtype: row.rtype,
    lang: row.lang,
    diff: row.diff,
    grade: row.grade,
    term: row.term,
    previewSnippet: row.preview_snippet || '',
    ts: row.created_at,
  };
}

export const __internals = { MAX_HISTORY_PER_USER };
