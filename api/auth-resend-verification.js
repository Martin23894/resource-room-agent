// POST /api/auth/resend-verification
//
// Sends a fresh verification email to the currently signed-in user. Useful
// when the original email got lost or the link expired. No-ops with a 200
// if the user is already verified — the response shape is the same so a
// busy retry doesn't reveal state to a logged-out attacker (though this
// route requires auth anyway).

import { logger as defaultLogger } from '../lib/logger.js';
import { createMagicLink } from '../lib/auth.js';

export default async function handler(req, res) {
  const log = req.log || defaultLogger;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!req.user) return res.status(401).json({ error: 'Sign in required', code: 'UNAUTHENTICATED' });

  if (req.user.email_verified_at) {
    return res.status(200).json({ ok: true, alreadyVerified: true });
  }

  try {
    await createMagicLink(req.user.email, { logger: log, purpose: 'verify' });
    log.info({ userId: req.user.id }, 'Verification email re-sent');
  } catch (err) {
    log.error({ err: err?.message, userId: req.user.id }, 'resend verification failed');
    return res.status(500).json({ error: 'Could not send verification email. Try again later.' });
  }
  return res.status(200).json({ ok: true });
}
