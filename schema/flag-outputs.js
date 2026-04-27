// Auto-flagger for v2 generated outputs.
//
// Walks schema/spike-outputs/g{N}/*.json (or all of them if no --grade
// is given), runs heuristic checks on each Resource, and prints a
// per-paper report with PASS / FLAG markings. The point is to make
// review tractable: read only the FLAG papers, skim the PASS ones.
//
// Heuristics are deliberately conservative — they flag plausibly-bad
// outputs, not certainly-bad ones. A human still decides.
//
// Usage:
//   node schema/flag-outputs.js                 # scan all grades
//   node schema/flag-outputs.js --grade 4       # one grade
//   node schema/flag-outputs.js --strict        # tighter thresholds
//   node schema/flag-outputs.js --json          # machine-readable output

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { tallyCogLevels } from './resource.schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'spike-outputs');

const THRESHOLDS = {
  normal: {
    cogDriftMax: 1,        // marks off prescribed before flagging
    rebalanceMax: 5,       // nudges before flagging high-rebalance
    minStemChars: 12,      // suspiciously short stem (top-level only)
    minMemoChars: 3,       // catches empty/placeholder answers, not legitimate one-word answers
    maxDuplicateStems: 0,  // any duplicate is suspicious
    maxBlankStimuli: 0,    // a stimulus with no body/description
  },
  strict: {
    cogDriftMax: 0,
    rebalanceMax: 3,
    minStemChars: 20,
    minMemoChars: 8,
    maxDuplicateStems: 0,
    maxBlankStimuli: 0,
  },
};

// Answer-space kinds where short memo answers are correct by design
// (MCQ option labels, fill-in-the-blank, math numeric answers).
const SHORT_ANSWER_KINDS = new Set(['options', 'inlineBlank', 'workingPlusAnswer']);

function parseArgs(argv) {
  const args = { strict: false, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--grade')      args.grade = Number(argv[++i]);
    else if (a === '--strict') args.strict = true;
    else if (a === '--json')   args.json = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error(`Unknown flag: ${a}`); process.exit(1); }
  }
  return args;
}

function printHelp() {
  console.log(`
Usage: node schema/flag-outputs.js [flags]

  --grade N    only scan schema/spike-outputs/g{N}/
  --strict     tighter thresholds (drift > 0, fewer nudges, longer stems)
  --json       emit JSON instead of human-readable text
`);
}

function listJsonFiles(grade) {
  const dirs = grade
    ? [join(OUT_DIR, `g${grade}`)]
    : [OUT_DIR, ...readdirSync(OUT_DIR).filter((d) => /^g\d+$/.test(d)).map((d) => join(OUT_DIR, d))];

  const files = [];
  for (const d of dirs) {
    let entries;
    try { entries = readdirSync(d); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith('.json')) continue;
      const full = join(d, f);
      if (statSync(full).isFile()) files.push(full);
    }
  }
  return files;
}

function leafQuestions(resource) {
  const out = [];
  const walk = (q, parent) => {
    if (Array.isArray(q.subQuestions)) q.subQuestions.forEach((sq) => walk(sq, q));
    else out.push({ q, parent });
  };
  for (const s of resource.sections || []) for (const q of s.questions || []) walk(q, null);
  return out;
}

function inspect(resource, thresholds) {
  const flags = [];
  const cog = resource.meta?.cognitiveFramework;
  const tally = tallyCogLevels(resource);
  const totalMarks = resource.meta?.totalMarks || 0;
  const leafEntries = leafQuestions(resource);
  const leaves = leafEntries.map((e) => e.q);
  const memo = resource.memo?.answers || [];
  const leafByNumber = new Map(leafEntries.map((e) => [e.q.number, e]));

  // 1. Cog distribution drift
  if (cog) {
    for (const lvl of cog.levels || []) {
      const actual = tally[lvl.name] || 0;
      const drift = Math.abs(actual - lvl.prescribedMarks);
      if (drift > thresholds.cogDriftMax) {
        flags.push({
          kind: 'cog_drift',
          detail: `${lvl.name}: ${actual}/${lvl.prescribedMarks} (drift ${actual - lvl.prescribedMarks > 0 ? '+' : ''}${actual - lvl.prescribedMarks})`,
        });
      }
    }
  }

  // 2. Leaf-sum vs total (should always match post-rebalance, but verify)
  const leafSum = leaves.reduce((a, q) => a + (q.marks || 0), 0);
  if (leafSum !== totalMarks) {
    flags.push({
      kind: 'mark_sum_drift',
      detail: `leaf sum ${leafSum} ≠ totalMarks ${totalMarks}`,
    });
  }

  // 3. Memo coverage
  const leafNumbers = new Set(leaves.map((q) => q.number));
  const memoNumbers = new Set(memo.map((a) => a.questionNumber));
  const missing = [...leafNumbers].filter((n) => !memoNumbers.has(n));
  const extra = [...memoNumbers].filter((n) => !leafNumbers.has(n));
  if (missing.length) flags.push({ kind: 'memo_missing', detail: missing.join(', ') });
  if (extra.length)   flags.push({ kind: 'memo_extra',   detail: extra.join(', ') });

  // 4. Suspicious stem lengths — only flag when the parent is NOT a
  // composite. Match-up sub-questions like Q12.2 stem='Limpopo' are
  // valid: the parent stem ('Match each province...') provides context.
  const shortStems = leafEntries.filter(({ q, parent }) => {
    if (parent) return false; // sub-question of a composite — context lives in parent
    return (q.stem || '').trim().length < thresholds.minStemChars;
  }).map((e) => e.q);
  if (shortStems.length) {
    flags.push({
      kind: 'short_stem',
      detail: `${shortStems.length} top-level stem(s) under ${thresholds.minStemChars} chars: ${shortStems.slice(0, 3).map((q) => q.number).join(', ')}${shortStems.length > 3 ? ', …' : ''}`,
    });
  }

  // 5. Suspicious memo answer lengths — skip MCQ ('options') and
  // 'inlineBlank' answer spaces where short answers are correct
  // (e.g. 'b) 62', '4', 'Limpopo').
  const shortMemos = memo.filter((a) => {
    if ((a.answer || '').trim().length >= thresholds.minMemoChars) return false;
    const entry = leafByNumber.get(a.questionNumber);
    const kind = entry?.q?.answerSpace?.kind;
    if (SHORT_ANSWER_KINDS.has(kind)) return false;
    return true;
  });
  if (shortMemos.length) {
    flags.push({
      kind: 'short_memo',
      detail: `${shortMemos.length} non-MCQ memo answer(s) under ${thresholds.minMemoChars} chars: ${shortMemos.slice(0, 3).map((a) => a.questionNumber).join(', ')}${shortMemos.length > 3 ? ', …' : ''}`,
    });
  }

  // 6. Duplicate stems (case + whitespace insensitive)
  const stemMap = new Map();
  for (const q of leaves) {
    const norm = (q.stem || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!norm) continue;
    if (!stemMap.has(norm)) stemMap.set(norm, []);
    stemMap.get(norm).push(q.number);
  }
  const dups = [...stemMap.values()].filter((arr) => arr.length > 1);
  if (dups.length > thresholds.maxDuplicateStems) {
    flags.push({
      kind: 'duplicate_stem',
      detail: dups.map((arr) => arr.join(' ≡ ')).slice(0, 3).join(' / '),
    });
  }

  // 7. Blank stimuli (declared but no content). dataSet stimuli store
  // rows under .table.rows, not .rows — check both shapes.
  const blanks = (resource.stimuli || []).filter((s) => {
    if (s.body && s.body.trim()) return false;
    if (s.description && s.description.trim()) return false;
    if (s.rows && s.rows.length) return false;
    if (s.table?.rows?.length) return false;
    return true;
  });
  if (blanks.length > thresholds.maxBlankStimuli) {
    flags.push({
      kind: 'blank_stimulus',
      detail: blanks.map((s) => s.id).join(', '),
    });
  }

  // 8. No memo at all
  if (memo.length === 0 && leaves.length > 0) {
    flags.push({ kind: 'no_memo', detail: `${leaves.length} leaves but memo is empty` });
  }

  return { flags, stats: { totalMarks, leaves: leaves.length, memo: memo.length, tally, leafSum } };
}

function formatHuman(reports) {
  const passed = reports.filter((r) => r.flags.length === 0);
  const flagged = reports.filter((r) => r.flags.length > 0);

  console.log('═'.repeat(80));
  console.log(`Flag scan — ${reports.length} paper(s)  |  PASS ${passed.length}  |  FLAG ${flagged.length}`);
  console.log('═'.repeat(80));

  if (flagged.length) {
    console.log('\nFLAGGED (review these):');
    for (const r of flagged) {
      console.log(`\n  ⚠  ${r.file}`);
      console.log(`     ${r.stats.leaves} leaves, ${r.stats.totalMarks} marks, leaf sum ${r.stats.leafSum}`);
      for (const f of r.flags) {
        console.log(`     • ${f.kind}: ${f.detail}`);
      }
    }
  }

  if (passed.length) {
    console.log('\nPASSED (skim only if curious):');
    for (const r of passed) {
      console.log(`  ✓  ${r.file}`);
    }
  }

  console.log('\n' + '═'.repeat(80));
  if (flagged.length === 0) console.log('All papers passed the flag scan. Spot-check a few before shipping.');
  else console.log(`${flagged.length} paper(s) flagged. Review the JSON or DOCX next to each.`);
}

function main() {
  const args = parseArgs(process.argv);
  const thresholds = args.strict ? THRESHOLDS.strict : THRESHOLDS.normal;
  const files = listJsonFiles(args.grade);

  if (files.length === 0) {
    console.error(`No JSON outputs found${args.grade ? ` for grade ${args.grade}` : ''} in ${OUT_DIR}/.`);
    console.error('Run the spike runner first:  node schema/spike-runner.js --grade ' + (args.grade || '<n>') + ' --tier core');
    process.exit(1);
  }

  const reports = files.map((file) => {
    let resource;
    try { resource = JSON.parse(readFileSync(file, 'utf8')); }
    catch (e) { return { file, flags: [{ kind: 'parse_error', detail: e.message }], stats: {} }; }
    const { flags, stats } = inspect(resource, thresholds);
    return { file: file.replace(OUT_DIR + '/', ''), flags, stats };
  });

  if (args.json) {
    console.log(JSON.stringify({ thresholds: args.strict ? 'strict' : 'normal', reports }, null, 2));
  } else {
    formatHuman(reports);
  }

  // Exit code so CI / scripts can branch on it.
  const flaggedCount = reports.filter((r) => r.flags.length > 0).length;
  if (flaggedCount > 0) process.exit(2);
}

main();
