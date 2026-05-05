// DELETE /api/user/account — permanently delete the signed-in teacher's
// account (POPIA right-to-erasure).
//
// Requires the request body to contain `confirmEmail` matching the
// signed-in user's email exactly. That's a "are you really sure?" gate
// that matches the typed-confirmation pattern used by GitHub / Stripe /
// most production tools.
//
// On success: sends a confirmation email, runs deleteUserCascade(),
// clears the session cookie, returns 200 { ok: true }. The frontend
// then redirects to the landing page.
//
// We send the confirmation email BEFORE the delete fires — once the
// row is gone we can still email (the recipient address is in scope),
// but doing it first means a flaky email provider doesn't leave the
// teacher with a deleted account and no audit trail. If the email
// fails we log it but proceed with the deletion (POPIA doesn't let
// us refuse erasure because email is broken).

import { logger as defaultLogger } from '../lib/logger.js';
import {
  deleteUserCascade, deleteSession, COOKIE_NAME, cookieOptions,
} from '../lib/auth.js';
import { sendEmail } from '../lib/email.js';

export default async function handler(req, res) {
  const log = req.log || defaultLogger;
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  if (!req.user) {
    return res.status(401).json({ error: 'Sign in required', code: 'UNAUTHENTICATED' });
  }

  const confirmEmail = String(req.body?.confirmEmail || '').trim().toLowerCase();
  if (!confirmEmail || confirmEmail !== req.user.email) {
    return res.status(400).json({
      error: 'Type your account email exactly to confirm deletion.',
    });
  }

  // Best-effort confirmation email. Logs but doesn't block the delete.
  try {
    const text = [
      'Hi,',
      '',
      'Your Resource Room account has been permanently deleted.',
      'All your settings, history and profile have been removed from our database.',
      '',
      "If you didn't request this, please email us straight away at [email protected] — we may still be able to help.",
      '',
      '— The Resource Room',
    ].join('\n');
    await sendEmail({
      to: req.user.email,
      subject: 'Your Resource Room account was deleted',
      text,
      logger: log,
    });
  } catch (err) {
    log.warn({ err: err?.message, userId: req.user.id }, 'Account-deletion confirmation email failed (non-fatal)');
  }

  let result;
  try {
    result = deleteUserCascade(req.user.id, req.user.email);
  } catch (err) {
    log.error({ err: err?.message, userId: req.user.id }, 'deleteUserCascade failed');
    return res.status(500).json({ error: 'Could not delete account. Please email support.' });
  }

  // The session row is gone via cascade, but the browser still has the
  // signed cookie — clear it so the next request hits the auth gate.
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });

  log.info(
    { userId: req.user.id, email: req.user.email, deleted: result },
    'User account deleted',
  );

  return res.status(200).json({ ok: true, deleted: result });
}

// Re-export for tests that need the underlying session helper.
export { deleteSession };
