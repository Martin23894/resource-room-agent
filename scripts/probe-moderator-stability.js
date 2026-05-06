#!/usr/bin/env node
// Moderator stability probe — score the SAME resource N times and report
// score variance. The cost-quality bench currently single-samples each
// cell, but a single-sample comparison can't distinguish "prompt change
// improved the paper" from "moderator happened to score it differently
// this time". This script isolates moderator-alone variance.
//
//   ANTHROPIC_API_KEY=... node scripts/probe-moderator-stability.js
//
// Costs ~$0.20 per moderation call × N runs × 2 cells = ~$1.20 for the
// default N=3 / 2-cell configuration. Reads the most recently-written
// bench JSON and pulls a known-PASS and a known-NEEDS_WORK resource so
// we can see variance at both ends of the score spectrum.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { moderate } from '../lib/moderator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = join(__dirname, '..', 'data', 'bench');
const N = 3;

function pickBenchFile() {
  const files = readdirSync(BENCH_DIR).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) {
    console.error('No bench files found.');
    process.exit(2);
  }
  return join(BENCH_DIR, files[files.length - 1]);
}

const benchPath = pickBenchFile();
const bench = JSON.parse(readFileSync(benchPath, 'utf-8'));
console.log(`Using bench: ${benchPath}\n`);

// Pick one PASS-ish and one NEEDS_WORK cell for variance comparison.
const cells = bench.cells.filter((c) => c.resource && !c.error);
const pass = cells.find((c) => c.moderation?.verdict === 'PASS') || cells[0];
const needs = cells.find((c) => c.moderation?.verdict === 'NEEDS_WORK') || cells[1];
const targets = [pass, needs].filter(Boolean);

for (const c of targets) {
  console.log(`\n=== ${c.id} (originally ${c.moderation?.verdict} ${c.moderation?.overallScore}/5) ===`);
  const scores = [];
  for (let i = 0; i < N; i++) {
    const r = await moderate(c.resource);
    const dims = r.dimensions || {};
    const dimScores = Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, v.score]));
    scores.push({ verdict: r.verdict, overall: r.overallScore, dims: dimScores });
    console.log(`  run ${i + 1}: ${r.verdict} ${r.overallScore}/5  markFairness=${dimScores.markFairness}  cogIntegrity=${dimScores.cognitiveLevelIntegrity}`);
  }

  // Quick variance summary.
  const overalls = scores.map((s) => s.overall);
  const min = Math.min(...overalls), max = Math.max(...overalls);
  const verdicts = [...new Set(scores.map((s) => s.verdict))];
  console.log(`  spread: overallScore ${min}-${max} (range ${max - min}); verdicts: ${verdicts.join(', ')}`);
}
