// /api/auth/verify — email-verification flow.
//
//   GET  /api/auth/verify?token=X   → renders a "Confirm your email" page.
//                                      The token is NOT consumed here, so
//                                      Gmail Safe Links / Outlook Defender /
//                                      Chrome prefetch can all GET this URL
//                                      harmlessly. The teacher clicks the
//                                      button on the page to actually verify.
//
//   POST /api/auth/verify   { token } → consumes the token, marks the user's
//                                      email as verified and (if not already
//                                      signed in) mints a session, then 302s
//                                      to /app.
//
// Tokens with purpose='verify' confirm a freshly-created account's email.
// Legacy magic-link sign-in tokens (purpose='signin') still work the same
// way for backwards compatibility — they sign in any matching user without
// touching email_verified_at.
//
// Invalid / expired / already-used tokens get a friendly HTML page rather
// than a JSON body because this endpoint is loaded directly from the email.

import { logger as defaultLogger } from '../lib/logger.js';
import {
  peekMagicLink, consumeMagicLink, markEmailVerified, createSession,
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

function confirmPage({ token, email, purpose }) {
  const isVerify = purpose === 'verify';
  const heading = isVerify ? 'Confirm your email' : 'Welcome back';
  const sub = isVerify
    ? 'Click below to confirm this is your email address.'
    : 'Click below to finish signing in to The Resource Room.';
  const buttonText = isVerify ? 'Confirm email' : 'Sign in';
  return page({
    title: `${heading} — The Resource Room`,
    bodyHtml: `
<h1>${heading}</h1>
<p class="sub">${sub}</p>
<div class="email">${safe(email)}</div>
<form method="POST" action="/api/auth/verify" style="margin:0;">
  <input type="hidden" name="token" value="${safe(token)}">
  <button type="submit" id="confirm-btn">${buttonText}</button>
</form>
<p class="note">Not you? Close this tab — this link will expire automatically.</p>
<script>
document.getElementById('confirm-btn').focus();
document.querySelector('form').addEventListener('submit', () => {
  const b = document.getElementById('confirm-btn');
  b.disabled = true; b.textContent = '${isVerify ? 'Confirming…' : 'Signing in…'}';
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

function handleGet(req, res, log) {
  const token = String(req.query?.token || '').trim();
  if (!token || !TOKEN_RE.test(token)) {
    return res.status(400).type('html').send(errorPage({
      title: 'Invalid link',
      message: 'The verification link is malformed. Please request a new one.',
    }));
  }

  let info;
  try {
    info = peekMagicLink(token);
  } catch (err) {
    log.info({ err: err?.message }, 'peekMagicLink rejected token');
    return res.status(400).type('html').send(errorPage({
      title: 'Link invalid',
      message: err?.message || 'This link is no longer valid.',
      hint: 'If this keeps happening after your first click, your email provider may be scanning links before you see them. Request a fresh link and click the button on the confirmation page.',
    }));
  }

  // The verify endpoint accepts 'verify' (post-signup) and 'signin' (legacy
  // magic-link). 'reset' tokens belong on /api/auth/reset and are rejected
  // here so a stolen reset link can't be confirmed against the wrong route.
  if (info.purpose && info.purpose !== 'verify' && info.purpose !== 'signin') {
    return res.status(400).type('html').send(errorPage({
      title: 'Wrong link type',
      message: 'This link is for a different action.',
      hint: 'Use the link from the password-reset email instead.',
    }));
  }

  // Already signed in? For 'verify' tokens, still confirm the email so the
  // banner clears; for 'signin' tokens, just go home.
  if (req.user && info.purpose !== 'verify') return res.redirect(302, '/app');

  return res.status(200).type('html').send(confirmPage({ token, email: info.email, purpose: info.purpose || 'signin' }));
}

function handlePost(req, res, log) {
  const token = String(req.body?.token || req.query?.token || '').trim();
  if (!token || !TOKEN_RE.test(token)) {
    return res.status(400).type('html').send(errorPage({
      title: 'Invalid link',
      message: 'The verification link is malformed. Please request a new one.',
    }));
  }

  let user, purpose;
  try {
    ({ user, purpose } = consumeMagicLink(token));
  } catch (err) {
    log.info({ err: err?.message }, 'consumeMagicLink rejected token');
    return res.status(400).type('html').send(errorPage({
      title: 'Verification failed',
      message: err?.message || 'This link is invalid.',
      hint: 'Request a fresh link from the sign-in page.',
    }));
  }

  if (purpose !== 'verify' && purpose !== 'signin') {
    return res.status(400).type('html').send(errorPage({
      title: 'Wrong link type',
      message: 'This link is for a different action.',
    }));
  }

  if (purpose === 'verify') {
    markEmailVerified(user.id);
  }

  // If the teacher already has a session (just signed up + clicked verify
  // from the same browser), keep it. Otherwise mint one so they don't have
  // to re-enter credentials right after verifying.
  if (!req.user) {
    const session = createSession(user.id);
    res.cookie(COOKIE_NAME, signValue(session.id), cookieOptions());
  }
  log.info({ userId: user.id, email: user.email, purpose }, 'auth/verify consumed token');
  return res.redirect(302, '/app');
}
