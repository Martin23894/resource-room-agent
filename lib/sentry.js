// Server-side error tracking via Sentry.
//
// No-op when SENTRY_DSN is unset — the helper functions still exist so
// callers can capture exceptions unconditionally without checking. That
// keeps call sites clean (`captureException(err)` in a catch block is
// fine in dev and in prod).
//
// We don't enable performance / tracing here — just plain error capture.
// Tracing is high-volume and not free; revisit when there's a specific
// performance question to answer.

import * as Sentry from '@sentry/node';

import { logger as defaultLogger } from './logger.js';

let initialised = false;

/** Initialise Sentry if SENTRY_DSN is set. Safe to call multiple times. */
export function initSentry({ logger = defaultLogger } = {}) {
  if (initialised) return false;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    // Sample everything in dev, scale back in prod via env var if needed.
    tracesSampleRate: 0,
    // Strip noisy or sensitive bits before they leave the box.
    beforeSend(event) {
      // Drop common path-not-found / 405 noise — those are caller bugs,
      // not server bugs, and we already log them via pino-http.
      if (event.exception?.values?.some((e) => /Not found|Method not allowed/i.test(e.value || ''))) {
        return null;
      }
      // Defensive scrub — never let an `Authorization` header or session
      // cookie out, even if a future change accidentally attaches one.
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      return event;
    },
  });

  initialised = true;
  logger.info({ environment: process.env.NODE_ENV || 'development' }, 'Sentry initialised');
  return true;
}

/** True iff Sentry was successfully initialised. */
export function isSentryEnabled() {
  return initialised;
}

/**
 * Express error middleware. Reports the error to Sentry (if enabled) then
 * defers to Express's default 500 handling. Mount AFTER all routes.
 */
export function sentryErrorHandler(err, req, _res, next) {
  if (initialised) {
    Sentry.withScope((scope) => {
      if (req?.user?.id) scope.setUser({ id: req.user.id, email: req.user.email });
      if (req?.id) scope.setTag('request_id', req.id);
      Sentry.captureException(err);
    });
  }
  next(err);
}

/** Manual capture for places that swallow errors locally (e.g. best-effort
 *  email sends). Pure no-op when Sentry isn't initialised. */
export function captureException(err, context = {}) {
  if (!initialised) return;
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) {
      scope.setExtra(key, value);
    }
    Sentry.captureException(err);
  });
}

// Test-only — flushes any in-flight events and resets the gate.
export async function __resetSentry() {
  if (initialised) {
    try { await Sentry.close(2000); } catch { /* ignore */ }
  }
  initialised = false;
}
