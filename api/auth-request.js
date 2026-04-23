// POST /api/auth/request — send a magic sign-in link.
//
// Always responds with 200 {ok:true} regardless of whether the email is
// registered, so the endpoint can't be used to enumerate users.

import { logger as defaultLogger } from '../lib/logger.js';
import { createMagicLink } from '../lib/auth.js';
import { looksLikeEmail } from '../lib/email.js';

export default async function handler(req, res) {
  const log = req.log || defaultLogger;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!looksLikeEmail(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  try {
    await createMagicLink(email, { logger: log });
    log.info({ email }, 'Magic link created and email dispatched');
  } catch (err) {
    // We deliberately don't surface the specific failure to the client
    // (avoids leaking whether the email provider is misconfigured vs the
    // address is malformed). Operators see it in logs.
    log.error({ err: err?.message || err, email }, 'createMagicLink failed');
  }

  return res.status(200).json({ ok: true });
}
