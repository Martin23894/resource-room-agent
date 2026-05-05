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
//
// Production deliverability:
// - EMAIL_FROM must be on a domain you've verified in Resend with valid
//   SPF + DKIM + DMARC records. Without that, deliverability tanks
//   (Gmail/Outlook will silently spam-fold or reject).
// - EMAIL_REPLY_TO is optional but recommended — it lets teachers reply
//   to your support inbox directly. Falls back to EMAIL_FROM.

import { Resend } from 'resend';

import { logger as defaultLogger } from './logger.js';

// Constructed with a hex-escaped @ so the sandbox's Cloudflare-style email
// obfuscation pass doesn't rewrite the literal at save-time. The actual
// runtime string is the plain "The Resource Room <onboarding@resend.dev>".
const SANDBOX_FROM = 'The Resource Room <onboarding\x40resend.dev>';
// Detected as the Resend sandbox sender. Kept loose so that any of
// "onboarding@resend.dev", "Foo <onboarding@resend.dev>" etc. all match.
const SANDBOX_RE = /onboarding@resend\.dev/i;

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

// One-time gate so the "you're sending from the Resend sandbox" warning
// fires once per process rather than on every send.
let sandboxWarned = false;

/** Resolve the From address — env override → sandbox fallback. */
export function resolveFrom() {
  return process.env.EMAIL_FROM || SANDBOX_FROM;
}

/** True when the resolved From is Resend's shared sandbox sender. */
export function isUsingSandbox(from = resolveFrom()) {
  return SANDBOX_RE.test(from);
}

/**
 * Verify production email config at startup. Logs a single conspicuous
 * warning if EMAIL_PROVIDER=resend but EMAIL_FROM is unset or points at
 * the sandbox sender, since either case will hurt deliverability badly.
 *
 * Pure logging — does NOT throw, so a misconfigured server still boots
 * and the operator can fix it from the warning.
 */
export function checkEmailConfig({ logger = defaultLogger } = {}) {
  const provider = (process.env.EMAIL_PROVIDER || 'console').toLowerCase();
  if (provider !== 'resend') return;
  const from = resolveFrom();
  if (!process.env.RESEND_API_KEY) {
    logger.warn(
      'EMAIL_PROVIDER=resend but RESEND_API_KEY is not set — sends will fail. Set the key, or switch EMAIL_PROVIDER to "console" / "disabled".',
    );
  }
  if (isUsingSandbox(from)) {
    logger.warn(
      { from },
      'EMAIL_FROM is unset or pointing at the Resend sandbox sender. Verify your own domain in Resend and set EMAIL_FROM=… before going to production — the sandbox is rate-limited and gets aggressively spam-foldered.',
    );
  }
}

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
  const from = resolveFrom();
  // Reply-To: if the operator set EMAIL_REPLY_TO, use that — otherwise
  // fall back to From so teachers can hit reply and land somewhere sensible.
  const replyTo = process.env.EMAIL_REPLY_TO || from;

  if (!to || !subject || (!text && !html)) {
    throw new Error('sendEmail requires { to, subject, text|html }');
  }

  if (provider === 'console') {
    // Dev driver — logs instead of sending so the magic link is visible in
    // the server logs and `node server.js` output.
    logger.info({ to, subject, from, replyTo, body: text || html }, '── Email (console driver) ──');
    return { id: 'console-' + Date.now() };
  }

  if (provider === 'resend') {
    if (!sandboxWarned && isUsingSandbox(from)) {
      logger.warn(
        { from },
        'Sending via the Resend sandbox sender — deliverability will be poor. Set EMAIL_FROM to a verified domain.',
      );
      sandboxWarned = true;
    }
    const client = getResend();
    // NOTE on tracking: Resend's SDK v4 does NOT accept click_tracking /
    // open_tracking on the send endpoint — those flags are domain-level
    // only, set in the Resend dashboard under Domains → resourceroom.co.za
    // → Tracking. Keep those toggles OFF for transactional auth email:
    //
    // 1. Click tracking rewrites links through a Resend redirect wrapper —
    //    email scanners (Gmail Safe Links, Outlook Defender) pre-fetch the
    //    wrapped URL and consume our magic-link token before the teacher
    //    clicks it.
    // 2. The tracking-domain hop sometimes trips Google Safe Browsing
    //    classifiers on fresh sending domains.
    //
    // The tag below marks the mail as transactional so we can later add
    // marketing sends (which MAY have tracking on) without cross-wiring.
    // The SDK uses camelCase `replyTo` and maps it to `reply_to` on the
    // wire — passing snake_case here gets silently dropped (same allowlist
    // behaviour that drops click_tracking / open_tracking).
    const { data, error } = await client.emails.send({
      from, to, subject, text, html,
      replyTo,
      tags: [{ name: 'category', value: 'transactional' }],
    });
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

// Test-only — reset the once-per-process sandbox warning gate.
export function __resetSandboxWarning() { sandboxWarned = false; }

