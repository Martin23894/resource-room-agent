// Day-2 spike runner.
//
// Calls generateV2 for the six fixture configurations, writes raw JSON to
// schema/spike-outputs/<name>.json, runs assertResource on each, and prints
// a one-line summary per config plus a short error excerpt on failures.
//
// Usage:
//   node schema/spike-runner.js                    # run all six, sequentially
//   node schema/spike-runner.js g6-english-hl-rtt-t4  # run one
//   PARALLEL=1 node schema/spike-runner.js         # fire all six in parallel
//
// Requires ANTHROPIC_API_KEY in the environment. Outputs are gitignored.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { generateV2 } from '../api/generate-v2.js';
import { assertResource, tallyCogLevels } from './resource.schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'spike-outputs');

const CONFIGS = [
  {
    name: 'g4-maths-test-t1',
    req: { subject: 'Mathematics', grade: 4, term: 1, language: 'English', resourceType: 'Test', totalMarks: 40 },
  },
  {
    name: 'g5-nst-worksheet-t2',
    req: { subject: 'Natural Sciences and Technology', grade: 5, term: 2, language: 'English', resourceType: 'Worksheet', totalMarks: 25 },
  },
  {
    name: 'g6-english-hl-rtt-t4',
    req: { subject: 'English Home Language', grade: 6, term: 4, language: 'English', resourceType: 'Exam', totalMarks: 50 },
  },
  {
    name: 'g7-soc-sci-history-exam-t2',
    req: { subject: 'Social Sciences — History', grade: 7, term: 2, language: 'English', resourceType: 'Exam', totalMarks: 25 },
  },
  {
    name: 'g7-ems-final-exam',
    req: { subject: 'Economic and Management Sciences', grade: 7, term: 4, language: 'English', resourceType: 'Final Exam', totalMarks: 25 },
  },
  {
    name: 'g5-afrikaans-hl-rtt-t2',
    req: { subject: 'Afrikaans Home Language', grade: 5, term: 2, language: 'Afrikaans', resourceType: 'Exam', totalMarks: 20 },
  },
];

function summarise(name, result, t0) {
  const ms = Date.now() - t0;
  const { resource, validation, rebalance, ctx } = result;
  const leafCount = countLeaves(resource);
  const leafSum = leafSumMarks(resource);
  const sectionCount = (resource.sections || []).length;
  const stimulusCount = (resource.stimuli || []).length;
  const tally = tallyCogLevels(resource);
  const cogStr = ctx.cognitiveLevelNames
    .map((n) => `${n.split(' ')[0]}=${tally[n] || 0}/${ctx.cogLevels.find((l) => l.name === n).prescribedMarks}`)
    .join(' ');

  const status = validation.ok ? 'OK   ' : 'FAIL ';
  const rebalanceStr = rebalance && rebalance.adjustments.length > 0
    ? ` rebalance=${rebalance.adjustments.length}nudges`
    : '';
  console.log(
    `${status} ${name.padEnd(30)} sections=${sectionCount} stimuli=${stimulusCount} leaves=${leafCount} sum=${leafSum}/${ctx.totalMarks} ${cogStr}${rebalanceStr}  (${ms}ms)`,
  );
  if (rebalance && rebalance.adjustments.length > 0) {
    for (const a of rebalance.adjustments) {
      console.log(`        ↳ rebalance ${a.questionNumber} (${a.level}): ${a.before}→${a.after}`);
    }
  }
  if (!validation.ok) {
    for (const e of validation.errors.slice(0, 8)) {
      console.log(`        ↳ ${e.path}: ${e.message}`);
    }
    if (validation.errors.length > 8) {
      console.log(`        ↳ … and ${validation.errors.length - 8} more`);
    }
  }
}

function countLeaves(resource) {
  let n = 0;
  const walk = (q) => {
    if (Array.isArray(q.subQuestions)) q.subQuestions.forEach(walk);
    else n++;
  };
  for (const s of resource.sections || []) for (const q of s.questions || []) walk(q);
  return n;
}

function leafSumMarks(resource) {
  let n = 0;
  const walk = (q) => {
    if (Array.isArray(q.subQuestions)) q.subQuestions.forEach(walk);
    else n += q.marks || 0;
  };
  for (const s of resource.sections || []) for (const q of s.questions || []) walk(q);
  return n;
}

async function runOne(cfg) {
  const t0 = Date.now();
  try {
    const result = await generateV2(cfg.req);
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${cfg.name}.json`), JSON.stringify(result.resource, null, 2));
    summarise(cfg.name, result, t0);
    return { ok: result.validation.ok };
  } catch (err) {
    const ms = Date.now() - t0;
    console.log(`ERROR ${cfg.name.padEnd(30)} (${ms}ms) ${err.message}`);
    if (err.stack) console.log(err.stack.split('\n').slice(0, 3).join('\n'));
    return { ok: false };
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set — cannot run the spike.');
    process.exit(1);
  }

  const filter = process.argv[2];
  const targets = filter ? CONFIGS.filter((c) => c.name === filter) : CONFIGS;
  if (filter && targets.length === 0) {
    console.error(`No config named "${filter}". Available: ${CONFIGS.map((c) => c.name).join(', ')}`);
    process.exit(1);
  }

  const parallel = process.env.PARALLEL === '1';
  console.log(`Spike runner — ${targets.length} config(s), ${parallel ? 'parallel' : 'sequential'}`);
  console.log('─'.repeat(80));

  const results = parallel
    ? await Promise.all(targets.map(runOne))
    : await targets.reduce(async (acc, c) => [...(await acc), await runOne(c)], Promise.resolve([]));

  const okCount = results.filter((r) => r.ok).length;
  console.log('─'.repeat(80));
  console.log(`Done: ${okCount}/${results.length} schema-valid. Raw JSON in schema/spike-outputs/.`);
  if (okCount < results.length) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
