#!/usr/bin/env node
// Moderate-sweep runner.
//
// For every paper in --in (default schema/spike-outputs/), call the moderator
// agent and write a structured report. If the verdict is NEEDS_WORK or REJECT,
// optionally regenerate with the moderator's blocking issues fed back as
// corrective context, then re-moderate the regenerated paper. Aggregate at
// the end into _summary.json + a human-readable report.
//
// USAGE
//   node scripts/moderate-sweep.js                      # moderate, no regen
//   node scripts/moderate-sweep.js --regen              # moderate + corrective regen
//   node scripts/moderate-sweep.js --in=DIR --out=DIR   # custom paths
//   node scripts/moderate-sweep.js --delay-ms=20000     # rate-limit pacing
//   node scripts/moderate-sweep.js --limit=10           # subset for testing
//
// FLAGS
//   --in=DIR             input directory containing g{N}/*.json (default schema/spike-outputs)
//   --out=DIR            where to write reports + regenerated papers (default <in>-moderated)
//   --regen              enable corrective regen on NEEDS_WORK/REJECT
//   --delay-ms=N         milliseconds between calls (default 15000)
//   --limit=N            only process the first N papers (smoke testing)
//   --grade=N            filter by grade
//
// OUTPUT FILES (per paper, alongside the source JSON)
//   <id>.moderation.json          — first-pass report
//   <id>.regen.json               — regenerated Resource (only if --regen + verdict ≠ PASS)
//   <id>.regen.moderation.json    — re-moderation of the regen
//   _summary.json                 — aggregate stats across all papers
//
// EXIT CODES
//   0 — sweep completed (some papers may still be NEEDS_WORK after regen)
//   1 — runner error (no API key, IO error, etc.)
//   2 — bad CLI args

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

import { moderate } from '../lib/moderator.js';
import { generate } from '../api/generate.js';
import { rebalanceMarks } from '../lib/rebalance.js';
import { buildAllTermsMatrix } from '../schema/test-matrix.js';

function parseArgs(argv) {
  const args = { in: 'schema/spike-outputs', regen: false, delayMs: 15000, skipExisting: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--in='))         args.in = a.slice('--in='.length);
    else if (a.startsWith('--out='))   args.out = a.slice('--out='.length);
    else if (a === '--regen')          args.regen = true;
    else if (a.startsWith('--delay-ms=')) args.delayMs = Number(a.slice('--delay-ms='.length));
    else if (a.startsWith('--limit=')) args.limit = Number(a.slice('--limit='.length));
    else if (a.startsWith('--grade=')) args.grade = Number(a.slice('--grade='.length));
    else if (a === '--skip-existing')  args.skipExisting = true;
    else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    else { console.error('Unknown flag:', a); process.exit(2); }
  }
  if (!args.out) args.out = `${args.in}-moderated`;
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/moderate-sweep.js [flags]

  --in=DIR             input dir with g{N}/*.json (default schema/spike-outputs)
  --out=DIR            output dir (default <in>-moderated)
  --regen              corrective regen on NEEDS_WORK/REJECT
  --delay-ms=N         ms between calls (default 15000)
  --limit=N            cap papers processed
  --grade=N            filter by grade
`);
}

// Discover all paper JSON files in <in>/g{N}/. Skip files that are
// themselves moderation/regen output (they have suffixes).
function findPapers(rootDir) {
  const out = [];
  let entries;
  try { entries = readdirSync(rootDir); } catch { return out; }
  for (const e of entries) {
    if (!/^g\d+$/.test(e)) continue;
    const grade = Number(e.slice(1));
    const dir = join(rootDir, e);
    let files;
    try { files = readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      if (f.includes('.moderation.') || f.includes('.regen.')) continue;
      if (f.startsWith('_')) continue;
      const full = join(dir, f);
      if (!statSync(full).isFile()) continue;
      out.push({ path: full, id: f.replace(/\.json$/, ''), grade });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// Build a corrective-context paragraph from the moderator's blocking issues.
// Sonnet receives this prepended to the user prompt on regen.
function buildCorrectiveContext(report) {
  const blockers = (report.criticalIssues || []).filter((i) => i.severity === 'BLOCKING');
  if (blockers.length === 0) return null;

  const lines = [
    'A moderator reviewed your previous draft of this paper and identified the following BLOCKING issues that MUST be fixed in this regeneration:',
    '',
  ];
  for (const i of blockers.slice(0, 12)) {
    lines.push(`  • [${i.dimension}] question ${i.questionNumber}: ${i.description}`);
    lines.push(`    fix: ${i.suggestedFix}`);
  }
  lines.push('');
  lines.push('Generate a fresh, complete Resource that addresses every issue listed above. Keep all other content correct and unchanged where possible.');
  return lines.join('\n');
}

// Map paper ID → matrix request body. Used to drive a corrective regen.
function buildIdToRequestMap() {
  const map = new Map();
  for (const c of buildAllTermsMatrix()) map.set(c.id, c.request);
  return map;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const idToRequest = buildIdToRequestMap();
  let papers = findPapers(args.in);
  if (args.grade) papers = papers.filter((p) => p.grade === args.grade);
  if (args.limit) papers = papers.slice(0, args.limit);
  if (args.skipExisting) {
    const before = papers.length;
    papers = papers.filter((p) => {
      const existing = join(args.out, `g${p.grade}`, `${p.id}.moderation.json`);
      try { return !statSync(existing).isFile(); } catch { return true; }
    });
    const skipped = before - papers.length;
    if (skipped > 0) console.log(`--skip-existing: ${skipped} paper(s) already have a moderation report.`);
  }
  if (papers.length === 0) {
    console.error('No papers found in', args.in);
    process.exit(1);
  }

  // Cost estimate up-front so the operator can ctrl-C before spending.
  const moderationCost = papers.length * 0.04;
  const expectedRegens = args.regen ? Math.ceil(papers.length * 0.30) : 0;
  const regenCost = expectedRegens * (0.12 + 0.04); // generate + re-moderate
  console.log(`Moderate-sweep — ${papers.length} paper(s), regen=${args.regen}, delay=${args.delayMs}ms`);
  console.log(`Estimated cost: ~$${(moderationCost + regenCost).toFixed(2)} (moderation $${moderationCost.toFixed(2)} + ~$${regenCost.toFixed(2)} regen)`);
  console.log(`Output: ${args.out}/`);
  console.log('─'.repeat(80));

  const summary = [];
  let i = 0;
  for (const paper of papers) {
    i++;
    const t0 = Date.now();
    const outDir = join(args.out, `g${paper.grade}`);
    mkdirSync(outDir, { recursive: true });

    let resource;
    try { resource = JSON.parse(readFileSync(paper.path, 'utf8')); }
    catch (e) {
      console.log(`[${i}/${papers.length}] ERR  ${paper.id} — parse: ${e.message}`);
      summary.push({ id: paper.id, grade: paper.grade, error: e.message });
      continue;
    }

    // Re-run the rebalancer on the loaded JSON to apply the latest marking-
    // guidance normalisation pass. Idempotent on marks (already-balanced
    // papers stay balanced) but updates markingGuidance so the moderator
    // doesn't see stale per-step "Award N marks" contradictions from
    // older sweeps. Pure local computation, no API spend.
    rebalanceMarks(resource);

    let report = null;
    try {
      report = await moderate(resource);
    } catch (e) {
      console.log(`[${i}/${papers.length}] ERR  ${paper.id} — moderate: ${e.message}`);
      summary.push({ id: paper.id, grade: paper.grade, error: e.message });
      await sleep(args.delayMs);
      continue;
    }
    writeFileSync(join(outDir, `${paper.id}.moderation.json`), JSON.stringify(report, null, 2));

    const blockers = (report.criticalIssues || []).filter((iss) => iss.severity === 'BLOCKING').length;
    const advisories = (report.criticalIssues || []).filter((iss) => iss.severity === 'ADVISORY').length;
    const ms = Date.now() - t0;
    const verdictTag = report.verdict.padEnd(11);
    console.log(`[${i}/${papers.length}] ${verdictTag} ${paper.id.padEnd(56)} score=${report.overallScore}/5 BLOCK=${blockers} ADV=${advisories} (${ms}ms)`);

    let regenReport = null;
    let regenResource = null;
    let regenError = null;
    if (args.regen && report.verdict !== 'PASS') {
      const correctiveContext = buildCorrectiveContext(report);
      if (correctiveContext) {
        const req = idToRequest.get(paper.id);
        if (!req) {
          console.log(`     ↳ no matrix entry for ${paper.id}; skipping regen`);
        } else {
          await sleep(args.delayMs);
          try {
            const regenResult = await generate(req, { correctiveContext });
            regenResource = regenResult.resource;
            writeFileSync(join(outDir, `${paper.id}.regen.json`), JSON.stringify(regenResource, null, 2));
            await sleep(args.delayMs);
            regenReport = await moderate(regenResource);
            writeFileSync(join(outDir, `${paper.id}.regen.moderation.json`), JSON.stringify(regenReport, null, 2));
            const rb = (regenReport.criticalIssues || []).filter((iss) => iss.severity === 'BLOCKING').length;
            const ra = (regenReport.criticalIssues || []).filter((iss) => iss.severity === 'ADVISORY').length;
            console.log(`     ↳ regen → ${regenReport.verdict.padEnd(11)} score=${regenReport.overallScore}/5 BLOCK=${rb} ADV=${ra}`);
          } catch (e) {
            regenError = e.message;
            console.log(`     ↳ regen ERR: ${e.message}`);
          }
        }
      }
    }

    summary.push({
      id: paper.id, grade: paper.grade,
      first: { verdict: report.verdict, score: report.overallScore, blockers, advisories, dimensions: report.dimensions },
      regen: regenReport
        ? {
            verdict: regenReport.verdict, score: regenReport.overallScore,
            blockers: (regenReport.criticalIssues || []).filter((iss) => iss.severity === 'BLOCKING').length,
            advisories: (regenReport.criticalIssues || []).filter((iss) => iss.severity === 'ADVISORY').length,
            dimensions: regenReport.dimensions,
          }
        : null,
      regenError,
    });

    if (i < papers.length) await sleep(args.delayMs);
  }

  writeFileSync(join(args.out, '_summary.json'), JSON.stringify(summary, null, 2));
  printAggregate(summary, args);
}

function printAggregate(summary, args) {
  console.log();
  console.log('═'.repeat(80));
  console.log(`SUMMARY — ${summary.length} paper(s)`);
  console.log('═'.repeat(80));

  const verdictCounts = (key) => {
    const c = { PASS: 0, NEEDS_WORK: 0, REJECT: 0, ERROR: 0 };
    for (const s of summary) {
      const v = s.error ? 'ERROR' : s[key]?.verdict;
      if (v) c[v] = (c[v] || 0) + 1;
    }
    return c;
  };

  const first = verdictCounts('first');
  console.log('First-pass verdicts:');
  for (const [k, v] of Object.entries(first)) console.log(`  ${k.padEnd(12)} ${v}`);

  if (args.regen) {
    const after = { PASS: 0, NEEDS_WORK: 0, REJECT: 0, NO_REGEN: 0, REGEN_ERR: 0 };
    for (const s of summary) {
      if (s.error) continue;
      if (s.first?.verdict === 'PASS') { after.PASS++; continue; }
      if (s.regenError) { after.REGEN_ERR++; continue; }
      if (!s.regen) { after.NO_REGEN++; continue; }
      after[s.regen.verdict] = (after[s.regen.verdict] || 0) + 1;
    }
    console.log();
    console.log('After corrective regen (PASS includes first-pass PASS):');
    for (const [k, v] of Object.entries(after)) console.log(`  ${k.padEnd(12)} ${v}`);
  }

  // Issue-type distribution across first-pass blockers
  const dimCounts = {};
  for (const s of summary) {
    if (!s.first?.dimensions) continue;
    for (const [k, v] of Object.entries(s.first.dimensions)) {
      if (v.score < 4) {
        dimCounts[k] = (dimCounts[k] || 0) + 1;
      }
    }
  }
  if (Object.keys(dimCounts).length) {
    console.log();
    console.log('Dimensions scoring < 4/5 (first pass), most-affected first:');
    const sorted = Object.entries(dimCounts).sort((a, b) => b[1] - a[1]);
    for (const [k, v] of sorted) console.log(`  ${k.padEnd(28)} ${v} paper(s)`);
  }

  console.log();
  console.log(`Reports written to ${args.out}/g{N}/`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => { console.error(e); process.exit(1); });
