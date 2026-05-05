// Operational health checks. Each check returns
//   { ok: boolean, info: string, details?: object }
// so the /health/status endpoint can render a uniform status page.
//
// "ok=true" means "this dependency is configured and reachable". For
// items that are optional in development (Sentry, Plausible, branded
// EMAIL_FROM), a missing-config check returns ok=false with a helpful
// message rather than throwing — the status endpoint shows it as a
// "needs attention" item rather than a hard failure.

import { getDb } from './cache.js';
import { isSentryEnabled } from './sentry.js';
import { resolveFrom, isUsingSandbox } from './email.js';

/** Database — round-trip a trivial SELECT to confirm SQLite is up. */
export function checkDatabase() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT 1 AS ok').get();
    return {
      ok: row?.ok === 1,
      info: row?.ok === 1 ? 'SQLite reachable' : 'Unexpected DB response',
    };
  } catch (err) {
    return { ok: false, info: 'DB error: ' + (err?.message || String(err)) };
  }
}

/** Anthropic — config-only check; we don't actually round-trip the API
 *  here because that costs money and slows the endpoint. Returns ok=true
 *  if the key is present and looks like an Anthropic key. */
export function checkAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, info: 'ANTHROPIC_API_KEY is not set — generation will fail' };
  if (!key.startsWith('sk-ant-')) {
    return { ok: false, info: "ANTHROPIC_API_KEY doesn't look like an Anthropic key" };
  }
  return { ok: true, info: 'Key configured' };
}

/** Email — combines provider, key, and From-domain checks. ok=true means
 *  the deploy is set up to actually deliver mail (not just the sandbox). */
export function checkEmail() {
  const provider = (process.env.EMAIL_PROVIDER || 'console').toLowerCase();
  if (provider === 'console') {
    return {
      ok: false,
      info: 'EMAIL_PROVIDER=console — emails are only logged, not sent. Switch to "resend" for production.',
      details: { provider },
    };
  }
  if (provider === 'disabled') {
    return { ok: false, info: 'EMAIL_PROVIDER=disabled — emails are dropped silently', details: { provider } };
  }
  if (provider !== 'resend') {
    return { ok: false, info: 'Unknown EMAIL_PROVIDER value', details: { provider } };
  }
  // Resend mode — must have key + branded From
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, info: 'EMAIL_PROVIDER=resend but RESEND_API_KEY is not set', details: { provider } };
  }
  const from = resolveFrom();
  if (isUsingSandbox(from)) {
    return {
      ok: false,
      info: 'EMAIL_FROM is unset or pointing at the Resend sandbox — deliverability will be poor',
      details: { provider, from },
    };
  }
  return { ok: true, info: 'Resend configured with a branded sender', details: { provider, from } };
}

/** Sentry — purely "did initSentry actually attach" — same shape as the others. */
export function checkSentry() {
  if (isSentryEnabled()) {
    return { ok: true, info: 'Error tracking enabled' };
  }
  if (process.env.SENTRY_DSN) {
    return { ok: false, info: 'SENTRY_DSN set but initSentry() was not called or failed' };
  }
  return {
    ok: false,
    info: 'SENTRY_DSN is not set — server-side errors are logged but not aggregated',
  };
}

/** Auth secret — must be set in production for cookies to survive restarts. */
export function checkAuthSecret() {
  const env = process.env.NODE_ENV;
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    if (env === 'production') {
      return { ok: false, info: 'AUTH_SECRET missing or too short (≥32 chars required in prod)' };
    }
    return { ok: false, info: 'AUTH_SECRET not set — sessions will not survive a restart (dev only)' };
  }
  return { ok: true, info: 'Cookie-signing secret configured' };
}

/** Run every check and return an aggregated payload. */
export function runAllChecks() {
  const checks = {
    database: checkDatabase(),
    auth: checkAuthSecret(),
    anthropic: checkAnthropic(),
    email: checkEmail(),
    sentry: checkSentry(),
  };
  const allOk = Object.values(checks).every((c) => c.ok);
  return {
    status: allOk ? 'ok' : 'attention',
    timestamp: new Date().toISOString(),
    checks,
  };
}
