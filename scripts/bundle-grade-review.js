#!/usr/bin/env node
// Bundle G6 papers for human teacher review.
//
// For every G6 paper: pick the best available version (regen if it scored
// strictly higher than the original, otherwise the original), re-render to
// DOCX with the CURRENT pipeline (latest reconcile + render code), and
// write to schema/g6-teacher-review/. Also generate an index.md that
// lists each paper with the AI moderator's verdict + dimension scores so
// the human reviewer can compare AI judgement vs. their own.
//
// Output layout:
//   schema/g6-teacher-review/
//     index.md                                   — review guide + priorities
//     <id>.docx                                  — the paper to review
//     <id>.moderator-notes.md                    — what the AI flagged
//
// Usage:
//   node scripts/bundle-grade-review.js [--grade=6] [--out=DIR]

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Packer } from 'docx';

import { renderResource } from '../lib/render.js';
import { rebalanceMarks } from '../lib/rebalance.js';
import { assertResource } from '../schema/resource.schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

function parseArgs(argv) {
  const args = { grade: 6, out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--grade=')) args.grade = Number(a.slice('--grade='.length));
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
  }
  if (!args.out) args.out = `schema/g${args.grade}-teacher-review`;
  return args;
}

function safeRead(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function asArray(x) {
  if (Array.isArray(x)) return x;
  if (typeof x === 'string') {
    try { const p = JSON.parse(x); return Array.isArray(p) ? p : []; }
    catch { return []; }
  }
  return [];
}

function pickBest(originalReport, regenReport) {
  if (!regenReport) return { version: 'original', report: originalReport };
  // Regen wins ONLY if it strictly improved (PASS beats NEEDS_WORK; higher
  // score wins on a tie). Otherwise stick with the original — many regens
  // came back same-or-worse.
  const scoreOf = (r) => (r?.verdict === 'PASS' ? 100 : 0) + (r?.overallScore || 0);
  return scoreOf(regenReport) > scoreOf(originalReport)
    ? { version: 'regen', report: regenReport }
    : { version: 'original', report: originalReport };
}

function writeMarkdownNotes(path, paper) {
  const r = paper.report;
  const dims = (r.dimensions && typeof r.dimensions === 'object' && !Array.isArray(r.dimensions))
    ? r.dimensions : {};
  const issues = asArray(r.criticalIssues);
  const blockers = issues.filter((i) => i?.severity === 'BLOCKING');
  const advisories = issues.filter((i) => i?.severity === 'ADVISORY');

  const lines = [];
  lines.push(`# ${paper.id}`);
  lines.push('');
  lines.push(`**AI moderator verdict:** ${r.verdict}  |  **score:** ${r.overallScore}/5  |  **version:** ${paper.version}`);
  lines.push('');
  if (r.recommendation) {
    lines.push('## AI recommendation');
    lines.push('');
    lines.push(r.recommendation);
    lines.push('');
  }
  if (Object.keys(dims).length) {
    lines.push('## Dimension scores (1-5)');
    lines.push('');
    lines.push('| Dimension | Score | Notes |');
    lines.push('|---|---|---|');
    for (const [k, v] of Object.entries(dims)) {
      const score = v?.score ?? '—';
      const notes = (v?.notes || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| ${k} | ${score}/5 | ${notes} |`);
    }
    lines.push('');
  }
  if (blockers.length) {
    lines.push(`## BLOCKING issues (${blockers.length})`);
    lines.push('');
    for (const i of blockers) {
      lines.push(`- **Q${i.questionNumber} — ${i.dimension}**`);
      lines.push(`  - Issue: ${i.description}`);
      lines.push(`  - Suggested fix: ${i.suggestedFix}`);
      lines.push('');
    }
  }
  if (advisories.length) {
    lines.push(`## Advisory issues (${advisories.length})`);
    lines.push('');
    for (const i of advisories) {
      lines.push(`- **Q${i.questionNumber} — ${i.dimension}**: ${i.description}`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('### What we want from your review');
  lines.push('');
  lines.push('1. Open the DOCX file. Read it as if you received it from a colleague.');
  lines.push('2. Would you publish it for your class as-is? With minor edits? Not at all?');
  lines.push('3. Look at the AI moderator\'s verdict above. Does it match your judgement?');
  lines.push('   - If the AI said PASS but you would NOT publish: what did it miss?');
  lines.push('   - If the AI flagged BLOCKING issues but you would publish anyway: which flags are pedantic?');
  lines.push('4. Are there ANY pedagogical issues the AI didn\'t catch?');
  lines.push('');
  writeFileSync(path, lines.join('\n'));
}

async function main() {
  const args = parseArgs(process.argv);
  const inDir = join(REPO_ROOT, 'schema', 'spike-outputs', `g${args.grade}`);
  const modDir = join(REPO_ROOT, 'schema', 'spike-outputs-moderated', `g${args.grade}`);
  const outDir = join(REPO_ROOT, args.out);
  mkdirSync(outDir, { recursive: true });

  const ids = readdirSync(inDir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();

  console.log(`Bundling ${ids.length} G${args.grade} papers for review`);
  console.log(`Output: ${outDir}/`);
  console.log('─'.repeat(80));

  const summary = [];
  for (const id of ids) {
    const origReport = safeRead(join(modDir, `${id}.moderation.json`));
    const regenReport = safeRead(join(modDir, `${id}.regen.moderation.json`));
    if (!origReport) { console.log(`SKIP  ${id} — no moderation report`); continue; }

    const best = pickBest(origReport, regenReport);
    const sourcePath = best.version === 'regen'
      ? join(modDir, `${id}.regen.json`)
      : join(inDir, `${id}.json`);
    const resource = safeRead(sourcePath);
    if (!resource) { console.log(`SKIP  ${id} — source JSON missing`); continue; }

    // Normalise marking guidance with the latest reconciler.
    rebalanceMarks(resource);

    const validation = assertResource(resource);
    if (!validation.ok) {
      console.log(`WARN ${id} — schema invalid (${validation.errors.length} errors); rendering anyway`);
    }

    const doc = renderResource(resource);
    const buf = await Packer.toBuffer(doc);
    writeFileSync(join(outDir, `${id}.docx`), buf);

    writeMarkdownNotes(join(outDir, `${id}.moderator-notes.md`), { id, version: best.version, report: best.report });

    summary.push({
      id,
      version: best.version,
      verdict: best.report.verdict,
      score: best.report.overallScore,
      blockers: asArray(best.report.criticalIssues).filter((i) => i?.severity === 'BLOCKING').length,
      advisories: asArray(best.report.criticalIssues).filter((i) => i?.severity === 'ADVISORY').length,
    });
    const tag = best.report.verdict.padEnd(11);
    console.log(`OK   ${id.padEnd(56)} ${tag} ${best.report.overallScore}/5  v=${best.version}`);
  }

  // Write index.md
  const ix = [];
  ix.push(`# Grade ${args.grade} — Teacher Review Bundle`);
  ix.push('');
  ix.push(`${summary.length} CAPS-aligned exam/test/worksheet papers across all 4 terms and 10 subjects.`);
  ix.push(`Generated by an AI agent and pre-reviewed by an AI "moderator" (CAPS senior-teacher proxy). We need a real teacher's eye to validate or correct the AI's judgement.`);
  ix.push('');
  ix.push('## How to review');
  ix.push('');
  ix.push('1. **Open the `.docx` file** for the paper — read it as a paper you might give to learners.');
  ix.push('2. **Open the matching `.moderator-notes.md`** to see the AI\'s verdict + dimension scores + flagged issues.');
  ix.push('3. **Tell us:**');
  ix.push('   - **Would you publish this?** YES (as-is), MAYBE (with edits), NO (regenerate).');
  ix.push('   - **Does the AI moderator\'s verdict match yours?** Where does it differ?');
  ix.push('   - **What did the AI miss** (if anything)? Is there a pedagogical issue not in the notes?');
  ix.push('');
  ix.push('You don\'t need to review all 40. A spread of 8-10 across grades and subjects is plenty.');
  ix.push('');
  ix.push('## Suggested priority order (8 papers, balanced spread)');
  ix.push('');
  // Pick 8: 4 PASS (verify), 4 NEEDS_WORK (verify the criticism), spread across subjects
  const passes = summary.filter((s) => s.verdict === 'PASS');
  const fails = summary.filter((s) => s.verdict !== 'PASS');
  const subjectOf = (id) => id.replace(/^g\d+-/, '').replace(/-(test|exam|worksheet|finalexam)-t\d+$/, '');
  const balanced = (arr, k) => {
    const seen = new Set(); const out = [];
    for (const s of arr) {
      const subj = subjectOf(s.id);
      if (seen.has(subj)) continue;
      seen.add(subj); out.push(s);
      if (out.length >= k) break;
    }
    return out;
  };
  const priority = [...balanced(passes, 4), ...balanced(fails, 4)];
  ix.push('| # | Paper | AI verdict | Score | Why include |');
  ix.push('|---|---|---|---|---|');
  for (let i = 0; i < priority.length; i++) {
    const s = priority[i];
    const why = s.verdict === 'PASS' ? 'verify the AI\'s "publish-ready"' : 'verify the AI\'s flags are real';
    ix.push(`| ${i+1} | ${s.id} | **${s.verdict}** | ${s.score}/5 | ${why} |`);
  }
  ix.push('');
  ix.push('## All papers (sorted by AI score, worst first)');
  ix.push('');
  ix.push('| Paper | AI verdict | Score | Blockers | Advisories | Version |');
  ix.push('|---|---|---|---|---|---|');
  const sorted = [...summary].sort((a, b) => a.score - b.score || b.blockers - a.blockers);
  for (const s of sorted) {
    ix.push(`| ${s.id} | ${s.verdict} | ${s.score}/5 | ${s.blockers} | ${s.advisories} | ${s.version} |`);
  }
  writeFileSync(join(outDir, 'index.md'), ix.join('\n'));

  console.log('─'.repeat(80));
  console.log(`Done: ${summary.length} papers bundled.`);
  console.log(`PASS: ${summary.filter(s => s.verdict === 'PASS').length}  NEEDS_WORK: ${summary.filter(s => s.verdict === 'NEEDS_WORK').length}`);
  console.log(`Open ${args.out}/index.md to start.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
