// POST /api/auth/forgot — send a "reset your password" email.
//
// Always returns 200 {ok:true}, regardless of whether the email is
// registered. This avoids leaking which addresses have accounts.
//
// The link the email contains points at GET /api/auth/reset?token=… (a
// password-reset form). The same flow is used by teachers who have a
// magic-link-only account and want to attach a password for the first
// time — the form just sets password_hash whether or not one existed.

import { logger as defaultLogger } from '../lib/logger.js';
import { createMagicLink, getUserByEmail } from '../lib/auth.js';
import { looksLikeEmail } from '../lib/email.js';

export default async function handler(req, res) {
  const log = req.log || defaultLogger;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!looksLikeEmail(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  // Only send a reset email if the account actually exists, otherwise
  // we'd flood arbitrary inboxes. We still return 200 in either case so
  // the response shape doesn't reveal which is which.
  const user = getUserByEmail(email);
  if (user) {
    try {
      await createMagicLink(email, { logger: log, purpose: 'reset' });
      log.info({ email }, 'Password-reset link sent');
    } catch (err) {
      log.error({ err: err?.message, email }, 'createMagicLink (reset) failed');
    }
  } else {
    log.info({ email }, 'forgot: no account for email — silently ignored');
  }

  return res.status(200).json({ ok: true });
}
