import express from 'express';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

import { logger } from './lib/logger.js';
import { openCache } from './lib/cache.js';

// Import route handlers
import generateHandler from './api/generate.js';
import refineHandler from './api/refine.js';
import coverHandler from './api/cover.js';
import testHandler from './api/test.js';
import atpHandler from './api/atp.js';
import rebuildDocxHandler from './api/rebuild-docx.js';

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

// ─── Rate limiters — per-IP, stacked (minute / hour / day) ──
// Each /api/generate request triggers ~10 Anthropic calls, so keep these tight.
const jsonMessage = (msg) => (req, res) => res.status(429).json({ error: msg });

const perMinute = rateLimit({
  windowMs: 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  handler: jsonMessage('Too many requests. Please wait a minute and try again.'),
});
const perHour = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  handler: jsonMessage('Hourly limit reached. Please try again later.'),
});
const perDay = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, max: 100,
  standardHeaders: true, legacyHeaders: false,
  handler: jsonMessage('Daily limit reached. Please try again tomorrow.'),
});

const apiLimiters = [perMinute, perHour, perDay];

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

// ─── API Routes ─────────────────────────────────────────────
app.post('/api/generate', apiLimiters, generateHandler);
app.post('/api/refine', apiLimiters, refineHandler);
app.post('/api/cover', apiLimiters, coverHandler);
// Rebuild a DOCX from edited preview text — no Claude calls, only the
// docx-builder runs. Still behind apiLimiters so a misbehaving client
// can't hammer the endpoint.
app.post('/api/rebuild-docx', apiLimiters, rebuildDocxHandler);
app.get('/api/atp', atpHandler);
app.get('/api/test', testHandler);

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
