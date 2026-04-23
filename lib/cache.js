// Result cache for generation responses.
//
// SQLite-backed key/value store with an optional TTL. Used by the /api/generate
// pipeline to return an identical result instantly when a teacher regenerates
// with the same parameters within the TTL window, at zero Anthropic cost.
//
// Storage location is controlled by CACHE_DB_PATH (default: ./data/cache.db).
// Default TTL is 1 hour, overridable with CACHE_TTL_SECONDS.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import { logger as defaultLogger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', 'data', 'cache.db');
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

let db = null;

function resolvePath(p) {
  if (!p) return DEFAULT_DB_PATH;
  return isAbsolute(p) ? p : join(__dirname, '..', p);
}

/**
 * Open (or create) the cache database. Safe to call multiple times; subsequent
 * calls are no-ops. Creates the parent directory if missing and prunes any
 * expired rows up-front.
 */
export function openCache({ path = process.env.CACHE_DB_PATH, logger = defaultLogger } = {}) {
  if (db) return db;
  const resolved = resolvePath(path);
  try {
    mkdirSync(dirname(resolved), { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Every feature that needs persistence creates its tables here. SQLite
  // is happy sharing a file across concerns; one connection + WAL mode
  // handles the concurrency fine at our scale.
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_cache_expires_at ON cache(expires_at);

    -- Magic-link auth (Phase 2.4a).
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT NOT NULL UNIQUE,
      created_at  INTEGER NOT NULL,
      last_login_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS magic_links (
      token       TEXT PRIMARY KEY,
      email       TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      used_at     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email);
    CREATE INDEX IF NOT EXISTS idx_magic_links_expires_at ON magic_links(expires_at);
  `);
  const now = Date.now();
  const pruned = db.prepare('DELETE FROM cache WHERE expires_at IS NOT NULL AND expires_at < ?').run(now).changes;
  const prunedSessions = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now).changes;
  const prunedLinks = db.prepare('DELETE FROM magic_links WHERE expires_at < ?').run(now).changes;
  if (pruned > 0 || prunedSessions > 0 || prunedLinks > 0) {
    logger.info?.({ cache: pruned, sessions: prunedSessions, magicLinks: prunedLinks }, 'DB: pruned expired rows on startup');
  }
  return db;
}

/** Shared DB handle — auth.js and cache.js both go through here. */
export function getDb() {
  if (!db) openCache();
  return db;
}

/**
 * Look up a cached value by key. Returns the parsed JSON or null on miss
 * (including expired entries, which are removed on the fly).
 */
export function cacheGet(key) {
  if (!db) openCache();
  const row = db.prepare('SELECT value, expires_at FROM cache WHERE key = ?').get(key);
  if (!row) return null;
  if (row.expires_at != null && row.expires_at < Date.now()) {
    db.prepare('DELETE FROM cache WHERE key = ?').run(key);
    return null;
  }
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

/**
 * Store a value for a key. `ttlSeconds` defaults to CACHE_TTL_SECONDS env
 * var (or 3600). Pass ttlSeconds=0 for no expiry.
 */
export function cacheSet(key, value, ttlSeconds) {
  if (!db) openCache();
  // Resolution order: explicit arg → env override → default.
  // ttl === 0 means "never expire"; any other number means "expires at
  // now + ttl seconds" (so a negative TTL marks the row as already
  // expired, which is useful for tests and cache-busting).
  let ttl = ttlSeconds;
  if (ttl === undefined || ttl === null) {
    const envTtl = Number(process.env.CACHE_TTL_SECONDS);
    ttl = Number.isFinite(envTtl) ? envTtl : DEFAULT_TTL_SECONDS;
  }
  const now = Date.now();
  const expiresAt = ttl === 0 ? null : now + ttl * 1000;
  db.prepare(
    `INSERT INTO cache (key, value, created_at, expires_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at, expires_at = excluded.expires_at`,
  ).run(key, JSON.stringify(value), now, expiresAt);
}

/** Remove a single entry. Returns true if anything was removed. */
export function cacheDelete(key) {
  if (!db) openCache();
  return db.prepare('DELETE FROM cache WHERE key = ?').run(key).changes > 0;
}

/** Wipe every entry. Useful in tests. */
export function cacheClear() {
  if (!db) openCache();
  db.prepare('DELETE FROM cache').run();
}

/** Number of rows currently in the cache. Useful in tests. */
export function cacheSize() {
  if (!db) openCache();
  return db.prepare('SELECT COUNT(*) AS n FROM cache').get().n;
}

/** Close the connection. Tests call this between cases to reset state. */
export function closeCache() {
  if (db) {
    db.close();
    db = null;
  }
}
