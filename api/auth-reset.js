// /api/auth/reset — password-reset flow.
//
//   GET  /api/auth/reset?token=…   → renders the "set new password" form.
//                                    The token is NOT consumed here, so
//                                    Gmail Safe Links / Outlook Defender
//                                    can pre-fetch the URL without burning
//                                    it. The real teacher submits the form.
//
//   POST /api/auth/reset { token, password }
//                                  → consumes the token, hashes the new
//                                    password, replaces password_hash,
//                                    deletes every existing session for
//                                    that user (so a stolen device cookie
//                                    is invalidated), mints a fresh
//                                    session and redirects to /app.
//
// The same form is also the "set my initial password" path for teachers
// whose accounts pre-date the password feature — same DB write either way.

import { logger as defaultLogger } from '../lib/logger.js';
import {
  peekMagicLink, consumeMagicLink, setUserPasswordHash,
  deleteAllSessionsForUser, markEmailVerified, createSession,
  signValue, cookieOptions, COOKIE_NAME,
} from '../lib/auth.js';
import { hashPassword, validatePassword, MIN_PASSWORD_LENGTH } from '../lib/password.js';

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
.sub{font-size:13px;line-height:1.6;color:#5d5d58;margin:0 0 18px;}
.email{background:#f4f1eb;border:1px solid #e4e2da;border-radius:6px;padding:10px 14px;font-size:13px;color:#1a1a18;margin:0 0 16px;word-break:break-all;}
label{display:block;font-size:11px;font-weight:700;color:#5d5d58;text-transform:uppercase;letter-spacing:.4px;margin:14px 0 5px;}
input[type=password]{width:100%;padding:10px 12px;border:1.5px solid #d3d1c7;border-radius:8px;font-size:14px;font-family:inherit;color:#1a1a18;background:#f8f7f3;box-sizing:border-box;}
input[type=password]:focus{outline:none;border-color:#1D9E75;}
button,.btn{display:inline-block;padding:11px 22px;background:#085041;color:#fff;border:none;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;}
button:hover,.btn:hover{background:#0F6E56;}
button:disabled{opacity:0.6;cursor:wait;}
button.full{width:100%;margin-top:16px;}
p.note{font-size:12px;color:#7a7a75;line-height:1.5;margin-top:14px;}
.err{background:#FAEAEA;border:1px solid #E8B8B8;color:#8C2222;border-radius:8px;padding:10px 14px;font-size:13px;margin:12px 0;}
</style>
</head><body><div class="card">
<div class="logo">The Resource Room</div>
${bodyHtml}
</div></body></html>`;
}

function resetForm({ token, email, error }) {
  return page({
    title: 'Reset password — The Resource Room',
    bodyHtml: `
<h1>Set a new password</h1>
<p class="sub">For your account:</p>
<div class="email">${safe(email)}</div>
${error ? `<div class="err">${safe(error)}</div>` : ''}
<form method="POST" action="/api/auth/reset" style="margin:0;">
  <input type="hidden" name="token" value="${safe(token)}">
  <label for="pw">New password</label>
  <input id="pw" type="password" name="password" required minlength="${MIN_PASSWORD_LENGTH}" autocomplete="new-password" autofocus>
  <label for="pw2">Confirm password</label>
  <input id="pw2" type="password" name="confirm" required minlength="${MIN_PASSWORD_LENGTH}" autocomplete="new-password">
  <button class="full" type="submit" id="reset-btn">Save password</button>
</form>
<p class="note">Must be at least ${MIN_PASSWORD_LENGTH} characters. After saving, you'll be signed in on this device — every other device will be signed out.</p>
<script>
document.querySelector('form').addEventListener('submit', (e) => {
  const pw = document.getElementById('pw').value;
  const pw2 = document.getElementById('pw2').value;
  if (pw !== pw2){ e.preventDefault(); alert('Passwords do not match.'); return; }
  document.getElementById('reset-btn').disabled = true;
  document.getElementById('reset-btn').textContent = 'Saving…';
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
      message: 'The reset link is malformed. Please request a new one.',
    }));
  }

  let info;
  try {
    info = peekMagicLink(token, { expectedPurpose: 'reset' });
  } catch (err) {
    log.info({ err: err?.message }, 'peekMagicLink (reset) rejected token');
    return res.status(400).type('html').send(errorPage({
      title: 'Reset link invalid',
      message: err?.message || 'This reset link is no longer valid.',
      hint: 'Request a new password-reset link from the sign-in page.',
    }));
  }

  return res.status(200).type('html').send(resetForm({ token, email: info.email }));
}

async function handlePost(req, res, log) {
  const token = String(req.body?.token || req.query?.token || '').trim();
  const password = String(req.body?.password || '');

  if (!token || !TOKEN_RE.test(token)) {
    return res.status(400).type('html').send(errorPage({
      title: 'Invalid link',
      message: 'The reset link is malformed. Please request a new one.',
    }));
  }
  try {
    validatePassword(password);
  } catch (err) {
    // Re-render the form with the error rather than sending a dead-end page.
    let info;
    try { info = peekMagicLink(token, { expectedPurpose: 'reset' }); }
    catch { /* token already invalid — fall through */ }
    if (info) {
      return res.status(400).type('html').send(resetForm({
        token, email: info.email, error: err.message,
      }));
    }
    return res.status(400).type('html').send(errorPage({
      title: 'Reset link invalid',
      message: 'Please request a new password-reset link.',
    }));
  }

  let user;
  try {
    ({ user } = consumeMagicLink(token, { expectedPurpose: 'reset' }));
  } catch (err) {
    log.info({ err: err?.message }, 'consumeMagicLink (reset) rejected token');
    return res.status(400).type('html').send(errorPage({
      title: 'Reset failed',
      message: err?.message || 'Reset link is invalid.',
      hint: 'Request a fresh password-reset link from the sign-in page.',
    }));
  }

  let hash;
  try {
    hash = await hashPassword(password);
  } catch (err) {
    return res.status(400).type('html').send(errorPage({
      title: 'Could not save password',
      message: err.message || 'Try a different password.',
    }));
  }

  setUserPasswordHash(user.id, hash);
  // A successful password reset proves the teacher controls the inbox,
  // which is exactly what the verify flow checks. Mark the email as
  // verified at the same time (idempotent; only sets if currently null).
  markEmailVerified(user.id);
  // Drop every existing session — if the reset was triggered because of
  // a stolen cookie, that cookie shouldn't keep working.
  deleteAllSessionsForUser(user.id);

  // Sign the teacher in on this device.
  const session = createSession(user.id);
  res.cookie(COOKIE_NAME, signValue(session.id), cookieOptions());
  log.info({ userId: user.id }, 'Password reset and session minted');
  return res.redirect(302, '/app');
}
