// GET /api/auth/verify?token=… — consume a magic link, set a session cookie,
// and redirect to the app root. Invalid / expired / already-used tokens get
// a friendly HTML page instead of JSON because this endpoint is loaded
// directly from the link in the email (browser, not fetch).

import { logger as defaultLogger } from '../lib/logger.js';
import { consumeMagicLink, createSession, signValue, cookieOptions, COOKIE_NAME } from '../lib/auth.js';

function errorPage(title, message) {
  const safe = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safe(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#f8f7f3;color:#1a1a18;margin:0;padding:40px 20px;display:flex;justify-content:center;}
.card{background:#fff;border:1px solid #e4e2da;border-radius:12px;padding:32px 28px;max-width:440px;width:100%;}
h1{font-size:20px;margin:0 0 12px;color:#085041;}
p{font-size:14px;line-height:1.6;color:#3d3d3a;}
a{display:inline-block;margin-top:12px;padding:10px 18px;background:#085041;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;}
a:hover{background:#0F6E56;}</style>
</head><body><div class="card">
<h1>${safe(title)}</h1><p>${safe(message)}</p>
<a href="/">Back to sign-in</a>
</div></body></html>`;
}

export default async function handler(req, res) {
  const log = req.log || defaultLogger;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = String(req.query?.token || '').trim();
  if (!token || !/^[0-9a-f]{16,128}$/i.test(token)) {
    return res.status(400).type('html').send(errorPage('Invalid link', 'The sign-in link is malformed. Please request a new one.'));
  }

  let user;
  try {
    user = consumeMagicLink(token);
  } catch (err) {
    log.info({ err: err?.message }, 'consumeMagicLink rejected token');
    const msg = err?.message || 'Sign-in link is invalid';
    return res.status(400).type('html').send(errorPage('Sign-in failed', msg));
  }

  const session = createSession(user.id);
  res.cookie(COOKIE_NAME, signValue(session.id), cookieOptions());
  log.info({ userId: user.id, email: user.email }, 'User signed in');
  return res.redirect(302, '/');
}
