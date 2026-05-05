// POST /api/auth/signin — verify email + password and mint a session.
//
// Returns the SAME generic error message regardless of whether the email
// is unknown, has no password set yet, or the password is wrong. That
// keeps the endpoint from being usable to enumerate registered emails.
// (The "Forgot password?" flow is the right way for a real teacher who
// has a magic-link-only account to attach a password.)

import { logger as defaultLogger } from '../lib/logger.js';
import { looksLikeEmail } from '../lib/email.js';
import {
  getUserByEmail, createSession, signValue, cookieOptions, COOKIE_NAME,
} from '../lib/auth.js';
import { verifyPassword } from '../lib/password.js';

const GENERIC_ERROR = 'Incorrect email or password';

export default async function handler(req, res) {
  const log = req.log || defaultLogger;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!looksLikeEmail(email) || !password) {
    return res.status(401).json({ error: GENERIC_ERROR });
  }

  const user = getUserByEmail(email);
  if (!user || !user.password_hash) {
    return res.status(401).json({ error: GENERIC_ERROR });
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    log.info({ email }, 'signin: wrong password');
    return res.status(401).json({ error: GENERIC_ERROR });
  }

  const session = createSession(user.id);
  res.cookie(COOKIE_NAME, signValue(session.id), cookieOptions());
  log.info({ userId: user.id, email }, 'User signed in');
  return res.status(200).json({ ok: true, requiresVerification: !user.email_verified_at });
}
