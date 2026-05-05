// GET /health/status — operational status snapshot.
//
// Auth-gated by `?secret=<HEALTH_STATUS_SECRET>` (or unrestricted if the
// env var is unset, like /api/test). Don't expose this to the open
// internet without a secret — the response shows env-var presence which
// is useful intel for an attacker.

import { runAllChecks } from '../lib/health.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const guard = process.env.HEALTH_STATUS_SECRET;
  if (guard) {
    const provided = String(req.query?.secret || '');
    if (provided !== guard) return res.status(404).json({ error: 'Not found' });
  }

  const result = runAllChecks();
  // Always 200 — the body's "status" field tells you whether anything
  // needs attention. Returning 5xx for "attention" would trip uptime
  // monitors on issues that aren't outages (e.g. EMAIL_FROM unset).
  return res.status(200).json(result);
}
