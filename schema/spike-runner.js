// v2 pipeline test runner.
//
// Iterates the test matrix (schema/test-matrix.js), calls generate on
// each filtered case, writes the JSON output and renders the DOCX. One
// folder per grade so review is tractable: schema/spike-outputs/g4/ etc.
//
// Usage:
//   node schema/spike-runner.js --grade 4 --tier core
//   node schema/spike-runner.js --grade 4 --subject mathematics
//   node schema/spike-runner.js --tier core              # all grades, core only
//   node schema/spike-runner.js --dry-run                # print plan, no API spend
//   node schema/spike-runner.js --samples 2 --grade 7    # two samples per combo
//
// Flags:
//   --grade N           filter by grade (4/5/6/7)
//   --subject SUBSTR    case-insensitive substring match on subject name
//   --tier core|expansion|all   (default: core)
//   --resource TYPE     filter by resource type (Test, Exam, Final Exam, Worksheet)
//   --language LANG     filter by language (English, Afrikaans)
//   --samples N         samples per combo (default: 1)
//   --dry-run           list what would run, no API calls
//   --parallel          fire all calls concurrently (default: sequential)
//   --bypass-cache      pass _bypassCache through to generate
//
// Requires ANTHROPIC_API_KEY in the environment unless --dry-run.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Packer } from 'docx';

import { generate } from '../api/generate.js';
import { renderResource } from '../lib/render.js';
import { assertResource, tallyCogLevels } from './resource.schema.js';
import { TEST_MATRIX, filterMatrix, filterCases, estimateCost, buildAllTermsMatrix } from './test-matrix.js';
import { ATP, EXAM_SCOPE } from '../lib/atp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'spike-outputs');

function parseArgs(argv) {
  const args = {
    tier: 'core', samples: 1, parallel: false, dryRun: false,
    bypassCache: false, allTerms: false, skipExisting: false, concurrency: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--grade')        args.grade = Number(argv[++i]);
    else if (a === '--subject') args.subject = argv[++i];
    else if (a === '--tier')    args.tier = argv[++i];
    else if (a === '--resource') args.resourceType = argv[++i];
    else if (a === '--language') args.language = argv[++i];
    else if (a === '--samples') args.samples = Number(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--parallel') args.parallel = true;
    else if (a === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (a === '--bypass-cache') args.bypassCache = true;
    else if (a === '--all-terms') args.allTerms = true;
    else if (a === '--skip-existing') args.skipExisting = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error(`Unknown flag: ${a}`); process.exit(1); }
  }
  return args;
}

function printHelp() {
  console.log(`
Usage: node schema/spike-runner.js [flags]

Filter flags (combine to narrow the matrix):
  --grade N             4 / 5 / 6 / 7
  --subject SUBSTR      case-insensitive substring match
  --tier T              core (default) / expansion / all
  --resource TYPE       Test / Exam / Final Exam / Worksheet
  --language LANG       English / Afrikaans

Matrix flags:
  --all-terms           sweep every (grade × subject × term) cell, English,
                        one resource per cell. Resource type per term:
                        Test for T1/T3, Exam for T2/T4, Worksheet for Life
                        Skills/LO, Final Exam for G7 EMS T4.

Run flags:
  --samples N           samples per combo (default 1)
  --parallel            fire all calls concurrently
  --bypass-cache        ignore any cached responses
  --dry-run             list what would run, no API calls

Examples:
  node schema/spike-runner.js --grade 4 --tier core
  node schema/spike-runner.js --tier core --parallel
  node schema/spike-runner.js --all-terms --dry-run
  node schema/spike-runner.js --all-terms --parallel
`);
}

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
    `${status} ${name.padEnd(56)} sections=${sectionCount} stimuli=${stimulusCount} leaves=${leafCount} sum=${leafSum}/${ctx.totalMarks} ${cogStr}${rebalanceStr}  (${ms}ms)`,
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

// Bounded-parallel executor — runs at most `concurrency` tasks at a time.
// Preserves the input order in the returned results array.
async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function pump() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => pump()));
  return results;
}

async function runOne(testCase, sampleIndex, totalSamples, args) {
  const t0 = Date.now();
  const grade = testCase.grade;
  const sampleSuffix = totalSamples > 1 ? `-sample${sampleIndex + 1}` : '';
  const outName = `${testCase.id}${sampleSuffix}`;
  const outDir = join(OUT_DIR, `g${grade}`);

  try {
    const result = await generate({ ...testCase.request, _bypassCache: args.bypassCache });
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${outName}.json`), JSON.stringify(result.resource, null, 2));

    if (result.validation.ok) {
      const doc = renderResource(result.resource);
      const buf = await Packer.toBuffer(doc);
      writeFileSync(join(outDir, `${outName}.docx`), buf);
    }

    summarise(outName, result, t0);
    return { ok: result.validation.ok, id: testCase.id };
  } catch (err) {
    const ms = Date.now() - t0;
    console.log(`ERROR ${outName.padEnd(56)} (${ms}ms) ${err.message}`);
    return { ok: false, id: testCase.id, error: err.message };
  }
}

// CAPS scope expansion: which ATP terms a (resourceType, term) cell pulls from.
// Mirrors topicScopeFor() in api/generate.js so the runner can pre-check that
// the resulting topic list is non-empty without booting the generate pipeline.
function coversTermsFor(resourceType, term) {
  if (resourceType === 'Final Exam') return [1, 2, 3, 4];
  if (resourceType === 'Exam')       return EXAM_SCOPE[term] || [term];
  return [term];
}

function hasAnyAtpTopics(subject, grade, resourceType, term) {
  const terms = coversTermsFor(resourceType, term);
  return terms.some((t) => (ATP[subject]?.[grade]?.[t] || []).length > 0);
}

async function main() {
  const args = parseArgs(process.argv);
  // --all-terms swaps the source matrix BEFORE filterMatrix runs against it,
  // so --grade / --subject / --tier still narrow the sweep as expected.
  const sourceMatrix = args.allTerms ? buildAllTermsMatrix() : null;
  const cases = sourceMatrix
    ? filterCases(sourceMatrix, args)
    : filterMatrix(args);

  // Pre-check ATP coverage so empty-topic cells are surfaced (and skipped)
  // before any API calls are made. Today this catches nothing — every cell
  // in the matrix has ATP topics — but it's a cheap safety net for future
  // matrix expansions or ATP edits.
  const skipped = [];
  let runnable = cases.filter((c) => {
    if (hasAnyAtpTopics(c.subject, c.grade, c.request.resourceType, c.request.term)) return true;
    skipped.push(c);
    return false;
  });
  if (skipped.length > 0) {
    console.log(`Skipping ${skipped.length} cell(s) with no ATP topics:`);
    for (const c of skipped) {
      console.log(`  - ${c.id}  (${c.subject}, g${c.grade}, t${c.request.term})`);
    }
    console.log('');
  }

  // --skip-existing — drop combos that already have a successful DOCX on
  // disk from a previous run. Lets you retry only the failed/errored cells
  // without re-spending on the ones that succeeded. We check the DOCX
  // (not the JSON) because schema-FAIL cases write a JSON without a DOCX,
  // and those still need to be retried.
  if (args.skipExisting) {
    const before = runnable.length;
    runnable = runnable.filter((c) => {
      const docxPath = join(OUT_DIR, `g${c.grade}`, `${c.id}.docx`);
      return !existsSync(docxPath);
    });
    const skippedExist = before - runnable.length;
    if (skippedExist > 0) {
      console.log(`--skip-existing: ${skippedExist} cell(s) already have a successful DOCX, will not re-run.`);
      console.log('');
    }
  }

  if (runnable.length === 0) {
    console.log('No test cases match the given filters.');
    console.log('Available grades: 4, 5, 6, 7');
    console.log('Try: node schema/spike-runner.js --tier core --grade 4');
    process.exit(1);
  }

  const cost = estimateCost(runnable, args.samples);
  console.log(`Test runner — ${runnable.length} combo(s) × ${args.samples} sample(s) = ${cost.calls} call(s)`);
  console.log(`Estimated cost: ~$${cost.dollars} (Sonnet 4.6 @ ~$0.12/call)`);
  console.log(`Output: schema/spike-outputs/g{grade}/`);
  console.log('─'.repeat(80));

  if (args.dryRun) {
    runnable.forEach((c) => {
      for (let i = 0; i < args.samples; i++) {
        const sfx = args.samples > 1 ? `-sample${i + 1}` : '';
        console.log(`  [${c.tier}] g${c.grade}/${c.id}${sfx}.{json,docx}  →  ${c.subject}, term ${c.request.term}, ${c.request.resourceType} ${c.request.totalMarks}m, ${c.request.language}`);
      }
    });
    console.log('─'.repeat(80));
    console.log('Dry run — no API calls made.');
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set — cannot run.');
    process.exit(1);
  }

  // Build the full task list (case × samples).
  const tasks = [];
  for (const c of runnable) {
    for (let i = 0; i < args.samples; i++) {
      tasks.push({ case: c, sample: i });
    }
  }

  // Bounded parallelism. Anthropic's per-org rate limit (90k output tokens/min,
  // 450k input tokens/min on Sonnet 4.6) is the actual ceiling — Promise.all
  // over 164 tasks tripped it badly in practice. Default concurrency for
  // --parallel is 4, override with --concurrency N.
  const concurrency = args.parallel ? (args.concurrency || 4) : 1;
  console.log(`Concurrency: ${concurrency} ${args.parallel ? '(parallel)' : '(sequential)'}`);
  const results = await runWithConcurrency(tasks, concurrency, (t) => runOne(t.case, t.sample, args.samples, args));

  const okCount = results.filter((r) => r.ok).length;
  console.log('─'.repeat(80));
  console.log(`Done: ${okCount}/${results.length} schema-valid. Output in schema/spike-outputs/.`);
  if (okCount < results.length) {
    console.log('\nFAILED combos:');
    results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.id}${r.error ? ': ' + r.error : ''}`));
    process.exit(2);
  }
  console.log('\nNext: node schema/flag-outputs.js --grade ' + (args.grade || '<n>') + '  to surface outliers.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
