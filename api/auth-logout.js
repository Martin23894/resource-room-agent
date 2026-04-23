// POST /api/auth/logout — delete the session row and clear the cookie.

import { deleteSession, COOKIE_NAME, cookieOptions } from '../lib/auth.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.user?.sessionId) deleteSession(req.user.sessionId);
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  return res.status(200).json({ ok: true });
}
