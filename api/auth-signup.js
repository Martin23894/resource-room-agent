// POST /api/auth/signup — create an account with email + password.
//
// On success: hashes the password, creates the user (or attaches a password
// to an existing magic-link-only account that has no password yet), sends a
// verification email + a welcome email, mints a session cookie and returns
// 200. The teacher can use the app immediately; the verification email lets
// us trust the address later (e.g. for password resets).
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

// Build the welcome email body. Kept inline (rather than a template file)
// because it's the only place we render it and keeping copy with the
// caller makes intent obvious on review.
//
// The verification link goes out in a separate email (createMagicLink with
// purpose='verify'); this one focuses on getting-started content. Two
// short emails read better than one long one and it keeps the verify
// email cleanly transactional for spam-filter scoring.
function buildWelcomeEmail() {
  const base = (process.env.APP_URL || '').replace(/\/+$/, '');
  const appLink = base ? `${base}/app` : '/app';
  const helpLink = base ? `${base}/help` : '/help';
  const subject = 'Welcome to The Resource Room';
  const text = [
    'Hi,',
    '',
    'Welcome to The Resource Room — your 14-day free trial is now active.',
    '',
    "Here's what you can do right away:",
    '  • Generate question papers + memos for Grades 4–7 (worksheets, tests,',
    '    exams, investigations, projects, practicals, assignments).',
    '  • Build full lesson plans + matching PowerPoint slide decks for any',
    '    CAPS unit, with the worksheet baked into the same artefact pack.',
    "  • Use 'Generate full unit series' to create every lesson in a CAPS",
    '    unit in one click — each lesson aware of what came before.',
    '  • Switch between English and Afrikaans for any resource.',
    '',
    'Quick start (3 steps):',
    `  1. Open the app: ${appLink}`,
    '  2. In the sidebar pick Grade, Term, Subject, Topic.',
    '  3. Pick a Resource Type and click Generate.',
    '',
    `Need help? Check the FAQ: ${helpLink}`,
    '— or reply to this email and a real human will read it.',
    '',
    "P.S. We sent a separate email with a link to verify your address. The",
    "app works while you're unverified, but verifying it lets us reset your",
    "password if you ever lose it.",
    '',
    'Happy teaching,',
    '— The Resource Room',
  ].join('\n');
  const html = [
    '<p>Hi,</p>',
    '<p>Welcome to <strong>The Resource Room</strong> — your 14-day free trial is now active.</p>',
    "<p><strong>Here's what you can do right away:</strong></p>",
    '<ul style="line-height:1.6">',
    '  <li>Generate question papers + memos for Grades 4–7 (worksheets, tests, exams, investigations, projects, practicals, assignments).</li>',
    '  <li>Build full lesson plans + matching PowerPoint slide decks for any CAPS unit, with the worksheet baked into the same artefact pack.</li>',
    "  <li>Use <em>Generate full unit series</em> to create every lesson in a CAPS unit in one click — each lesson aware of what came before.</li>",
    '  <li>Switch between English and Afrikaans for any resource.</li>',
    '</ul>',
    '<p><strong>Quick start (3 steps):</strong></p>',
    '<ol style="line-height:1.6">',
    `  <li>Open the app: <a href="${appLink}">${appLink}</a></li>`,
    '  <li>In the sidebar pick Grade, Term, Subject, Topic.</li>',
    '  <li>Pick a Resource Type and click Generate.</li>',
    '</ol>',
    `<p>Need help? Check the <a href="${helpLink}">FAQ</a> — or reply to this email and a real human will read it.</p>`,
    '<p style="font-size:13px;color:#666"><em>P.S. We sent a separate email with a link to verify your address. The app works while you\'re unverified, but verifying lets us reset your password if you ever lose it.</em></p>',
    '<p>Happy teaching,<br>— The Resource Room</p>',
  ].join('');
  return { subject, text, html };
}

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

  // Send verification email AND welcome email. We don't fail signup on
  // either failure — the teacher already has a session, and the
  // verification banner in the app reminds them. Both run sequentially
  // (not Promise.all) so the verification mail wins the spam-prevention
  // race in case Resend rate-limits during a burst signup.
  try {
    await createMagicLink(email, { logger: log, purpose: 'verify' });
  } catch (err) {
    log.error({ err: err?.message, email }, 'signup verification email failed');
  }
  try {
    const { subject, text, html } = buildWelcomeEmail();
    await sendEmail({ to: email, subject, text, html, logger: log });
  } catch (err) {
    log.warn({ err: err?.message, email }, 'welcome email failed (non-fatal)');
  }

  // Mint a session straight away — friendly UX, the verification banner
  // in the app reminds them to confirm their email.
  const session = createSession(user.id);
  res.cookie(COOKIE_NAME, signValue(session.id), cookieOptions());
  log.info({ userId: user.id, email }, 'User signed up');
  return res.status(200).json({ ok: true, requiresVerification: true });
}

export const __exposedForTests = { MIN_PASSWORD_LENGTH, buildWelcomeEmail };
