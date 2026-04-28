import express from 'express';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

import { logger } from './lib/logger.js';
import { openCache } from './lib/cache.js';
import { parseSession, requireAuth } from './lib/auth.js';

// Import route handlers
import generateHandler from './api/generate.js';
import refineHandler from './api/refine.js';
import coverHandler from './api/cover.js';
import testHandler from './api/test.js';
import atpHandler from './api/atp.js';
import rebuildDocxHandler from './api/rebuild-docx.js';
import authRequestHandler from './api/auth-request.js';
import authVerifyHandler from './api/auth-verify.js';
import authLogoutHandler from './api/auth-logout.js';
import authMeHandler from './api/auth-me.js';
import userSettingsHandler from './api/user-settings.js';
import userHistoryHandler from './api/user-history.js';
import billingCheckoutHandler from './api/billing-checkout.js';
import billingPortalHandler from './api/billing-portal.js';
import stripeWebhookHandler from './api/stripe-webhook.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Railway terminates TLS at its proxy; trust one hop so rate limits see the real client IP.
app.set('trust proxy', 1);

// ─── Structured access logs + per-request correlation id ────
app.use(pinoHttp({
  logger,
  genReqId: (req) => req.headers['x-request-id'] || randomUUID(),
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
}));

// ─── Stripe webhook — MUST use raw body, so it goes before express.json() ──
// Stripe verifies the signature against the exact bytes it sent, so any
// middleware that re-serialises the body would break verification.
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  stripeWebhookHandler,
);

// ─── Middleware ───────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// Request timeout — prevents Railway hanging on slow Anthropic responses
app.use((req, res, next) => {
  res.setTimeout(270000, () => {
    res.status(503).json({ error: 'Request timed out. Please try again.' });
  });
  next();
});

// CORS — only allow configured origins. Same-origin requests (no Origin header)
// pass through without CORS headers, which is correct.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// ─── Rate limiters — stacked (minute / hour / day) ──────────
// Each /api/generate request triggers one Anthropic tool call. Limits are
// kept tight against accidental burst abuse, not pipeline cost.
// All Claude-backed endpoints are auth-gated, so req.user is always set by
// the time we hit these limiters. We key on the user id — a signed-in teacher
// sharing a school network IP with colleagues gets their own bucket.
const jsonMessage = (msg) => (req, res) => res.status(429).json({ error: msg });

const userKey = (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`);

const perMinute = rateLimit({
  windowMs: 60 * 1000, max: 10,
  keyGenerator: userKey,
  standardHeaders: true, legacyHeaders: false,
  handler: jsonMessage('Too many requests. Please wait a minute and try again.'),
});
const perHour = rateLimit({
  windowMs: 60 * 60 * 1000, max: 50,
  keyGenerator: userKey,
  standardHeaders: true, legacyHeaders: false,
  handler: jsonMessage('Hourly limit reached. Please try again later.'),
});
const perDay = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, max: 200,
  keyGenerator: userKey,
  standardHeaders: true, legacyHeaders: false,
  handler: jsonMessage('Daily limit reached. Please try again tomorrow.'),
});

const apiLimiters = [perMinute, perHour, perDay];

// Tight bucket for /api/auth/request so a hostile actor can't spam
// someone's inbox with magic links: 3/min, 10/hr per IP.
const authRequestLimiters = [
  rateLimit({
    windowMs: 60 * 1000, max: 3,
    standardHeaders: true, legacyHeaders: false,
    handler: jsonMessage('Too many sign-in attempts. Wait a minute.'),
  }),
  rateLimit({
    windowMs: 60 * 60 * 1000, max: 10,
    standardHeaders: true, legacyHeaders: false,
    handler: jsonMessage('Too many sign-in attempts this hour. Try again later.'),
  }),
];

// ─── Attach session (anonymous requests get req.user = null) ─
app.use(parseSession);

// ─── Serve static frontend ──────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── /vendor/* — self-hosted Word preview libs ──────────────
// docx-preview and JSZip are served from this origin (not a CDN) so
// teachers on corporate/school networks or behind strict firewalls can
// still use the Word preview. The npm versions are pinned in package.json.
//
// Implementation note: docx-preview's "exports" field forbids both
// require.resolve('docx-preview/dist/…') AND require.resolve('docx-preview
// /package.json'), so we go straight to the node_modules path. Railway
// (Nixpacks) installs to ./node_modules just like a local dev install.
const NODE_MODULES = path.join(__dirname, 'node_modules');
const VENDOR_FILES = {
  '/vendor/jszip.min.js':    path.join(NODE_MODULES, 'jszip',        'dist', 'jszip.min.js'),
  '/vendor/docx-preview.js': path.join(NODE_MODULES, 'docx-preview', 'dist', 'docx-preview.js'),
};
for (const [route, filePath] of Object.entries(VENDOR_FILES)) {
  app.get(route, (_req, res) => {
    res.type('application/javascript; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.sendFile(filePath);
  });
}

// ─── Auth routes (no requireAuth — these ARE the sign-in flow) ──
app.post('/api/auth/request', authRequestLimiters, authRequestHandler);
// Magic-link verify is two-step: GET shows the confirm page, POST consumes
// the token. The POST accepts both form-urlencoded (from the confirm page's
// <form>) and JSON (programmatic callers / tests) so we mount a dedicated
// urlencoded parser for this route alongside the global JSON one.
app.get('/api/auth/verify', authVerifyHandler);
app.post('/api/auth/verify', express.urlencoded({ extended: false, limit: '4kb' }), authVerifyHandler);
app.post('/api/auth/logout', authLogoutHandler);
app.get('/api/auth/me', authMeHandler);

// ─── API Routes — Claude-backed endpoints require sign-in ───
app.post('/api/generate', requireAuth, apiLimiters, generateHandler);
app.post('/api/refine', requireAuth, apiLimiters, refineHandler);
app.post('/api/cover', requireAuth, apiLimiters, coverHandler);
// Rebuild a DOCX from edited preview text — no Claude calls, only the
// docx-builder runs. Still auth-gated so anonymous users can't rebuild
// arbitrary content either.
app.post('/api/rebuild-docx', requireAuth, apiLimiters, rebuildDocxHandler);
app.get('/api/atp', atpHandler);
app.get('/api/test', testHandler);

// ─── Per-user settings + history (Phase 2.4b) ───────────────
// Cheap CRUD on the local SQLite DB — no Claude calls — but still
// auth-gated so the user can only see their own rows.
app.get('/api/user/settings', requireAuth, userSettingsHandler);
app.put('/api/user/settings', requireAuth, userSettingsHandler);
app.get('/api/user/history', requireAuth, userHistoryHandler);
app.post('/api/user/history', requireAuth, userHistoryHandler);
app.delete('/api/user/history', requireAuth, userHistoryHandler);
app.delete('/api/user/history/:id', requireAuth, userHistoryHandler);

// ─── Billing (Phase 2.4c) ───────────────────────────────────
// Checkout + portal return redirect URLs for the browser. The webhook
// above is the source of truth for subscription state; these two just
// open Stripe-hosted flows.
app.post('/api/billing/checkout', requireAuth, billingCheckoutHandler);
app.post('/api/billing/portal', requireAuth, billingPortalHandler);

// ─── Health check (Railway uses this) ───────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Unknown API routes → 404 (before SPA catch-all) ────────
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Catch-all → serve index.html (SPA fallback) ───────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ──────────────────────────────────────────────────
// Open the result cache up-front so any startup pruning happens before
// the first request arrives.
try { openCache({ logger }); }
catch (err) { logger.warn({ err: err?.message || err }, 'Cache init failed — generate endpoint will run without caching'); }

app.listen(PORT, () => {
  logger.info(
    {
      port: PORT,
      allowedOrigins: allowedOrigins.length ? allowedOrigins : 'same-origin only',
    },
    'Resource Room server ready',
  );
});
