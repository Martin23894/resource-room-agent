// Serves the merged CAPS ATP database to the frontend.
// Rarely changes, so we cache aggressively; browsers should only refetch when
// the server restarts (ETag built from startup time).

import { ATP_RAW } from '../lib/atp.js';

const SERIALISED = JSON.stringify(ATP_RAW);
const ETAG = '"atp-' + Date.now().toString(36) + '"';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (req.headers['if-none-match'] === ETAG) {
    res.setHeader('ETag', ETAG);
    return res.status(304).end();
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('ETag', ETAG);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(200).send(SERIALISED);
}
