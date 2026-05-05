// POST /api/auth/signup — create an account with email + password.
//
// On success: hashes the password, creates the user (or attaches a password
// to an existing magic-link-only account that has no password yet), sends a
// verification email, mints a session cookie and returns 200. The teacher
// can use the app immediately; the verification email lets us trust the
// address later (e.g. for password resets).
//
// We deliberately return the SAME 200/ok shape whether or not the email was
// previously known. That avoids leaking which addresses already have
// accounts (account-enumeration via the signup endpoint).
//
// What we DON'T do: overwrite an existing password. If the email is already
// associated with a password_hash, we silently send a "you already have an
// account — sign in or reset your password" notification and treat the
// request as a no-op rather than letting an attacker reset by re-signing-up.

import { logger as defaultLogger } from '../lib/logger.js';
import { sendEmail, looksLikeEmail } from '../lib/email.js';
import {
  getUserByEmail, getOrCreateUserByEmail, setUserPasswordHash,
  createMagicLink, createSession, signValue, cookieOptions, COOKIE_NAME,
} from '../lib/auth.js';
import {
  hashPassword, validatePassword, MIN_PASSWORD_LENGTH,
} from '../lib/password.js';

export default async function handler(req, res) {
  const log = req.log || defaultLogger;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!looksLikeEmail(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  try {
    validatePassword(password);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Check existing state. If they already have a password set, don't
  // overwrite it — that would be a trivial account takeover. Return a
  // generic ok response and (optionally) email them a heads-up.
  const existing = getUserByEmail(email);
  if (existing && existing.password_hash) {
    log.info({ email }, 'signup: email already has a password — sending heads-up email');
    try {
      await sendEmail({
        to: email,
        subject: 'You already have an account — The Resource Room',
        text: [
          'Hi,',
          '',
          'Someone (probably you) tried to create a new account with this email.',
          "You already have an account, so we didn't change anything.",
          '',
          'If this was you, just sign in. If you forgot your password, use the',
          '"Forgot password?" link on the sign-in page.',
          '',
          "If it wasn't you, you can ignore this message — your account is safe.",
        ].join('\n'),
        logger: log,
      });
    } catch (err) {
      log.warn({ err: err?.message }, 'signup heads-up email failed (non-fatal)');
    }
    // Return ok regardless so we don't leak account existence.
    return res.status(200).json({ ok: true });
  }

  let hash;
  try {
    hash = await hashPassword(password);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Could not hash password' });
  }

  // getOrCreateUserByEmail keeps an existing magic-link-only user row,
  // so a teacher who previously signed in via magic link can complete
  // their account by setting a password here.
  const user = getOrCreateUserByEmail(email);
  setUserPasswordHash(user.id, hash);

  // Send verification email. We don't fail the signup on email errors —
  // the teacher already has a session, and they can request a fresh
  // verification email from /account later.
  try {
    await createMagicLink(email, { logger: log, purpose: 'verify' });
  } catch (err) {
    log.error({ err: err?.message, email }, 'signup verification email failed');
  }

  // Mint a session straight away — friendly UX, the verification banner
  // in the app reminds them to confirm their email.
  const session = createSession(user.id);
  res.cookie(COOKIE_NAME, signValue(session.id), cookieOptions());
  log.info({ userId: user.id, email }, 'User signed up');
  return res.status(200).json({ ok: true, requiresVerification: true });
}

export const __exposedForTests = { MIN_PASSWORD_LENGTH };
