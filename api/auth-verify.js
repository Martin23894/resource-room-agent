// /api/auth/verify — two-step verification to defeat email-scanner prefetch.
//
//   GET  /api/auth/verify?token=X   → renders a "Confirm sign-in" page.
//                                      The token is NOT consumed here, so
//                                      Gmail Safe Links, Outlook Defender,
//                                      Chrome link prefetch and Resend's
//                                      click tracker can all GET this URL
//                                      harmlessly — the real user clicks the
//                                      button on the page to actually sign in.
//
//   POST /api/auth/verify   { token } → consumes the token, mints a session,
//                                      sets the HMAC-signed cookie and 302s
//                                      to /. Scanners don't POST, so this
//                                      endpoint is only reachable when a
//                                      real browser submits the confirm form.
//
// Invalid / expired / already-used tokens get a friendly HTML page rather
// than a JSON body because this endpoint is loaded directly from the email.

import { logger as defaultLogger } from '../lib/logger.js';
import {
  peekMagicLink, consumeMagicLink, createSession,
  signValue, cookieOptions, COOKIE_NAME,
} from '../lib/auth.js';

const TOKEN_RE = /^[0-9a-f]{16,128}$/i;

function safe(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function page({ title, bodyHtml }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safe(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8f7f3;color:#1a1a18;margin:0;padding:40px 20px;display:flex;justify-content:center;min-height:100vh;box-sizing:border-box;}
.card{background:#fff;border:1px solid #e4e2da;border-radius:12px;padding:32px 28px;max-width:440px;width:100%;box-shadow:0 2px 12px rgba(0,0,0,0.04);height:fit-content;}
.logo{font-weight:700;color:#085041;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:20px;}
h1{font-size:22px;margin:0 0 8px;color:#085041;}
.sub{font-size:13px;line-height:1.6;color:#5d5d58;margin:0 0 20px;}
.email{background:#f4f1eb;border:1px solid #e4e2da;border-radius:6px;padding:10px 14px;font-size:13px;color:#1a1a18;margin:0 0 20px;word-break:break-all;}
button,.btn{display:inline-block;padding:12px 22px;background:#085041;color:#fff;border:none;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;}
button:hover,.btn:hover{background:#0F6E56;}
button:disabled{opacity:0.6;cursor:wait;}
p.note{font-size:12px;color:#7a7a75;line-height:1.5;margin-top:16px;}
</style>
</head><body><div class="card">
<div class="logo">The Resource Room</div>
${bodyHtml}
</div></body></html>`;
}

function confirmPage({ token, email }) {
  return page({
    title: 'Confirm sign-in — The Resource Room',
    bodyHtml: `
<h1>Welcome back</h1>
<p class="sub">Click below to finish signing in to The Resource Room.</p>
<div class="email">${safe(email)}</div>
<form method="POST" action="/api/auth/verify" style="margin:0;">
  <input type="hidden" name="token" value="${safe(token)}">
  <button type="submit" id="confirm-btn">Sign in</button>
</form>
<p class="note">Not you? Close this tab — this link will expire automatically.</p>
<script>
// Auto-focus the button so <Enter> works immediately, and disable it
// on submit so a double-click can't hit the POST twice.
document.getElementById('confirm-btn').focus();
document.querySelector('form').addEventListener('submit', () => {
  const b = document.getElementById('confirm-btn');
  b.disabled = true; b.textContent = 'Signing in…';
});
</script>`,
  });
}

function errorPage({ title, message, hint }) {
  return page({
    title: safe(title),
    bodyHtml: `
<h1>${safe(title)}</h1>
<p class="sub">${safe(message)}</p>
${hint ? `<p class="note">${safe(hint)}</p>` : ''}
<a class="btn" href="/">Back to home</a>`,
  });
}

export default async function handler(req, res) {
  const log = req.log || defaultLogger;

  if (req.method === 'GET') return handleGet(req, res, log);
  if (req.method === 'POST') return handlePost(req, res, log);
  return res.status(405).json({ error: 'Method not allowed' });
}

// ─── GET — render confirm page, DO NOT consume the token ───
function handleGet(req, res, log) {
  const token = String(req.query?.token || '').trim();
  if (!token || !TOKEN_RE.test(token)) {
    return res.status(400).type('html').send(errorPage({
      title: 'Invalid link',
      message: 'The sign-in link is malformed. Please request a new one.',
    }));
  }

  // If the user already has a valid session (e.g. clicked the email link
  // from a second tab after already signing in), just send them home.
  if (req.user) return res.redirect(302, '/app');

  let info;
  try {
    info = peekMagicLink(token);
  } catch (err) {
    log.info({ err: err?.message }, 'peekMagicLink rejected token');
    return res.status(400).type('html').send(errorPage({
      title: 'Sign-in failed',
      message: err?.message || 'Sign-in link is invalid.',
      hint: 'If this keeps happening after your first click, your email provider may be scanning links before you see them. Request a fresh link and click the Sign in button on the confirmation page.',
    }));
  }

  return res.status(200).type('html').send(confirmPage({ token, email: info.email }));
}

// ─── POST — actually consume the token and sign the user in ───
function handlePost(req, res, log) {
  // Body can be form-urlencoded (from the confirm page <form>) or JSON
  // (from programmatic callers / tests). The route mounts urlencoded + json
  // parsers in server.js; fall back to query string if neither populated
  // req.body.
  const token = String(req.body?.token || req.query?.token || '').trim();
  if (!token || !TOKEN_RE.test(token)) {
    return res.status(400).type('html').send(errorPage({
      title: 'Invalid link',
      message: 'The sign-in link is malformed. Please request a new one.',
    }));
  }

  let user;
  try {
    user = consumeMagicLink(token);
  } catch (err) {
    log.info({ err: err?.message }, 'consumeMagicLink rejected token');
    return res.status(400).type('html').send(errorPage({
      title: 'Sign-in failed',
      message: err?.message || 'Sign-in link is invalid.',
      hint: 'Request a fresh sign-in link from the home page.',
    }));
  }

  const session = createSession(user.id);
  res.cookie(COOKIE_NAME, signValue(session.id), cookieOptions());
  log.info({ userId: user.id, email: user.email }, 'User signed in');
  return res.redirect(302, '/app');
}
