#!/usr/bin/env node
// Cost-quality benchmark for the cost-reduction work.
//
// Runs a fixed 6-cell sample through generate → moderate, captures token
// usage + moderator scores per cell, and writes a labelled JSON snapshot.
// Run before AND after each change so we can diff quality regressions.
//
//   node scripts/cost-quality-bench.js --label=baseline
//   node scripts/cost-quality-bench.js --label=after-haiku-cover
//
// Output: data/bench/<label>.json (gitignored — data/ is local-only).

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate } from '../api/generate.js';
import { moderate } from '../lib/moderator.js';
import { rebalanceMarks } from '../lib/rebalance.js';
import { getPacingUnitsSlim } from '../lib/atp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'data', 'bench');

// Cells chosen to exercise known failure modes + cog frameworks + cost archetypes.
// Keep this list stable across runs so before/after comparisons are valid.
// Cost-archetype cells (final-exam / lesson / lesson-series) added 2026-05 for
// the margin analysis — they're the long-tail drivers we need real numbers on.
const CELLS = [
  { id: 'maths-g5-t2-test',        subject: 'Mathematics',                     grade: 5, term: 2, language: 'English',   resourceType: 'Test',       totalMarks: 40 },
  { id: 'nst-g6-t1-worksheet',     subject: 'Natural Sciences and Technology', grade: 6, term: 1, language: 'English',   resourceType: 'Worksheet',  totalMarks: 25 },
  { id: 'eng-hl-g4-t2-exam',       subject: 'English Home Language',           grade: 4, term: 2, language: 'English',   resourceType: 'Exam',       totalMarks: 50 },
  { id: 'afr-hl-g4-t3-test',       subject: 'Afrikaans Home Language',         grade: 4, term: 3, language: 'Afrikaans', resourceType: 'Test',       totalMarks: 40 },
  { id: 'geo-g5-t2-test',          subject: 'Social Sciences — Geography',     grade: 5, term: 2, language: 'English',   resourceType: 'Test',       totalMarks: 40 },
  { id: 'hist-g6-t2-exam',         subject: 'Social Sciences — History',       grade: 6, term: 2, language: 'English',   resourceType: 'Exam',       totalMarks: 50 },
  // Cost-archetype additions:
  { id: 'maths-g7-final-exam',     subject: 'Mathematics',                     grade: 7, term: 4, language: 'English',   resourceType: 'Final Exam', totalMarks: 100 },
  { id: 'maths-g6-t2-lesson',      subject: 'Mathematics',                     grade: 6, term: 2, language: 'English',   resourceType: 'Lesson',     totalMarks: 20, lessonMinutes: 45 },
];

function parseArgs(argv) {
  const args = { label: 'unlabelled', cells: null, skipModerate: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--label=')) args.label = a.slice('--label='.length);
    else if (a.startsWith('--cells=')) args.cells = a.slice('--cells='.length).split(',');
    else if (a === '--skip-moderate') args.skipModerate = true;
    else if (a === '-h' || a === '--help') { console.log('see header'); process.exit(0); }
    else { console.error('Unknown flag:', a); process.exit(2); }
  }
  return args;
}

function resolveLessonUnitId(cell) {
  if (cell.resourceType !== 'Lesson' || cell.unitId) return cell;
  const units = getPacingUnitsSlim(cell.subject, cell.grade, cell.term);
  if (!units.length) {
    throw new Error(`No pacing units for Lesson cell ${cell.id} (${cell.subject} Gr${cell.grade} T${cell.term})`);
  }
  return { ...cell, unitId: units[0].id };
}

function sumUsage(usageByAttempt) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const u of usageByAttempt || []) {
    totals.input += u.input || 0;
    totals.output += u.output || 0;
    totals.cacheRead += u.cacheRead || 0;
    totals.cacheWrite += u.cacheWrite || 0;
  }
  return totals;
}

async function runCell(cell, opts) {
  const t0 = Date.now();
  const cellLog = { id: cell.id, request: cell };
  try {
    const resolved = resolveLessonUnitId(cell);
    const result = await generate(resolved, { maxRetries: 2 });
    cellLog.attempts = result.attempts;
    cellLog.validationOk = result.validation.ok;
    cellLog.validationErrors = result.validation.ok ? [] : result.validation.errors.slice(0, 5);
    cellLog.rebalance = {
      converged: result.rebalance.converged,
      adjustments: result.rebalance.adjustments.length,
      finalSum: result.rebalance.finalSum,
      targetSum: result.rebalance.targetSum,
    };
    cellLog.generateMs = Date.now() - t0;
    cellLog.usageByAttempt = result.usageByAttempt || [];
    cellLog.usageTotals = sumUsage(result.usageByAttempt);
    cellLog.resource = result.resource; // keep full resource so we can re-run moderate offline

    if (!opts.skipModerate && result.validation.ok) {
      const tm = Date.now();
      const report = await moderate(result.resource);
      cellLog.moderation = {
        verdict: report.verdict,
        overallScore: report.overallScore,
        blocking: (report.criticalIssues || []).filter((i) => i.severity === 'BLOCKING').length,
        advisory: (report.criticalIssues || []).filter((i) => i.severity === 'ADVISORY').length,
        dimensions: Object.fromEntries(
          Object.entries(report.dimensions || {}).map(([k, v]) => [k, v.score])
        ),
        recommendation: report.recommendation,
      };
      cellLog.moderateMs = Date.now() - tm;
    }
  } catch (err) {
    cellLog.error = err?.message || String(err);
  }
  return cellLog;
}

async function main() {
  const args = parseArgs(process.argv);
  const cells = args.cells ? CELLS.filter((c) => args.cells.includes(c.id)) : CELLS;
  if (cells.length === 0) {
    console.error('No cells matched --cells filter.');
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Running ${cells.length} cell(s), label="${args.label}"`);

  const start = Date.now();
  const results = [];
  for (const cell of cells) {
    process.stdout.write(`  ${cell.id} ... `);
    const r = await runCell(cell, args);
    results.push(r);
    if (r.error) {
      console.log(`ERROR: ${r.error}`);
    } else {
      const v = r.moderation?.verdict || (r.validationOk ? 'no-mod' : 'INVALID');
      const s = r.moderation?.overallScore ?? '-';
      const u = r.usageTotals || {};
      const tokSummary = `in=${u.input ?? '?'} out=${u.output ?? '?'} cR=${u.cacheRead ?? 0} cW=${u.cacheWrite ?? 0}`;
      console.log(`${v} (score=${s}, attempts=${r.attempts ?? '?'}, ${r.generateMs}ms, ${tokSummary})`);
    }
  }

  const summary = {
    label: args.label,
    runAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    cellCount: results.length,
    aggregate: aggregate(results),
    cells: results,
  };

  const outPath = join(OUT_DIR, `${args.label}.json`);
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log('Aggregate:', JSON.stringify(summary.aggregate, null, 2));
}

function aggregate(results) {
  const valid = results.filter((r) => !r.error);
  const moderated = valid.filter((r) => r.moderation);
  const verdictCounts = { PASS: 0, NEEDS_WORK: 0, REJECT: 0 };
  let scoreSum = 0, blockingSum = 0, advisorySum = 0, attemptsSum = 0;
  let inputSum = 0, outputSum = 0, cacheReadSum = 0, cacheWriteSum = 0, usageCells = 0;
  for (const r of moderated) {
    verdictCounts[r.moderation.verdict] = (verdictCounts[r.moderation.verdict] || 0) + 1;
    scoreSum += r.moderation.overallScore;
    blockingSum += r.moderation.blocking;
    advisorySum += r.moderation.advisory;
  }
  for (const r of valid) {
    attemptsSum += (r.attempts || 1);
    if (r.usageTotals) {
      inputSum += r.usageTotals.input || 0;
      outputSum += r.usageTotals.output || 0;
      cacheReadSum += r.usageTotals.cacheRead || 0;
      cacheWriteSum += r.usageTotals.cacheWrite || 0;
      usageCells++;
    }
  }
  return {
    cellsTotal: results.length,
    cellsValid: valid.length,
    cellsModerated: moderated.length,
    avgAttempts: valid.length ? +(attemptsSum / valid.length).toFixed(2) : null,
    avgOverallScore: moderated.length ? +(scoreSum / moderated.length).toFixed(2) : null,
    avgBlocking: moderated.length ? +(blockingSum / moderated.length).toFixed(2) : null,
    avgAdvisory: moderated.length ? +(advisorySum / moderated.length).toFixed(2) : null,
    verdicts: verdictCounts,
    avgInputTokens: usageCells ? Math.round(inputSum / usageCells) : null,
    avgOutputTokens: usageCells ? Math.round(outputSum / usageCells) : null,
    avgCacheReadTokens: usageCells ? Math.round(cacheReadSum / usageCells) : null,
    avgCacheWriteTokens: usageCells ? Math.round(cacheWriteSum / usageCells) : null,
  };
}

main().catch((err) => {
  console.error('Bench failed:', err);
  process.exit(1);
});
