import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Import route handlers — files are in root, not /api/
import generateHandler from './generate.js';
import refineHandler from './refine.js';
import coverHandler from './cover.js';
import testHandler from './test.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));

// Request timeout — prevents Railway hanging on slow Anthropic responses
app.use((req, res, next) => {
  res.setTimeout(270000, () => {
    res.status(503).json({ error: 'Request timed out. Please try again.' });
  });
  next();
});

// CORS — allow all origins for now (lock down later when you add auth)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// ─── Serve static frontend ──────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── API Routes ─────────────────────────────────────────────
app.post('/api/generate', generateHandler);
app.post('/api/refine', refineHandler);
app.post('/api/cover', coverHandler);
app.get('/api/test', testHandler);

// ─── Health check (Railway uses this) ───────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Catch-all → serve index.html (SPA fallback) ───────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🏫 The Resource Room is running on port ${PORT}`);
  console.log(`   API:    http://localhost:${PORT}/api/test`);
  console.log(`   App:    http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
});
