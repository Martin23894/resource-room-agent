#!/usr/bin/env node
// Margin model — reads a cost-quality-bench snapshot and projects unit costs
// + per-tier monthly margin under a small set of usage personas.
//
//   node scripts/margin-model.js                       # uses data/bench/baseline.json
//   node scripts/margin-model.js --bench=after-haiku-cover
//   node scripts/margin-model.js --usd-zar=18.5        # override FX
//
// What this is and isn't:
//   • Reads measured token usage per archetype from a real bench run.
//   • Multiplies by the published Sonnet 4.6 / Haiku 4.5 price card to get
//     $/call. Anthropic prices are listed at the top — UPDATE before runs.
//   • Applies persona × cache-hit assumptions to project monthly Anthropic
//     spend per active subscriber.
//   • Adds fixed-cost allocations (Resend / Sentry / Plausible / Railway)
//     amortised over an assumed paid-user count.
//   • Compares to subscription revenue net of Stripe fees.
//
// What this is NOT:
//   • Not a forecast. It's a scenario tool — change the persona mix, the
//     cache hit rate, or the active-user count and re-run.
//   • Doesn't account for refund rates, churn, trial conversion, or
//     marketing spend. Those live in the business plan, not here.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TIERS } from '../lib/billing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = join(__dirname, '..', 'data', 'bench');

// ─────────────────────────────────────────────────────────────
// Anthropic price card (USD per 1M tokens). VERIFY before each run —
// Anthropic publishes current pricing at https://www.anthropic.com/pricing.
// Sonnet 4.6 and Haiku 4.5 figures here are placeholders that match the
// generally-known shape; adjust if the published card changes.
// ─────────────────────────────────────────────────────────────
const PRICE_USD_PER_M = {
  'claude-sonnet-4-6': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  'claude-haiku-4-5':  { input: 1.00, output:  5.00, cacheRead: 0.10, cacheWrite: 1.25 },
};

const SONNET = 'claude-sonnet-4-6';

// ─────────────────────────────────────────────────────────────
// Fixed monthly costs (USD). Round figures, override via env / flags.
// ─────────────────────────────────────────────────────────────
const FIXED_MONTHLY_USD = {
  railway:   15,    // compute + small volume for cache.db
  resend:    20,    // paid tier — free tier covers very low volume only
  sentry:     0,    // free tier sufficient at our error volume
  plausible:  9,    // 10k pageviews tier
  domain:     1,    // amortised
};

const STRIPE_FEE_PCT = 0.029;   // 2.9% + R2 — round to 3% for simplicity
const STRIPE_FIXED_ZAR = 2;

// ─────────────────────────────────────────────────────────────
// Personas — describe a typical month for each kind of subscriber. The
// `archetypeMix` keys must match cell ids (or archetype labels) we have
// bench numbers for. `cacheHit` is the fraction of calls served from the
// SQLite result cache (zero Anthropic cost).
//
// Two scenarios:
//   • baseline  — typical usage at tier targets, moderate cache hits,
//                 mix skewed toward cheap content (worksheets/tests).
//   • worst     — every paid user maxes the tier hard cap; zero cache
//                 hits; mix shifted toward expensive content (Lesson +
//                 Final Exam); retry inflation factor applied via
//                 RETRY_INFLATION below. Use to stress-test margins.
//
// Pick with --scenario=baseline (default) or --scenario=worst.
// ─────────────────────────────────────────────────────────────
const PERSONA_SETS = {
  baseline: [
    {
      id: 'light',
      label: 'Light teacher (Essential tier target)',
      cacheHit: 0.30,
      archetypeMix: {
        'maths-g5-t2-test':       3,  // worksheet-ish small assessments
        'nst-g6-t1-worksheet':    4,
        'eng-hl-g4-t2-exam':      0,
        'maths-g7-final-exam':    0,
        'maths-g6-t2-lesson':     1,
      },
    },
    {
      id: 'classroom',
      label: 'Classroom regular (Classroom tier target)',
      cacheHit: 0.40,
      archetypeMix: {
        'maths-g5-t2-test':       6,
        'nst-g6-t1-worksheet':    6,
        'eng-hl-g4-t2-exam':      2,
        'maths-g7-final-exam':    1,
        'maths-g6-t2-lesson':     8,   // ≈ one 8-lesson series — series cost = N×single
      },
    },
    {
      id: 'pro',
      label: 'Power user / HOD (Pro tier target)',
      cacheHit: 0.50,
      archetypeMix: {
        'maths-g5-t2-test':      10,
        'nst-g6-t1-worksheet':    8,
        'eng-hl-g4-t2-exam':      4,
        'maths-g7-final-exam':    2,
        'maths-g6-t2-lesson':    24,   // ≈ three 8-lesson series
      },
    },
  ],
  // Worst case: tier hard cap on calls, zero cache hits, expensive-content
  // skew (Lessons + Final Exams dominate). The cap numbers come from
  // lib/billing.js TIERS[*].monthlyCap (15 / 40 / 80) — every Anthropic
  // call hits the API, every retry counts.
  worst: [
    {
      id: 'light',
      label: 'Light teacher MAXED (Essential cap = 15)',
      cacheHit: 0,
      archetypeMix: {
        'maths-g5-t2-test':       3,
        'nst-g6-t1-worksheet':    2,
        'eng-hl-g4-t2-exam':      2,
        'maths-g7-final-exam':    1,
        'maths-g6-t2-lesson':     7,   // shifted toward Lessons
      },
    },
    {
      id: 'classroom',
      label: 'Classroom MAXED (Classroom cap = 40)',
      cacheHit: 0,
      archetypeMix: {
        'maths-g5-t2-test':       4,
        'nst-g6-t1-worksheet':    4,
        'eng-hl-g4-t2-exam':      4,
        'maths-g7-final-exam':    4,
        'maths-g6-t2-lesson':    24,   // three 8-lesson series
      },
    },
    {
      id: 'pro',
      label: 'Power user MAXED (Pro cap = 80)',
      cacheHit: 0,
      archetypeMix: {
        'maths-g5-t2-test':       8,
        'nst-g6-t1-worksheet':    8,
        'eng-hl-g4-t2-exam':      8,
        'maths-g7-final-exam':    8,
        'maths-g6-t2-lesson':    48,   // six 8-lesson series
      },
    },
  ],
};

// Worst-case retry inflation: bench attempt counts come from a small
// sample, so worst-case applies a 1.5× multiplier on Anthropic spend to
// approximate a high-retry month (schema-fail retries, transient 429/5xx
// re-runs). Baseline uses 1.0× (the actual measured attempts).
const RETRY_INFLATION = { baseline: 1.0, worst: 1.5 };

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { bench: null, usdZar: 18.5, paidUsers: 100, scenario: 'baseline' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--bench=')) args.bench = a.slice('--bench='.length);
    else if (a.startsWith('--usd-zar=')) args.usdZar = Number(a.slice('--usd-zar='.length));
    else if (a.startsWith('--paid-users=')) args.paidUsers = Number(a.slice('--paid-users='.length));
    else if (a.startsWith('--scenario=')) args.scenario = a.slice('--scenario='.length);
    else if (a === '-h' || a === '--help') { console.log('see header'); process.exit(0); }
    else { console.error('Unknown flag:', a); process.exit(2); }
  }
  if (!PERSONA_SETS[args.scenario]) {
    console.error(`Unknown --scenario=${args.scenario}. Choices: ${Object.keys(PERSONA_SETS).join(', ')}`);
    process.exit(2);
  }
  return args;
}

function pickBenchFile(label) {
  if (label) return join(BENCH_DIR, `${label}.json`);
  // Pick the most recently modified file in data/bench/.
  const files = readdirSync(BENCH_DIR).filter((f) => f.endsWith('.json'));
  if (!files.length) {
    console.error(`No bench files in ${BENCH_DIR}. Run scripts/cost-quality-bench.js first.`);
    process.exit(2);
  }
  // Prefer "baseline.json" if present, otherwise newest.
  if (files.includes('baseline.json')) return join(BENCH_DIR, 'baseline.json');
  files.sort();
  return join(BENCH_DIR, files[files.length - 1]);
}

// ─────────────────────────────────────────────────────────────
// Cost arithmetic
// ─────────────────────────────────────────────────────────────
function costPerCallUsd(usageTotals, model = SONNET) {
  if (!usageTotals) return 0;
  const p = PRICE_USD_PER_M[model];
  if (!p) throw new Error(`No price card for model ${model}`);
  const u = usageTotals;
  // input_tokens in the API response is just the non-cached input. cache_read
  // and cache_creation are billed separately per Anthropic's docs.
  return (
    (u.input       || 0) * p.input      / 1_000_000 +
    (u.output      || 0) * p.output     / 1_000_000 +
    (u.cacheRead   || 0) * p.cacheRead  / 1_000_000 +
    (u.cacheWrite  || 0) * p.cacheWrite / 1_000_000
  );
}

function buildCellIndex(bench) {
  const idx = {};
  for (const c of bench.cells || []) {
    if (c.usageTotals) idx[c.id] = c;
  }
  return idx;
}

function projectPersona(persona, cellIndex, retryInflation = 1.0) {
  const detail = [];
  let monthlyAnthropicUsd = 0;
  let monthlyCalls = 0;
  for (const [cellId, count] of Object.entries(persona.archetypeMix)) {
    if (!count) continue;
    const cell = cellIndex[cellId];
    if (!cell) {
      detail.push({ cellId, count, missing: true });
      continue;
    }
    const billableCalls = count * (1 - persona.cacheHit);
    const unitCostUsd = costPerCallUsd(cell.usageTotals, SONNET) * retryInflation;
    const lineUsd = billableCalls * unitCostUsd;
    monthlyAnthropicUsd += lineUsd;
    monthlyCalls += count;
    detail.push({
      cellId,
      count,
      billableCalls: +billableCalls.toFixed(2),
      unitCostUsd: +unitCostUsd.toFixed(4),
      lineUsd: +lineUsd.toFixed(4),
    });
  }
  return { ...persona, monthlyCalls, monthlyAnthropicUsd, detail };
}

function tierForPersona(personaId) {
  return ({ light: 'essential', classroom: 'classroom', pro: 'pro' })[personaId];
}

function net(zarRevenue) {
  // Stripe takes ~2.9% + R2 per successful charge.
  return zarRevenue * (1 - STRIPE_FEE_PCT) - STRIPE_FIXED_ZAR;
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv);
  const benchPath = pickBenchFile(args.bench);
  const bench = JSON.parse(readFileSync(benchPath, 'utf-8'));
  const cellIndex = buildCellIndex(bench);

  const personas = PERSONA_SETS[args.scenario];
  const retryInflation = RETRY_INFLATION[args.scenario] ?? 1.0;

  console.log(`Bench:        ${benchPath}`);
  console.log(`Bench label:  ${bench.label}  (run ${bench.runAt})`);
  console.log(`Scenario:     ${args.scenario}  (retry inflation ×${retryInflation})`);
  console.log(`USD/ZAR:      ${args.usdZar}`);
  console.log(`Paid users:   ${args.paidUsers}  (for fixed-cost allocation)\n`);

  // Per-archetype unit cost table.
  console.log('=== Per-call cost (measured) ===');
  console.log('archetype'.padEnd(28) + 'in'.padEnd(8) + 'out'.padEnd(8) + 'cR'.padEnd(8) + 'cW'.padEnd(8) + 'attempts'.padEnd(10) + '$/call'.padEnd(12) + 'R/call');
  console.log('-'.repeat(94));
  for (const cell of bench.cells || []) {
    if (!cell.usageTotals) continue;
    const u = cell.usageTotals;
    const cost = costPerCallUsd(u, SONNET);
    console.log(
      cell.id.padEnd(28) +
      String(u.input).padEnd(8) +
      String(u.output).padEnd(8) +
      String(u.cacheRead).padEnd(8) +
      String(u.cacheWrite).padEnd(8) +
      String(cell.attempts || 1).padEnd(10) +
      `$${cost.toFixed(4)}`.padEnd(12) +
      `R${(cost * args.usdZar).toFixed(2)}`
    );
  }

  // Persona projections.
  console.log('\n=== Persona × tier margin ===\n');
  const fixedMonthlyUsd = Object.values(FIXED_MONTHLY_USD).reduce((a, b) => a + b, 0);
  const fixedPerUserUsd = fixedMonthlyUsd / Math.max(1, args.paidUsers);

  for (const persona of personas) {
    const p = projectPersona(persona, cellIndex, retryInflation);
    const tierKey = tierForPersona(persona.id);
    const tier = TIERS[tierKey];
    const grossZar = tier.monthlyPriceZar;
    const netZar = net(grossZar);
    const netUsd = netZar / args.usdZar;

    const totalCostUsd = p.monthlyAnthropicUsd + fixedPerUserUsd;
    const marginUsd = netUsd - totalCostUsd;
    const marginPct = (marginUsd / netUsd) * 100;

    const anthropicZar = p.monthlyAnthropicUsd * args.usdZar;
    const fixedPerUserZar = fixedPerUserUsd * args.usdZar;
    const totalCostZar = totalCostUsd * args.usdZar;
    const marginZar = marginUsd * args.usdZar;

    console.log(`-- ${p.label} → ${tier.name} (R${grossZar}/mo) --`);
    console.log(`  Monthly calls:       ${p.monthlyCalls}  (cache hit assumed ${(p.cacheHit * 100).toFixed(0)}%)`);
    console.log(`  Anthropic spend:     R${anthropicZar.toFixed(2)}   ($${p.monthlyAnthropicUsd.toFixed(2)})`);
    console.log(`  Fixed-cost share:    R${fixedPerUserZar.toFixed(2)}    ($${fixedPerUserUsd.toFixed(2)})  — R${(fixedMonthlyUsd * args.usdZar).toFixed(0)}/mo ÷ ${args.paidUsers} users`);
    console.log(`  Total cost:          R${totalCostZar.toFixed(2)}   ($${totalCostUsd.toFixed(2)})`);
    console.log(`  Gross revenue:       R${grossZar}/mo`);
    console.log(`  Net revenue:         R${netZar.toFixed(2)}   ($${netUsd.toFixed(2)}) after Stripe fees`);
    console.log(`  Gross margin:        R${marginZar.toFixed(2)}   ($${marginUsd.toFixed(2)})  (${marginPct.toFixed(1)}%)`);
    if (p.detail.some((d) => d.missing)) {
      console.log(`  ⚠ missing bench cells: ${p.detail.filter((d) => d.missing).map((d) => d.cellId).join(', ')}`);
    }
    console.log();
  }

  // Sensitivity hints.
  console.log('=== Notes ===');
  console.log(`• Anthropic prices used (USD/1M):  Sonnet 4.6 in/out/cR/cW = ${PRICE_USD_PER_M[SONNET].input}/${PRICE_USD_PER_M[SONNET].output}/${PRICE_USD_PER_M[SONNET].cacheRead}/${PRICE_USD_PER_M[SONNET].cacheWrite}`);
  console.log(`• ZAR figures use USD/ZAR=${args.usdZar}. Pass --usd-zar=N to flex.`);
  console.log(`• A series of N lessons costs ≈ N × the single-lesson unit cost (each lesson is one /api/generate call).`);
  console.log(`• Cache-hit % is the SQLite result cache, not the Anthropic prompt cache. Real usage is closer to 5–15% on first-time content, 50%+ on repeated subjects.`);
  console.log(`• Fixed-cost share assumes ${args.paidUsers} paid users — pass --paid-users=N to flex.`);
}

main();
