// Passwordless magic-link auth with HMAC-signed session cookies.
//
// Flow:
//   1. POST /api/auth/request { email } →
//      creates a magic_links row with a 32-byte hex token, 15-min expiry,
//      sends the verify URL via email (console driver in dev, Resend in prod).
//
//   2. GET /api/auth/verify?token=… →
//      atomically consumes the token (sets used_at), creates-or-finds the
//      user row by email, creates a sessions row, sets a signed cookie,
//      then 302 redirects to /.
//
//   3. Every subsequent request → parseSession middleware reads the cookie,
//      verifies the HMAC, looks up the session, attaches req.user.
//
//   4. POST /api/auth/logout → deletes the session row and clears the cookie.
//
// Tokens and session IDs are both generated with crypto.randomBytes(32) so
// guessing is not feasible. The session cookie is HMAC-signed against
// AUTH_SECRET so a client can't forge one even if they guess a session ID.

import crypto from 'node:crypto';

import { getDb } from './cache.js';
import { logger as defaultLogger } from './logger.js';
import { sendEmail } from './email.js';
import { TRIAL_DAYS } from './billing.js';

export const COOKIE_NAME = 'rr_session';
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─────────────────────────────────────────────────────────────
// Secret handling
// ─────────────────────────────────────────────────────────────
let authSecret = null;
function getAuthSecret() {
  if (authSecret) return authSecret;
  const envSecret = process.env.AUTH_SECRET;
  if (envSecret && envSecret.length >= 32) {
    authSecret = envSecret;
    return authSecret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required in production (min 32 chars)');
  }
  // Dev-only fallback: generate a random key in memory. Sessions won't
  // survive a restart — fine for local dev, a disaster in prod.
  authSecret = crypto.randomBytes(32).toString('hex');
  defaultLogger.warn('AUTH_SECRET not set — generated an ephemeral secret for this process. Set AUTH_SECRET to persist sessions across restarts.');
  return authSecret;
}

export function signValue(value) {
  const hmac = crypto.createHmac('sha256', getAuthSecret()).update(value).digest('hex');
  return `${value}.${hmac}`;
}

export function verifySignedValue(signed) {
  if (typeof signed !== 'string') return null;
  const lastDot = signed.lastIndexOf('.');
  if (lastDot < 1) return null;
  const value = signed.slice(0, lastDot);
  const sig = signed.slice(lastDot + 1);
  const expected = crypto.createHmac('sha256', getAuthSecret()).update(value).digest('hex');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  return value;
}

// ─────────────────────────────────────────────────────────────
// Magic links
// ─────────────────────────────────────────────────────────────

export async function createMagicLink(email, { logger = defaultLogger, appUrl } = {}) {
  const db = getDb();
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare(
    'INSERT INTO magic_links (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(token, email.toLowerCase().trim(), now, now + MAGIC_LINK_TTL_MS);

  const base = (appUrl || process.env.APP_URL || '').replace(/\/+$/, '');
  const verifyUrl = `${base || ''}/api/auth/verify?token=${token}`;

  const subject = 'Your sign-in link for The Resource Room';
  const text = [
    'Hi,',
    '',
    'Click the link below to sign in to The Resource Room:',
    '',
    verifyUrl,
    '',
    'This link expires in 15 minutes and can only be used once.',
    '',
    "If you didn't request this, you can ignore this email.",
  ].join('\n');
  const html = [
    '<p>Hi,</p>',
    `<p>Click the link below to sign in to <strong>The Resource Room</strong>:</p>`,
    `<p><a href="${verifyUrl}" style="background:#085041;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">Sign in</a></p>`,
    `<p style="font-size:12px;color:#666">or paste this URL into your browser:<br><code>${verifyUrl}</code></p>`,
    '<p style="font-size:12px;color:#666">This link expires in 15 minutes and can only be used once.</p>',
    '<p style="font-size:12px;color:#999">If you didn\'t request this, you can ignore this email.</p>',
  ].join('');

  await sendEmail({ to: email, subject, text, html, logger });
  return { token, verifyUrl };
}

/**
 * Consume a magic-link token. Returns the created-or-found user on success,
 * throws otherwise (unknown / expired / already used). The consumption is
 * atomic: the token's used_at column is set before the session is created.
 */
export function consumeMagicLink(token) {
  const db = getDb();
  const now = Date.now();
  const row = db.prepare('SELECT token, email, expires_at, used_at FROM magic_links WHERE token = ?').get(token);
  if (!row) throw new Error('Unknown or invalid token');
  if (row.used_at) throw new Error('This link has already been used');
  if (row.expires_at < now) throw new Error('This link has expired — request a new one');

  const markUsed = db.prepare('UPDATE magic_links SET used_at = ? WHERE token = ? AND used_at IS NULL');
  const { changes } = markUsed.run(now, token);
  if (changes !== 1) throw new Error('This link has already been used');

  return getOrCreateUserByEmail(row.email);
}

// ─────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────

const USER_COLS = `id, email, created_at, last_login_at,
  stripe_customer_id, stripe_subscription_id, subscription_status,
  subscription_tier, current_period_end, trial_ends_at`;

export function getOrCreateUserByEmail(email) {
  const db = getDb();
  const normalised = email.toLowerCase().trim();
  const existing = db.prepare(`SELECT ${USER_COLS} FROM users WHERE email = ?`).get(normalised);
  const now = Date.now();
  if (existing) {
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, existing.id);
    return { ...existing, last_login_at: now };
  }
  const id = crypto.randomUUID();
  const trialEndsAt = now + TRIAL_DAYS * 24 * 60 * 60 * 1000;
  db.prepare(
    `INSERT INTO users (id, email, created_at, last_login_at, trial_ends_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, normalised, now, now, trialEndsAt);
  return {
    id, email: normalised, created_at: now, last_login_at: now,
    stripe_customer_id: null, stripe_subscription_id: null,
    subscription_status: null, subscription_tier: null,
    current_period_end: null, trial_ends_at: trialEndsAt,
  };
}

export function getUserById(id) {
  if (!id) return null;
  const db = getDb();
  return db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) || null;
}

// ─────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────

export function createSession(userId) {
  const db = getDb();
  const id = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(id, userId, now, expiresAt);
  return { id, userId, createdAt: now, expiresAt };
}

export function deleteSession(sessionId) {
  if (!sessionId) return;
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function loadSessionUser(sessionId) {
  if (!sessionId) return null;
  const db = getDb();
  const row = db.prepare(
    `SELECT s.id AS session_id, s.expires_at,
            u.id AS user_id, u.email, u.created_at, u.last_login_at,
            u.stripe_customer_id, u.stripe_subscription_id,
            u.subscription_status, u.subscription_tier,
            u.current_period_end, u.trial_ends_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
  ).get(sessionId);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }
  return {
    id: row.user_id,
    email: row.email,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    stripe_customer_id: row.stripe_customer_id,
    stripe_subscription_id: row.stripe_subscription_id,
    subscription_status: row.subscription_status,
    subscription_tier: row.subscription_tier,
    current_period_end: row.current_period_end,
    trial_ends_at: row.trial_ends_at,
    sessionId: row.session_id,
  };
}

// ─────────────────────────────────────────────────────────────
// Cookie helpers
// ─────────────────────────────────────────────────────────────

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

/** Express middleware: decodes the session cookie (if any) and attaches
 *  req.user (null when anonymous). Never throws — a bad cookie just leaves
 *  the request anonymous. */
export function parseSession(req, _res, next) {
  req.user = null;
  const raw = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!raw) return next();
  const sessionId = verifySignedValue(raw);
  if (!sessionId) return next();
  const user = loadSessionUser(sessionId);
  req.user = user;
  next();
}

/** Express middleware: 401 when req.user is missing. */
export function requireAuth(req, res, next) {
  if (req.user) return next();
  return res.status(401).json({ error: 'Sign in required', code: 'UNAUTHENTICATED' });
}

// ─────────────────────────────────────────────────────────────
// Cookie parser (minimal, no dependency)
// ─────────────────────────────────────────────────────────────

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const k = pair.slice(0, idx).trim();
    if (!k) continue;
    let v = pair.slice(idx + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    try { out[k] = decodeURIComponent(v); }
    catch { out[k] = v; }
  }
  return out;
}
