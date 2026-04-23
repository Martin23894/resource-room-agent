// Pluggable email provider.
//
// Two drivers:
//   "console" — logs the email body to the pino logger (dev default).
//               Teachers click the magic link from the terminal.
//   "resend"  — sends via Resend's HTTP API (production).
//
// Add more drivers (postmark, ses, smtp) by extending sendEmail() with
// another branch. The provider is picked per-request from
// process.env.EMAIL_PROVIDER so tests can flip it without rebooting.

import { Resend } from 'resend';

import { logger as defaultLogger } from './logger.js';

// Constructed with a hex-escaped @ so the sandbox's Cloudflare-style email
// obfuscation pass doesn't rewrite the literal at save-time. The actual
// runtime string is the plain "The Resource Room <onboarding@resend.dev>".
const DEFAULT_FROM = 'The Resource Room <onboarding\x40resend.dev>';

let resendClient = null;
function getResend() {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('EMAIL_PROVIDER=resend but RESEND_API_KEY is not set');
  resendClient = new Resend(key);
  return resendClient;
}

// Exposed for tests.
export function resetResendClient() { resendClient = null; }

/**
 * Send a transactional email. Resolves on success; throws on provider error.
 *
 * @param {object} args
 * @param {string} args.to       Recipient address (already validated upstream).
 * @param {string} args.subject
 * @param {string} [args.text]   Plain-text body (recommended).
 * @param {string} [args.html]   HTML body (optional).
 * @param {object} [args.logger] Logger override for tests.
 */
export async function sendEmail({ to, subject, text, html, logger = defaultLogger } = {}) {
  const provider = (process.env.EMAIL_PROVIDER || 'console').toLowerCase();
  const from = process.env.EMAIL_FROM || DEFAULT_FROM;

  if (!to || !subject || (!text && !html)) {
    throw new Error('sendEmail requires { to, subject, text|html }');
  }

  if (provider === 'console') {
    // Dev driver — logs instead of sending so the magic link is visible in
    // the server logs and `node server.js` output.
    logger.info({ to, subject, from, body: text || html }, '── Email (console driver) ──');
    return { id: 'console-' + Date.now() };
  }

  if (provider === 'resend') {
    const client = getResend();
    const { data, error } = await client.emails.send({ from, to, subject, text, html });
    if (error) throw new Error('Resend API error: ' + (error.message || JSON.stringify(error)));
    return data;
  }

  if (provider === 'disabled') {
    // Explicit no-op — useful during tests or demos where we don't want
    // email attempts to fail loudly but also don't want anything sent.
    logger.warn({ to, subject }, 'Email provider is "disabled" — dropping message');
    return { id: 'disabled-' + Date.now() };
  }

  throw new Error('Unknown EMAIL_PROVIDER: ' + provider);
}

/**
 * Basic email validation. Not RFC 5322 rigorous — just good enough to reject
 * obvious junk before we write to the DB and try to send.
 */
export function looksLikeEmail(s) {
  if (typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}
