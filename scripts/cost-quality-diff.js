#!/usr/bin/env node
// Diff two cost-quality benchmark snapshots and print a side-by-side report.
//
//   node scripts/cost-quality-diff.js baseline after-changes
//
// Reads data/bench/<label>.json for each label, prints per-cell verdict
// changes + aggregate score deltas. Exits non-zero if quality regressed
// (avgOverallScore drops by more than 0.5 OR any cell flipped from PASS
// to NEEDS_WORK/REJECT).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = join(__dirname, '..', 'data', 'bench');

const [, , beforeLabel, afterLabel] = process.argv;
if (!beforeLabel || !afterLabel) {
  console.error('Usage: cost-quality-diff <before-label> <after-label>');
  process.exit(2);
}

function load(label) {
  return JSON.parse(readFileSync(join(BENCH_DIR, `${label}.json`), 'utf8'));
}

const before = load(beforeLabel);
const after  = load(afterLabel);

const beforeById = Object.fromEntries(before.cells.map((c) => [c.id, c]));
const afterById  = Object.fromEntries(after.cells.map((c) => [c.id, c]));

console.log(`\n══════ ${beforeLabel} → ${afterLabel} ══════\n`);
console.log('Aggregate:');
const fields = ['cellsValid', 'cellsModerated', 'avgAttempts', 'avgOverallScore', 'avgBlocking', 'avgAdvisory'];
const w = (s) => String(s).padEnd(10);
console.log(`  ${w('field')}${w(beforeLabel)}${w(afterLabel)}delta`);
for (const f of fields) {
  const b = before.aggregate[f], a = after.aggregate[f];
  const d = (typeof b === 'number' && typeof a === 'number') ? (a - b).toFixed(2) : '-';
  console.log(`  ${w(f)}${w(b ?? '-')}${w(a ?? '-')}${d}`);
}
console.log(`  ${w('verdicts')}${w(JSON.stringify(before.aggregate.verdicts))}${w(JSON.stringify(after.aggregate.verdicts))}`);

console.log('\nPer-cell:');
const ids = [...new Set([...before.cells.map((c) => c.id), ...after.cells.map((c) => c.id)])];
let regressions = 0;
let scoreDrop = 0;
for (const id of ids) {
  const b = beforeById[id], a = afterById[id];
  const bv = b?.moderation?.verdict || (b?.error ? 'ERROR' : 'INVALID');
  const av = a?.moderation?.verdict || (a?.error ? 'ERROR' : 'INVALID');
  const bs = b?.moderation?.overallScore ?? '-';
  const as = a?.moderation?.overallScore ?? '-';
  const ba = b?.attempts ?? '?';
  const aa = a?.attempts ?? '?';
  const flag = (bv === 'PASS' && av !== 'PASS') ? '  REGRESSION ↓'
             : (bv !== 'PASS' && av === 'PASS') ? '  improvement ↑'
             : '';
  if (bv === 'PASS' && av !== 'PASS') regressions++;
  if (typeof bs === 'number' && typeof as === 'number') scoreDrop += (bs - as);
  console.log(`  ${id.padEnd(28)} ${bv.padEnd(11)} → ${av.padEnd(11)}  score ${bs}→${as}  attempts ${ba}→${aa}${flag}`);
}

console.log('');
const avgDrop = before.aggregate.avgOverallScore && after.aggregate.avgOverallScore
  ? before.aggregate.avgOverallScore - after.aggregate.avgOverallScore
  : 0;
if (regressions > 0 || avgDrop > 0.5) {
  console.log(`QUALITY REGRESSED: ${regressions} verdict drops, avg score drop ${avgDrop.toFixed(2)}`);
  process.exit(1);
}
console.log(`OK: ${regressions} regressions, avg score delta ${(-avgDrop).toFixed(2)}`);
