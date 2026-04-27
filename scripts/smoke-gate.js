#!/usr/bin/env node
// Smoke runner for the pre-delivery invariant gate + regeneration loop.
//
// Runs ONE generation in-process, captures every SSE phase event, and
// dumps the gate state at the end. Use this BEFORE flipping the gate
// to enforce mode in production — false positives in the invariant
// runner show up here as gate failures on a paper that's actually
// fine, and integration bugs in api/generate.js show up as crashes
// or missing phase events.
//
// USAGE
//   node scripts/smoke-gate.js [--config=fixture.json]
//                              [--mode=report|enforce]
//                              [--bypass-cache]
//                              [--paper-out=path] [--memo-out=path]
//
// The default fixture is a Grade 7 EMS Term 2 Exam (English) — the
// audit cycle's worst offender for mark-sum drift. Override with
// --config=path to point at any JSON file with the same shape as the
// API request body.
//
// REQUIREMENTS
//   ANTHROPIC_API_KEY must be set. Without it the script exits with a
//   clear message rather than crashing inside the first Claude call.
//
// EXIT CODES
//   0 — gate passed (verificationStatus is invariants_passed or
//       mark_sum_drift, no blocking failures)
//   1 — gate failed (invariants_failed in report mode, or
//       INVARIANT_GATE_BLOCKED in enforce mode)
//   2 — runner failed (missing key, fixture parse error, etc.)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ─── argv parser ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { mode: null, config: null, bypassCache: false, paperOut: null, memoOut: null };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--config='))     opts.config     = arg.slice('--config='.length);
    else if (arg.startsWith('--mode='))  opts.mode       = arg.slice('--mode='.length);
    else if (arg === '--bypass-cache')   opts.bypassCache = true;
    else if (arg.startsWith('--paper-out=')) opts.paperOut = arg.slice('--paper-out='.length);
    else if (arg.startsWith('--memo-out='))  opts.memoOut  = arg.slice('--memo-out='.length);
    else if (arg === '-h' || arg === '--help') { printHelp(); process.exit(0); }
    else if (arg.startsWith('--')) {
      console.error(`unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`smoke-gate — run ONE generation through the gate and dump the state.

  --config=path        JSON fixture with generation params (default: built-in)
  --mode=report|enforce  override INVARIANT_GATE_MODE for this run
  --bypass-cache       force a fresh generation (skip the in-memory cache)
  --paper-out=path     write final paper text to a file
  --memo-out=path      write final memo text to a file
  -h, --help           show this help

Default fixture: Grade 7 EMS Term 2 Exam, English, 50 marks.`);
}

// ─── default fixture ────────────────────────────────────────────────────

const DEFAULT_FIXTURE = {
  subject:       'Economic and Management Sciences',
  topic:         '',
  resourceType:  'Exam',
  language:      'English',
  duration:      50,
  difficulty:    'on',
  includeRubric: false,
  grade:         7,
  term:          2,
};

// ─── mock req/res ───────────────────────────────────────────────────────

// SSE mode req: .headers.accept must include text/event-stream so the
// channel writes phase frames. .on('close', fn) is invoked if the
// pipeline aborts; we never abort, so it's a no-op storage hook.
function buildMockReq(body) {
  const closeHandlers = [];
  return {
    method:  'POST',
    headers: { accept: 'text/event-stream' },
    body,
    on(event, handler) {
      if (event === 'close') closeHandlers.push(handler);
    },
    _triggerClose() { for (const h of closeHandlers) h(); },
  };
}

// SSE mode res: collect every res.write() chunk so we can parse the
// `event: phase\ndata: {...}\n\n` frames after the handler resolves.
// res.end() resolves the doneSignal so the caller knows when to read
// the buffer.
function buildMockRes() {
  const chunks = [];
  let resolveDone, rejectDone;
  const done = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });
  const res = {
    writableEnded: false,
    statusCode:    200,
    headersSent:   false,
    _chunks:       chunks,
    _done:         done,
    writeHead(code, headers) {
      this.statusCode  = code;
      this.headersSent = true;
      this._headers    = headers;
    },
    write(chunk) {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    },
    end() {
      this.writableEnded = true;
      resolveDone();
    },
    // JSON-fallback methods, included so a non-SSE handler path still
    // works if the runner ever drops the SSE accept header.
    status(code) { this.statusCode = code; return this; },
    json(payload) {
      chunks.push(JSON.stringify(payload));
      this.writableEnded = true;
      resolveDone();
    },
  };
  res._reject = rejectDone;
  return res;
}

// ─── SSE frame parser ───────────────────────────────────────────────────

// Joins all res.write chunks then splits on the blank-line frame
// separator. Each frame is `event: <name>\ndata: <json>`. Returns
// [{ event, data }, ...] in chronological order.
function parseSseFrames(chunks) {
  const buffer = chunks.join('');
  const frames = [];
  for (const block of buffer.split('\n\n')) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith(':')) continue; // skip comments
    const lines = trimmed.split('\n');
    let event = null, dataStr = '';
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
    }
    if (!event) continue;
    let data = null;
    try { data = JSON.parse(dataStr); } catch { data = dataStr; }
    frames.push({ event, data });
  }
  return frames;
}

// ─── main ───────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY is not set. Smoke runner needs a real API key — every generation makes live Claude calls.');
    process.exit(2);
  }

  // Apply mode override BEFORE importing generate.js so its env reads
  // are stable for the run.
  if (opts.mode) {
    if (opts.mode !== 'report' && opts.mode !== 'enforce') {
      console.error(`ERROR: --mode must be "report" or "enforce", got "${opts.mode}"`);
      process.exit(2);
    }
    process.env.INVARIANT_GATE_MODE = opts.mode;
  }

  let body = DEFAULT_FIXTURE;
  if (opts.config) {
    const path = resolve(process.cwd(), opts.config);
    try {
      body = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      console.error(`ERROR: failed to load fixture ${path}: ${err.message}`);
      process.exit(2);
    }
  }
  if (opts.bypassCache) body._bypassCache = true;

  console.log('═══ smoke-gate — running one generation ═══');
  console.log('  mode:     ', process.env.INVARIANT_GATE_MODE || 'report');
  console.log('  subject:  ', body.subject);
  console.log('  resource: ', body.resourceType);
  console.log('  grade/term:', body.grade, '/', body.term);
  console.log('  language: ', body.language);
  console.log('  marks:    ', body.duration);
  console.log('');

  const handlerModule = await import(join(REPO_ROOT, 'api', 'generate.js'));
  const handler = handlerModule.default;

  const req = buildMockReq(body);
  const res = buildMockRes();

  const startedAt = Date.now();
  let runError = null;
  try {
    await handler(req, res);
    if (!res.writableEnded) {
      // Handler returned without ending the stream — should never happen
      // but fail loud so we notice.
      throw new Error('handler returned without calling sendResult/sendError');
    }
  } catch (err) {
    runError = err;
  }
  const elapsedMs = Date.now() - startedAt;

  // Parse the captured SSE frames.
  const frames = parseSseFrames(res._chunks);

  console.log('═══ phase events (in order) ═══');
  for (const f of frames) {
    if (f.event === 'phase') {
      const tag = `${f.data.phase}:${f.data.status}`;
      const detail = { ...f.data };
      delete detail.phase;
      delete detail.status;
      const detailStr = Object.keys(detail).length > 0 ? '  ' + JSON.stringify(detail) : '';
      console.log(`  ${tag.padEnd(40)}${detailStr}`);
    }
  }

  const resultFrame = frames.find((f) => f.event === 'result');
  const errorFrame  = frames.find((f) => f.event === 'error');

  console.log('');
  console.log('═══ final state ═══');
  console.log('  elapsed:   ', elapsedMs, 'ms');
  if (runError) {
    console.log('  runner threw:', runError.message);
  }
  if (errorFrame) {
    console.log('  result:    ERROR');
    console.log('  status:    ', errorFrame.data.status);
    console.log('  code:      ', errorFrame.data.code);
    console.log('  message:   ', errorFrame.data.error);
    process.exit(1);
  }
  if (!resultFrame) {
    console.log('  result:    NO RESULT FRAME EMITTED');
    process.exit(2);
  }

  const r = resultFrame.data;
  console.log('  verificationStatus:', r.verificationStatus);
  if (r.markSumWarning) {
    console.log('  markSumWarning:', JSON.stringify(r.markSumWarning));
  }
  if (Array.isArray(r.invariantFailures) && r.invariantFailures.length > 0) {
    console.log(`  invariantFailures: ${r.invariantFailures.length}`);
    for (const f of r.invariantFailures) {
      console.log(`    [${f.category}] ${f.id} (${f.scope}) — ${f.message}`);
    }
  } else {
    console.log('  invariantFailures: 0');
  }

  // Telemetry from the gate's own phase frames — surface the auto-fix /
  // regen counts at a glance so the user doesn't have to scan above.
  const autofix = frames.find((f) => f.event === 'phase' && f.data.phase === 'autofix' && f.data.status === 'applied');
  if (autofix) console.log('  autofix.applied:', autofix.data.ids?.join(', '));
  const gateFinal = [...frames].reverse().find((f) => f.event === 'phase' && f.data.phase === 'invariant_gate' && (f.data.status === 'passed' || f.data.status === 'failed'));
  if (gateFinal && gateFinal.data.attemptsByPhase) {
    const attempts = gateFinal.data.attemptsByPhase;
    const nonZero = Object.entries(attempts).filter(([, n]) => n > 0).map(([p, n]) => `${p}=${n}`).join(', ');
    if (nonZero) console.log('  regen attempts:', nonZero);
    if (gateFinal.data.capExhausted?.length) {
      console.log('  capExhausted:', gateFinal.data.capExhausted.join(', '));
    }
  }

  // Optional dumps for human eyeballing.
  if (opts.paperOut && r.preview) {
    const paperOnly = r.preview.split('\n\n')[0];
    writeFileSync(resolve(process.cwd(), opts.paperOut), paperOnly);
    console.log(`  paper written: ${opts.paperOut}`);
  }
  if (opts.memoOut && r.preview) {
    // preview = paper + '\n\n' + memo; split on the FIRST '\n\n' boundary
    // to recover the paper, the rest is the memo.
    const idx = r.preview.indexOf('\n\n');
    const memo = idx >= 0 ? r.preview.slice(idx + 2) : '';
    writeFileSync(resolve(process.cwd(), opts.memoOut), memo);
    console.log(`  memo written:  ${opts.memoOut}`);
  }

  // Exit code: 0 if gate passed, 1 if it didn't.
  const passed =
    r.verificationStatus === 'invariants_passed' ||
    r.verificationStatus === 'clean' ||
    r.verificationStatus === 'corrected';
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err?.stack || err);
  process.exit(2);
});
