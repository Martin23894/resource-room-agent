// Pre-delivery invariant runner.
//
// The pipeline (api/generate.js) calls runPreDeliveryGate() as the LAST
// step before cacheSet() / quota-decrement / sendResult(). The gate runs
// every registered invariant against the final paper + memo + plan and
// reports failures. The orchestrator decides what to do based on each
// failure's category:
//
//   AUTO_FIX    — has a deterministic fixer already applied before the
//                 gate runs: shuffleMcqLabels, stripPhantomMemoRows,
//                 repairMemoMarks (lib/auto-fix.js), or
//                 ensureSequentialSectionLetters (pipeline). A gate
//                 failure here means the fixer itself has a bug.
//   REGENERATE  — needs another Claude call with corrective feedback to
//                 fix. The regeneration plumbing (lib/regenerate.js,
//                 not yet wired) reads `feedback` off the failure and
//                 reissues the relevant phase up to a cap.
//   DEV_ONLY    — subjective / aggregate metric, runs in the fuzz
//                 dashboard. Never blocks teacher delivery.
//
// Modes:
//   report  — collect failures, log loud, ship the paper anyway.
//             Used while regeneration plumbing is incomplete so the
//             gate gives us telemetry without behaviorally changing
//             teacher output.
//   enforce — block delivery on any non-DEV_ONLY failure. Throws an
//             InvariantGateError, which the API handler converts to
//             HTTP 500 with a clear "couldn't generate a valid paper"
//             message. cacheSet() and quota decrement MUST run only
//             after the gate returns passed=true so failed regen
//             attempts cost us API spend but never the teacher's quota.
//
// The mode is read from the INVARIANT_GATE_MODE env var at gate-call
// time, defaulting to 'report'. Per-call override available via opts.

import { countMarks } from './marks.js';
import { hasAnswerTable, hasCogAnalysis, countAnswerTableRows } from './memo-structure.js';
import { ensureSequentialSectionLetters } from './sections.js';
import { parseMemoAnswerRows, tallyByLevel } from './cog-table.js';
import { verifyCogBalance } from './cog-balance.js';

export const CATEGORIES = Object.freeze({
  AUTO_FIX: 'AUTO_FIX',
  REGENERATE: 'REGENERATE',
  DEV_ONLY: 'DEV_ONLY',
});

export const SCOPES = Object.freeze({
  PLAN: 'plan',
  PAPER: 'paper',
  MEMO: 'memo',
});

export class InvariantGateError extends Error {
  constructor({ failures, attempts = 1 }) {
    const ids = failures.map((f) => f.id).join(', ');
    super(`Invariant gate blocked delivery after ${attempts} attempt(s): ${ids}`);
    this.name = 'InvariantGateError';
    this.code = 'INVARIANT_GATE_BLOCKED';
    this.status = 500;
    this.failures = failures;
    this.attempts = attempts;
  }
}

// ============================================================
// REGISTRY — populated below by INVARIANTS_AUTO_FIX, _REGENERATE, _DEV_ONLY
// ============================================================
// Each invariant has shape:
//   {
//     id:        string  — stable identifier matching the design doc
//     category:  one of CATEGORIES
//     scope:     one of SCOPES (which artefact the failure points to)
//     check:     (ctx) => null | { message, ...details }
//                  null  → pass
//                  obj   → fail; `feedback` (if present) is the corrective
//                          string that will be sent to the regeneration
//                          prompt by lib/regenerate.js (Step 2).
//   }
//
// ctx shape (built by buildInvariantContext below):
//   {
//     paper:        string  — final question paper text
//     memo:         string  — final memorandum text
//     plan:         object  — validated plan (planContext)
//     language:     string  — 'English' | 'Afrikaans'
//     subject:      string
//     resourceType: string
//     totalMarks:   number  — cover-page total
//     cog:          { levels, pcts }
//     cogMarks:     number[]  — prescribed marks per level
//     cogTolerance: number
//     pipeline:     'standard' | 'rtt'  — some checks scope by pipeline
//   }

export const INVARIANTS = [];

function register(invariant) {
  if (!invariant.id) throw new Error('invariant requires id');
  if (!Object.values(CATEGORIES).includes(invariant.category)) {
    throw new Error(`invariant ${invariant.id}: bad category ${invariant.category}`);
  }
  if (INVARIANTS.some((i) => i.id === invariant.id)) {
    throw new Error(`invariant ${invariant.id}: duplicate registration`);
  }
  INVARIANTS.push(invariant);
}

// ============================================================
// CONTEXT BUILDER
// ============================================================
export function buildInvariantContext({
  paper, memo, plan, language, subject, resourceType,
  totalMarks, cog, cogMarks, cogTolerance, pipeline, grade,
}) {
  return {
    paper:        typeof paper === 'string' ? paper : '',
    memo:         typeof memo === 'string' ? memo : '',
    plan:         plan || { questions: [] },
    language:     language || 'English',
    subject:      subject || '',
    resourceType: resourceType || '',
    totalMarks:   Number.isFinite(totalMarks) ? totalMarks : 0,
    cog:          cog || { levels: [], pcts: [] },
    cogMarks:     Array.isArray(cogMarks) ? cogMarks : [],
    cogTolerance: Number.isFinite(cogTolerance) ? cogTolerance : 1,
    pipeline:     pipeline || 'standard',
    // grade is optional (used by lib/regenerate.js prompt builders).
    // We pass it through unchanged when present so downstream prompts
    // can render "Grade 4 Mathematics …" without re-plumbing the API.
    grade:        grade ?? null,
  };
}

// ============================================================
// RUNNER
// ============================================================
/**
 * Run every registered invariant against ctx and return the failures.
 *
 * @param {object} ctx — buildInvariantContext result
 * @param {object} [opts]
 * @param {string[]} [opts.skipIds]  — invariant ids to skip (e.g. for fuzz
 *                                     runs that disable an irrelevant check)
 * @param {string[]} [opts.onlyCategories] — restrict to these categories
 * @param {object}   [opts.logger] — pino logger; per-invariant errors are
 *                                   logged at warn level with id + message
 * @returns {Array<{id, category, scope, message, ...}>}
 */
export function runInvariants(ctx, opts = {}) {
  const { skipIds = [], onlyCategories = null, logger = null } = opts;
  const skipSet = new Set(skipIds);
  const failures = [];
  for (const inv of INVARIANTS) {
    if (skipSet.has(inv.id)) continue;
    if (onlyCategories && !onlyCategories.includes(inv.category)) continue;
    let result;
    try {
      result = inv.check(ctx);
    } catch (err) {
      // A bug in a check must not poison the rest of the gate. Surface
      // it as a synthetic failure so we get a loud signal in logs but
      // the gate still inspects every other invariant.
      result = {
        message: `invariant check threw: ${err?.message || err}`,
        error: true,
      };
      if (logger) logger.warn({ id: inv.id, err: err?.message }, 'invariant check threw');
    }
    if (result) {
      failures.push({
        id:              inv.id,
        category:        inv.category,
        scope:           inv.scope,
        regeneratePhase: inv.regeneratePhase || null,
        ...result,
      });
    }
  }
  return failures;
}

/**
 * Pre-delivery gate orchestrator.
 *
 * Called after all phase-specific corrections have run. Returns
 *   { passed: boolean, failures: [...], blocking: [...] }
 *
 * In 'enforce' mode, throws InvariantGateError when any blocking
 * (= non-DEV_ONLY) failure exists. The caller MUST gate cacheSet()
 * and the quota-decrement on `passed === true` so failed-regeneration
 * attempts never consume the teacher's monthly allowance.
 *
 * @param {object} ctx
 * @param {object} [opts]
 * @param {'report'|'enforce'} [opts.mode] — overrides INVARIANT_GATE_MODE env
 * @param {object} [opts.logger]           — pino logger
 * @param {number} [opts.attempts]         — for enforce mode error reporting
 * @param {string[]} [opts.skipIds]
 */
export function runPreDeliveryGate(ctx, opts = {}) {
  const mode = opts.mode || process.env.INVARIANT_GATE_MODE || 'report';
  const logger = opts.logger || null;

  const failures = runInvariants(ctx, { logger, skipIds: opts.skipIds });
  const blocking = failures.filter((f) => f.category !== CATEGORIES.DEV_ONLY);

  if (logger) {
    if (failures.length > 0) {
      logger.warn(
        {
          mode,
          total: failures.length,
          blocking: blocking.length,
          ids: failures.map((f) => f.id),
        },
        'Pre-delivery invariant gate: failures detected',
      );
    } else {
      logger.info('Pre-delivery invariant gate: clean');
    }
  }

  if (blocking.length > 0 && mode === 'enforce') {
    throw new InvariantGateError({
      failures: blocking,
      attempts: opts.attempts || 1,
    });
  }

  return {
    passed: blocking.length === 0,
    mode,
    failures,
    blocking,
  };
}

// Helpers used by checks below ───────────────────────────────────────────────

// SUBQ_LINE: matches a learner-paper sub-question line.
// Mirrors lib/cog-balance.js (kept local so this module stays self-contained).
const SUBQ_LINE = /^\s*(\d+(?:\.\d+)*(?:[a-z])?)\s+.*\((\d+)\)\s*$/;

const SECTION_HEADER = /^(\s*)(SECTION|AFDELING)\s+([A-Z])\b/i;

// Block-total form: `[N]` alone on its own line at the end of a section.
// Line-anchored (m flag + ^ + $) so that `[N]` embedded in section headers
// like "SECTION D: LANGUAGE STRUCTURES [15]" is NOT counted — that was
// causing double-counting false positives against the cover total.
const SECTION_BLOCK_TOTAL = /^\s*\[(\d+)\]\s*$/gm;

// MCQ option detection — narrow a-d only (lib/answer-space.js HAS_MCQ_OPTION).
const MCQ_OPTION_LINE = /^\s*([a-dA-D])[.)]\s+(.+)$/;

// Used by no_orphan_subquestions: a "parent" question header like "1." / "Q1."
// without a sub-numbered child below it.
const PARENT_HEADER = /^\s*(?:Q\s*)?(\d+)\.\s+\S/;

// Helper: split paper into sections keyed by header letter (or '_' if no header)
function splitIntoSections(paper) {
  const lines = paper.split('\n');
  const sections = [];
  let cur = { letter: '_', start: 0, lines: [] };
  for (let i = 0; i < lines.length; i++) {
    const m = SECTION_HEADER.exec(lines[i]);
    if (m) {
      if (cur.lines.length > 0) sections.push(cur);
      cur = { letter: m[3].toUpperCase(), start: i, lines: [lines[i]] };
    } else {
      cur.lines.push(lines[i]);
    }
  }
  if (cur.lines.length > 0) sections.push(cur);
  return sections;
}

// Re-export internals so the AUTO_FIX/REGENERATE chunks below can reach them.
export const _internal = {
  SUBQ_LINE,
  SECTION_HEADER,
  SECTION_BLOCK_TOTAL,
  MCQ_OPTION_LINE,
  PARENT_HEADER,
  splitIntoSections,
  register,
};

// Some sections (e.g. Afrikaans opsomming / holistic summary tasks) carry
// only a standalone [N] block total with no per-line (N) marks.
// countMarks misses these when total>0 because the [N] fallback only fires
// when total===0. This helper adds up block totals for any section that has
// NO per-line marks, so cover_eq_body can correctly supplement its count.
function supplementWithBlockOnlySections(paper) {
  const lines = paper.split('\n');
  const PER_ITEM_LOCAL = /\(\d+\)\s*$/;
  const STANDALONE_BLOCK_LOCAL = /^\s*\[(\d+)\]\s*$/;

  const bounds = [];
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_HEADER.test(lines[i])) bounds.push(i);
  }
  if (bounds.length === 0) return 0;
  bounds.push(lines.length);

  let supplement = 0;
  for (let s = 0; s < bounds.length - 1; s++) {
    let hasPerLine = false;
    for (let i = bounds[s]; i < bounds[s + 1]; i++) {
      if (PER_ITEM_LOCAL.test(lines[i])) { hasPerLine = true; break; }
    }
    if (!hasPerLine) {
      for (let i = bounds[s]; i < bounds[s + 1]; i++) {
        const bm = STANDALONE_BLOCK_LOCAL.exec(lines[i]);
        if (bm) { supplement += parseInt(bm[1], 10); break; }
      }
    }
  }
  return supplement;
}

// ══════════════════════════════════════════════════════════════════════════
// MARK ARITHMETIC / STRUCTURE
//
// paper_marks_match_memo_marks → AUTO_FIX (snapped by repairMemoMarks).
// section_letters_sequential   → AUTO_FIX (fixed by ensureSequentialSectionLetters).
// no_phantom_memo_rows, no_phantom_apology_rows → AUTO_FIX (stripPhantomMemoRows).
//
// All others in this section → REGENERATE: no deterministic fixer exists;
// Claude must rewrite the artefact to correct the failure.
// ══════════════════════════════════════════════════════════════════════════

register({
  id: 'cover_eq_body',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'paper',
  scope: SCOPES.PAPER,
  check(ctx) {
    if (!ctx.paper || ctx.totalMarks <= 0) return null;
    let counted = countMarks(ctx.paper);
    if (counted === 0) return null; // no per-line marks parsed; skip
    if (counted === ctx.totalMarks) return null;
    // Supplement with block-only sections before deciding to fire.
    if (counted < ctx.totalMarks) {
      counted += supplementWithBlockOnlySections(ctx.paper);
      if (counted === ctx.totalMarks) return null;
    }
    return {
      message: `body marks ${counted} ≠ cover total ${ctx.totalMarks} (drift ${counted - ctx.totalMarks})`,
      counted,
      cover: ctx.totalMarks,
      drift: counted - ctx.totalMarks,
      feedback: `The paper body sums to ${counted} marks but the cover requires exactly ${ctx.totalMarks}. Adjust the minimum number of (X) values to land at exactly ${ctx.totalMarks}.`,
    };
  },
});

register({
  id: 'footer_matches_cover',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'paper',
  scope: SCOPES.PAPER,
  check(ctx) {
    if (!ctx.paper || ctx.totalMarks <= 0) return null;
    // Match the final TOTAL/TOTAAL line: `TOTAL: 50 marks` / `TOTAAL: 50 punte`
    // We accept the line anywhere in the last 30 non-blank lines.
    const lines = ctx.paper.split('\n').map((l) => l.trim()).filter(Boolean);
    const tail = lines.slice(-30);
    // Matches plain "TOTAL: 50 marks" and score-box "TOTAAL: _____ / 50 punte".
    // The _{2,}[^/]*/\s* arm handles the teacher fill-in template form.
    const TOTAL_RE = /^(TOTAL|TOTAAL|TOTALE)\s*:?\s*(?:_{2,}[^/]*\/\s*)?(\d+)\b/i;
    let found = null;
    for (let i = tail.length - 1; i >= 0; i--) {
      const m = TOTAL_RE.exec(tail[i]);
      if (m) { found = parseInt(m[2], 10); break; }
    }
    if (found === null) {
      return {
        message: 'no TOTAL/TOTAAL footer line found in last 30 lines',
        feedback: `End the paper with a "TOTAL: ${ctx.totalMarks} marks" (or "TOTAAL: ${ctx.totalMarks} punte") line.`,
      };
    }
    if (found !== ctx.totalMarks) {
      return {
        message: `footer TOTAL ${found} ≠ cover ${ctx.totalMarks}`,
        footer: found,
        cover: ctx.totalMarks,
        feedback: `The footer TOTAL line shows ${found} but the paper must total ${ctx.totalMarks}.`,
      };
    }
    return null;
  },
});

register({
  id: 'section_brackets_sum_to_total',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'paper',
  scope: SCOPES.PAPER,
  check(ctx) {
    if (!ctx.paper || ctx.totalMarks <= 0) return null;
    // Each section ends with [N] block total. Sum these across the paper.
    // If there are no [N] block totals (some Worksheet formats), skip.
    let sum = 0;
    let count = 0;
    SECTION_BLOCK_TOTAL.lastIndex = 0;
    let m;
    while ((m = SECTION_BLOCK_TOTAL.exec(ctx.paper)) !== null) {
      sum += parseInt(m[1], 10);
      count++;
    }
    if (count === 0) return null;
    if (sum === ctx.totalMarks) return null;
    return {
      message: `section [N] block totals sum to ${sum} ≠ cover ${ctx.totalMarks}`,
      sum,
      cover: ctx.totalMarks,
      blockCount: count,
      feedback: `The section [N] block totals sum to ${sum} but must sum to ${ctx.totalMarks}.`,
    };
  },
});

register({
  id: 'paper_marks_match_memo_marks',
  category: CATEGORIES.AUTO_FIX,
  regeneratePhase: 'memo',
  scope: SCOPES.MEMO,
  check(ctx) {
    if (!ctx.paper || !ctx.memo) return null;
    const paperCount = countMarks(ctx.paper);
    if (paperCount === 0) return null;
    const memoRows = parseMemoAnswerRows(ctx.memo);
    if (memoRows.length === 0) return null; // covered by memo_has_answer_table
    const memoSum = memoRows.reduce((s, r) => s + (Number.isFinite(r.mark) ? r.mark : 0), 0);
    if (memoSum === paperCount) return null;
    return {
      message: `memo answer-table marks ${memoSum} ≠ paper body ${paperCount}`,
      memoSum,
      paperCount,
      feedback: `The memo answer table sums to ${memoSum} marks but the paper body has ${paperCount}. Re-emit the memo so each answer row's mark matches its paper sub-question.`,
    };
  },
});

register({
  id: 'cog_table_total_eq_actual_sum',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'memo',
  scope: SCOPES.MEMO,
  check(ctx) {
    if (!ctx.memo) return null;
    // Find the cog analysis table and check that the TOTAL row's Actual cell
    // equals the sum of the per-level Actual cells.
    //
    // Row shape: `| Knowledge | 30% | 15 | 14 | 28.0% |`
    //            `| TOTAL | 100% | 50 | 47 | 94.0% |`
    const rowRe = /^\s*\|\s*([^|]+?)\s*\|\s*\d+%?\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*[\d.]+%?\s*\|\s*$/gm;
    let m;
    let perLevelSum = 0;
    let totalRowActual = null;
    while ((m = rowRe.exec(ctx.memo)) !== null) {
      const label = m[1].trim();
      const actual = parseInt(m[3], 10);
      if (/^TOTAL$/i.test(label) || /^TOTAAL$/i.test(label) || /^TOTALE$/i.test(label)) {
        totalRowActual = actual;
      } else {
        perLevelSum += actual;
      }
    }
    if (totalRowActual === null) return null; // no cog table found, separate check covers it
    if (totalRowActual === perLevelSum) return null;
    return {
      message: `cog-table TOTAL Actual ${totalRowActual} ≠ sum of per-level Actuals ${perLevelSum}`,
      totalRowActual,
      perLevelSum,
      feedback: `The cognitive analysis TOTAL row's Actual marks should be the sum of the per-level Actual marks (${perLevelSum}), not ${totalRowActual}.`,
    };
  },
});

register({
  id: 'cog_breakdown_actuals',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'memo',
  scope: SCOPES.MEMO,
  check(ctx) {
    if (!ctx.memo || !ctx.cog || !ctx.cog.levels?.length) return null;
    // Tally memo answer rows by cognitive level and compare to the
    // cog-analysis table's "Actual Marks" cell for each level.
    const rows = parseMemoAnswerRows(ctx.memo);
    if (rows.length === 0) return null;
    const tallied = tallyByLevel(rows); // Map(label → marks)

    // Parse the per-level rows from the cog table.
    const rowRe = /^\s*\|\s*([^|]+?)\s*\|\s*\d+%?\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*[\d.]+%?\s*\|\s*$/gm;
    let m;
    const cogTableActuals = new Map();
    while ((m = rowRe.exec(ctx.memo)) !== null) {
      const label = m[1].trim();
      if (/^(TOTAL|TOTAAL|TOTALE)$/i.test(label)) continue;
      cogTableActuals.set(label.toLowerCase(), parseInt(m[3], 10));
    }
    if (cogTableActuals.size === 0) return null;

    const mismatches = [];
    for (const [tableLabel, tableActual] of cogTableActuals) {
      // Find the matching tally entry case-insensitively.
      let tallySum = 0;
      for (const [tallyLabel, marks] of tallied) {
        if (String(tallyLabel).toLowerCase() === tableLabel) {
          tallySum = marks;
          break;
        }
      }
      if (tallySum !== tableActual) {
        mismatches.push({ level: tableLabel, table: tableActual, fromRows: tallySum });
      }
    }
    if (mismatches.length === 0) return null;
    return {
      message: `cog-table per-level Actual cells disagree with answer-table tally for ${mismatches.length} level(s)`,
      mismatches,
      feedback: `The cognitive analysis table's "Actual Marks" cells must equal the sum of the answer-table rows for each level. Mismatches: ${JSON.stringify(mismatches)}.`,
    };
  },
});

register({
  id: 'no_orphan_subquestions',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'paper',
  scope: SCOPES.PAPER,
  check(ctx) {
    if (!ctx.paper) return null;
    // Detect a parent header like "Q1." or "1." that has no sub-numbered
    // child. Only meaningful for non-Worksheet papers; Worksheets often use
    // bare "Question 1" headers with no sub-numbering. Skip when no
    // parent headers are found.
    const lines = ctx.paper.split('\n');
    const parents = new Map(); // parentNum → boolean(has-child)
    for (const line of lines) {
      const p = PARENT_HEADER.exec(line);
      if (p) {
        const n = p[1];
        if (!parents.has(n)) parents.set(n, false);
      }
      const sm = SUBQ_LINE.exec(line);
      if (sm) {
        const root = sm[1].split('.')[0];
        if (parents.has(root)) parents.set(root, true);
      }
    }
    const orphans = [...parents.entries()].filter(([, has]) => !has).map(([n]) => n);
    if (orphans.length === 0) return null;
    // Tolerate orphans when the parent itself ends with (X) — that means
    // it's a single-shot question, not a parent expecting children.
    const realOrphans = orphans.filter((n) => {
      for (const line of lines) {
        const p = PARENT_HEADER.exec(line);
        if (p && p[1] === n) {
          if (/\(\d+\)\s*$/.test(line)) return false;
        }
      }
      return true;
    });
    if (realOrphans.length === 0) return null;
    return {
      message: `parent question(s) with no sub-questions: ${realOrphans.join(', ')}`,
      orphans: realOrphans,
      feedback: `Question ${realOrphans.join(', ')} has no sub-parts and no own (X) mark — either give it sub-questions (1.1, 1.2, …) or a direct mark.`,
    };
  },
});

register({
  id: 'parent_no_double_mark',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'paper',
  scope: SCOPES.PAPER,
  check(ctx) {
    if (!ctx.paper) return null;
    // A parent line "12.2 Old system. (4)" with sub-parts (a) (1) + (b) (3)
    // double-counts unless countMarks already strips it. The detector
    // mirrors lib/marks.js isParentSummaryLine — if it strips ANY parent
    // marks, the paper is at risk of presenting double-mark UI to the
    // teacher. We surface that so the prompt can be tightened.
    const lines = ctx.paper.split('\n');
    const PER_ITEM = /\((\d+)\)\s*$/;
    const NUMBERED = /^\s*\d+(?:\.\d+)*\s/;
    const LETTERED_SUB = /^\s*\([a-z]\)\s.*\(\d+\)\s*$/i;
    const offenders = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!PER_ITEM.test(line) || !NUMBERED.test(line)) continue;
      // scan ahead 6 lines
      let scanned = 0;
      for (let j = i + 1; j < lines.length && scanned < 6; j++) {
        const tr = lines[j].trim();
        if (tr === '') continue;
        scanned++;
        if (NUMBERED.test(tr)) break;
        if (LETTERED_SUB.test(lines[j])) {
          offenders.push(line.trim().slice(0, 60));
          break;
        }
      }
    }
    if (offenders.length === 0) return null;
    return {
      message: `${offenders.length} parent line(s) carry a summary (X) mark with lettered sub-parts that also carry (X) — double-count risk`,
      offenders,
      feedback: `Parent question lines that have lettered sub-parts (a)/(b)/(c) with their own (X) marks must NOT also carry a parent (X) summary mark. Examples: ${offenders.slice(0, 3).join(' | ')}.`,
    };
  },
});

register({
  id: 'section_letters_sequential',
  category: CATEGORIES.AUTO_FIX,
  scope: SCOPES.PAPER,
  check(ctx) {
    if (!ctx.paper) return null;
    const r = ensureSequentialSectionLetters(ctx.paper);
    if (!r.changed) return null;
    return {
      message: `section letters not sequential — would renumber: ${JSON.stringify(r.replacements)}`,
      replacements: r.replacements,
      feedback: `SECTION/AFDELING letters must run consecutively from A. Detected: ${r.replacements.map((x) => `${x.from}→${x.to}`).join(', ')}.`,
    };
  },
});

register({
  id: 'single_memorandum_banner',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'memo',
  scope: SCOPES.MEMO,
  check(ctx) {
    if (!ctx.memo) return null;
    // Count distinct MEMORANDUM / MEMORANDA banner lines (not inside a
    // table cell). We accept exactly one — multiple is the Bug 9 footprint.
    const lines = ctx.memo.split('\n');
    let count = 0;
    for (const line of lines) {
      const tr = line.trim();
      if (/^(MEMORANDUM|MEMORANDA)\s*$/i.test(tr)) count++;
    }
    if (count <= 1) return null;
    return {
      message: `${count} MEMORANDUM banners in memo — expected exactly 1`,
      count,
      feedback: `The memorandum must contain exactly one MEMORANDUM banner at the top. Found ${count}.`,
    };
  },
});

register({
  id: 'no_phantom_memo_rows',
  category: CATEGORIES.AUTO_FIX,
  scope: SCOPES.MEMO,
  check(ctx) {
    if (!ctx.paper || !ctx.memo) return null;
    // Build the set of paper sub-question numbers, then check that every
    // memo row's number maps to one of them (or to a known parent prefix).
    const paperNums = new Set();
    for (const line of ctx.paper.split('\n')) {
      const m = SUBQ_LINE.exec(line);
      if (m) {
        paperNums.add(m[1]);
        // Also register the parent prefixes so memo rows numbered "1.1"
        // when paper has "1.1.1" don't false-fail.
        const parts = m[1].split('.');
        for (let k = 1; k <= parts.length; k++) paperNums.add(parts.slice(0, k).join('.'));
      }
    }
    if (paperNums.size === 0) return null;

    const memoRows = parseMemoAnswerRows(ctx.memo);
    const phantoms = [];
    for (const r of memoRows) {
      const num = r.number;
      // Memo rows like "Content Point 1" / "C.1" / "Inhoudspunt 1" are RTT
      // Section C entries — they don't appear in paper SUBQ_LINE form, so
      // we accept them.
      if (/^(?:Content\s+Point|Inhoudspunt|C[.\s])\s*\d+$/i.test(num)) continue;
      const stripped = num.replace(/[a-z]$/i, '');
      if (paperNums.has(num) || paperNums.has(stripped)) continue;
      // Walk up the prefixes for a partial match.
      const parts = stripped.split('.');
      let matched = false;
      while (parts.length > 0) {
        if (paperNums.has(parts.join('.'))) { matched = true; break; }
        parts.pop();
      }
      if (!matched) phantoms.push(num);
    }
    if (phantoms.length === 0) return null;
    return {
      message: `${phantoms.length} memo row(s) have numbers not present in paper: ${phantoms.slice(0, 6).join(', ')}`,
      phantoms,
      feedback: `Every memo answer row must correspond to a sub-question that exists in the paper. Phantoms: ${phantoms.join(', ')}.`,
    };
  },
});

// ══════════════════════════════════════════════════════════════════════════
// LANGUAGE / LOCALISATION — REGENERATE
//
// No deterministic fixer for language-label leaks: Claude must re-emit
// the artefact with the correct language throughout.
// ══════════════════════════════════════════════════════════════════════════

register({
  id: 'no_english_labels_on_afrikaans',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'paper',
  scope: SCOPES.PAPER,
  check(ctx) {
    if (ctx.language !== 'Afrikaans') return null;
    if (!ctx.paper) return null;
    // English label words that should have been localised to Afrikaans.
    const offenders = [];
    const RULES = [
      { re: /\bAnswer\s*:/g,   want: 'Antwoord:' },
      { re: /\bWorking\s*:/g,  want: 'Werking:' },
      { re: /\bSECTION\s+[A-Z]/g, want: 'AFDELING X' },
      { re: /\bTOTAL\s*:/g,    want: 'TOTAAL:' },
    ];
    for (const r of RULES) {
      const matches = ctx.paper.match(r.re);
      if (matches && matches.length > 0) {
        offenders.push({ found: matches[0], expected: r.want, count: matches.length });
      }
    }
    if (offenders.length === 0) return null;
    return {
      message: `English labels survived on Afrikaans paper: ${offenders.map((o) => `${o.found}×${o.count}`).join(', ')}`,
      offenders,
      feedback: `Afrikaans papers must use Afrikaans labels: ${offenders.map((o) => `${o.found} → ${o.expected}`).join('; ')}.`,
    };
  },
});

register({
  id: 'cog_levels_in_target_language',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'memo',
  scope: SCOPES.MEMO,
  check(ctx) {
    if (!ctx.memo || ctx.language !== 'Afrikaans') return null;
    // On an Afrikaans memo, no English cog-level token should appear in the
    // COGNITIVE LEVEL column. We scan the answer table rows.
    // English Bloom's tokens that flag a leak when paper language is Afrikaans:
    const ENGLISH_TOKENS = ['Knowledge', 'Routine Procedures', 'Complex Procedures', 'Problem Solving',
                            'Low Order', 'Middle Order', 'High Order',
                            'Literal', 'Reorganisation', 'Inferential', 'Evaluation and Appreciation'];
    const leaks = new Set();
    const rows = parseMemoAnswerRows(ctx.memo);
    for (const r of rows) {
      for (const tok of ENGLISH_TOKENS) {
        if (new RegExp(`\\b${tok.replace(/\s+/g, '\\s+')}\\b`, 'i').test(r.level)) {
          leaks.add(tok);
        }
      }
    }
    if (leaks.size === 0) return null;
    return {
      message: `Afrikaans memo has English cog-level labels: ${[...leaks].join(', ')}`,
      leaks: [...leaks],
      feedback: `Afrikaans memo COGNITIVE LEVEL column must use Afrikaans labels (e.g. Kennis, Roetine Prosedures, Komplekse Prosedures, Probleemoplossing). Found: ${[...leaks].join(', ')}.`,
    };
  },
});

register({
  id: 'memo_column_headers_match_language',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'memo',
  scope: SCOPES.MEMO,
  check(ctx) {
    if (!ctx.memo) return null;
    // Detect the answer-table header row and assert its first/second cells
    // match the language. English: NO. | ANSWER. Afrikaans: NR. | ANTWOORD.
    const header = /\|\s*(NO\.|NR\.|No\.|Nr\.)\s*\|\s*(ANSWER|ANTWOORD)\s*\|/i.exec(ctx.memo);
    if (!header) return null; // memo_has_answer_table will catch absence
    const noCell = header[1].toUpperCase();
    const ansCell = header[2].toUpperCase();
    if (ctx.language === 'Afrikaans') {
      if (!/^NR\./.test(noCell) || ansCell !== 'ANTWOORD') {
        return {
          message: `Afrikaans memo header is "${noCell} | ${ansCell}" — expected "NR. | ANTWOORD"`,
          feedback: `Afrikaans memo answer-table must use header "| NR. | ANTWOORD | MERKINGSRIGLYNE | KOGNITIEWE VLAK | PUNTE |".`,
        };
      }
    } else {
      if (!/^NO\./.test(noCell) || ansCell !== 'ANSWER') {
        return {
          message: `English memo header is "${noCell} | ${ansCell}" — expected "NO. | ANSWER"`,
          feedback: `English memo answer-table must use header "| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |".`,
        };
      }
    }
    return null;
  },
});

register({
  id: 'cover_subject_in_target_language',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'paper',
  scope: SCOPES.PAPER,
  check(ctx) {
    // The cover page is rendered by docx-builder, not embedded in the
    // paper text. Skip if we don't have a clear "Subject:" line in the
    // first 30 lines of the paper text (some pipelines DO inline it).
    if (!ctx.paper) return null;
    const head = ctx.paper.split('\n').slice(0, 30).join('\n');
    if (!/Subject\s*:|Vak\s*:/i.test(head)) return null;
    if (ctx.language === 'Afrikaans' && /\bSubject\s*:/i.test(head)) {
      return {
        message: 'cover line uses English "Subject:" label on Afrikaans paper',
        feedback: 'On Afrikaans papers the cover label must be "Vak:" not "Subject:".',
      };
    }
    return null;
  },
});

register({
  id: 'total_label_in_target_language',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'paper',
  scope: SCOPES.PAPER,
  check(ctx) {
    if (!ctx.paper) return null;
    // Footer total label should match language. English uses TOTAL,
    // Afrikaans uses TOTAAL. We look at the last 30 non-blank lines.
    const lines = ctx.paper.split('\n').map((l) => l.trim()).filter(Boolean).slice(-30);
    let englishTotal = false;
    let afrikaansTotal = false;
    for (const line of lines) {
      if (/^TOTAL\s*:?\s*\d+/i.test(line)) englishTotal = true;
      if (/^TOTAAL\s*:?\s*\d+/i.test(line)) afrikaansTotal = true;
    }
    if (ctx.language === 'Afrikaans' && englishTotal && !afrikaansTotal) {
      return {
        message: 'Afrikaans paper uses English TOTAL footer label',
        feedback: 'Afrikaans papers must end with "TOTAAL:" not "TOTAL:".',
      };
    }
    if (ctx.language === 'English' && afrikaansTotal && !englishTotal) {
      return {
        message: 'English paper uses Afrikaans TOTAAL footer label',
        feedback: 'English papers must end with "TOTAL:" not "TOTAAL:".',
      };
    }
    return null;
  },
});

// ══════════════════════════════════════════════════════════════════════════
// MCQ HYGIENE — AUTO_FIX (shuffleMcqLabels in lib/auto-fix.js)
//
// When the correct-answer distribution is skewed or forms a predictable
// run/cycle, shuffleMcqLabels rebalances the labels before the gate runs.
// A failure here means the shuffler itself has a bug.
// ══════════════════════════════════════════════════════════════════════════

// Helper: pull MCQ answer letters from the memo answer-table rows for
// questions whose paper sub-question has a-d options. Returns Map(num→letter).
function extractMcqAnswerLetters(ctx) {
  const out = new Map();
  if (!ctx.paper || !ctx.memo) return out;
  // Find which paper sub-questions have MCQ option blocks.
  const lines = ctx.paper.split('\n');
  const mcqQuestions = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = SUBQ_LINE.exec(lines[i]);
    if (!m) continue;
    let optionLetters = 0;
    for (let j = i + 1; j < Math.min(lines.length, i + 11); j++) {
      if (SUBQ_LINE.test(lines[j])) break;
      if (MCQ_OPTION_LINE.test(lines[j])) optionLetters++;
    }
    if (optionLetters >= 2) mcqQuestions.add(m[1]);
  }
  if (mcqQuestions.size === 0) return out;
  // Read memo rows, pull single-letter answers for those questions.
  for (const r of parseMemoAnswerRows(ctx.memo)) {
    if (!mcqQuestions.has(r.number)) continue;
    // Answer cell could be "b" / "B" / "B.", look at the rows array but
    // parseMemoAnswerRows discards the answer cell; re-grep memo for it.
  }
  // Fallback: directly grep memo for `| <num> | <letter> |` rows. We
  // capture any single letter (not just a-d) so mcq_answer_letter_in_options
  // can flag out-of-range answers like E.
  const ROW_RE = /^\s*\|\s*(?:Q\s*)?(\d+(?:\.\d+)*(?:[a-z])?)\s*\|\s*([A-Za-z])(?:\.|\b)\s*\|/gm;
  let r;
  while ((r = ROW_RE.exec(ctx.memo)) !== null) {
    if (mcqQuestions.has(r[1])) out.set(r[1], r[2].toUpperCase());
  }
  return out;
}

register({
  id: 'mcq_distribution_balanced',
  category: CATEGORIES.AUTO_FIX,
  scope: SCOPES.PAPER,
  check(ctx) {
    const letters = extractMcqAnswerLetters(ctx);
    if (letters.size < 4) return null; // too few MCQs to assess balance
    const counts = { A: 0, B: 0, C: 0, D: 0 };
    for (const L of letters.values()) {
      if (counts[L] !== undefined) counts[L]++;
    }
    const total = letters.size;
    // Allow any single letter to take at most 60% of answers before flagging.
    const maxAllowed = Math.ceil(total * 0.6);
    const skewed = Object.entries(counts).filter(([, n]) => n > maxAllowed);
    if (skewed.length === 0) return null;
    return {
      message: `MCQ answer distribution skewed: ${JSON.stringify(counts)} of ${total} (max ${maxAllowed}/letter)`,
      counts,
      total,
      feedback: `MCQ correct-answer letters cluster too heavily: ${JSON.stringify(counts)} across ${total} questions. Shuffle option labels so the correct letter is roughly uniform across A/B/C/D.`,
    };
  },
});

register({
  id: 'mcq_no_obvious_answer_pattern',
  category: CATEGORIES.AUTO_FIX,
  scope: SCOPES.PAPER,
  check(ctx) {
    const letters = extractMcqAnswerLetters(ctx);
    if (letters.size < 4) return null;
    // Sequential string pattern: e.g. all answers march A, B, C, D, A, B…
    const ordered = [...letters.entries()]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }))
      .map(([, L]) => L);
    // Detect runs of identical letters (≥ 4 in a row).
    let runStart = 0;
    for (let i = 1; i <= ordered.length; i++) {
      if (i === ordered.length || ordered[i] !== ordered[runStart]) {
        const runLen = i - runStart;
        if (runLen >= 4) {
          return {
            message: `MCQ answer run: ${ordered[runStart]} repeats ${runLen} times in sequence`,
            ordered,
            feedback: `${runLen} consecutive MCQ questions all have answer ${ordered[runStart]}. Shuffle option labels to break the run.`,
          };
        }
        runStart = i;
      }
    }
    // Detect strict A/B/C/D cycle (boring pattern).
    const cycle = ['A', 'B', 'C', 'D'];
    let isCycle = ordered.length >= 4;
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i] !== cycle[i % 4]) { isCycle = false; break; }
    }
    if (isCycle) {
      return {
        message: `MCQ answers follow strict A,B,C,D cycle`,
        ordered,
        feedback: `MCQ answers form a predictable A,B,C,D cycle. Randomise the correct letter for each question.`,
      };
    }
    return null;
  },
});

// ══════════════════════════════════════════════════════════════════════════
// HYGIENE — meta-commentary / leakage
//
// no_phantom_apology_rows → AUTO_FIX (stripPhantomMemoRows).
// no_meta_commentary_leak, no_distribution_note_leak,
// no_in_cell_meta_commentary, answer_space_present → REGENERATE: require
// Claude to clean and re-emit the affected artefact.
// ══════════════════════════════════════════════════════════════════════════

const META_PATTERNS = [
  /^(I'll|I will|Let me|Here's|Here is|I can|Sure[!,.]|Sure thing)/i,
  /^Note\s*:/i,
  /\bI cannot\b/i,
  /\bAs an AI\b/i,
  /\bI apologi[sz]e\b/i,
  /\bSorry,? I\b/i,
  /^This (paper|memo|response) (contains|includes|uses)/i,
  // Leaked mark-tally arithmetic — e.g. "Total: 5+5+5+5=79" or "Q17: 2+3+4".
  // Four or more addends in a chain is a reliable signal of internal workings.
  /\d+(?:\s*\+\s*\d+){3,}/,
  // "Total: N+M+..." footer calculation line
  /^(Total|Totaal)\s*:\s*\d+(?:\s*[+\-]\s*\d+)+/i,
];

register({
  id: 'no_meta_commentary_leak',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'paper',
  scope: SCOPES.PAPER,
  check(ctx) {
    if (!ctx.paper) return null;
    const offenders = [];
    for (const line of ctx.paper.split('\n')) {
      const tr = line.trim();
      if (!tr) continue;
      for (const pat of META_PATTERNS) {
        if (pat.test(tr)) { offenders.push(tr.slice(0, 80)); break; }
      }
      if (offenders.length >= 5) break;
    }
    if (offenders.length === 0) return null;
    return {
      message: `meta-commentary lines leaked into paper: ${offenders.length}`,
      offenders,
      feedback: `Remove meta-commentary lines from the paper. Examples: ${offenders.slice(0, 3).map((o) => `"${o}"`).join(', ')}.`,
    };
  },
});

register({
  id: 'no_distribution_note_leak',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'paper',
  scope: SCOPES.PAPER,
  check(ctx) {
    if (!ctx.paper) return null;
    // Distribution-note leaks describe the cog distribution to the LEARNER
    // — e.g. "This paper has 30% Knowledge, 40% Routine…". They're memo-
    // -only content that escaped into the question paper.
    const offenders = [];
    const NOTE_RE = /\b(distribution|breakdown|allocation|spread)\b.*\b\d{1,3}\s?%/i;
    const COG_LIST = /\b(Knowledge|Routine Procedures|Complex Procedures|Problem Solving|Low Order|Middle Order|High Order)\b.*\b(Knowledge|Routine Procedures|Complex Procedures|Problem Solving|Low Order|Middle Order|High Order)\b/i;
    for (const line of ctx.paper.split('\n')) {
      const tr = line.trim();
      if (!tr) continue;
      if (NOTE_RE.test(tr) || COG_LIST.test(tr)) offenders.push(tr.slice(0, 100));
      if (offenders.length >= 5) break;
    }
    if (offenders.length === 0) return null;
    return {
      message: `cognitive distribution notes leaked into paper`,
      offenders,
      feedback: `The question paper must not describe its own cognitive-level distribution to the learner. Move these lines into the memo or remove them.`,
    };
  },
});

register({
  id: 'no_phantom_apology_rows',
  category: CATEGORIES.AUTO_FIX,
  scope: SCOPES.MEMO,
  check(ctx) {
    if (!ctx.memo) return null;
    // Apology rows in the memo answer table look like:
    //   `| 3.5 | I cannot generate this | … |`
    const offenders = [];
    for (const line of ctx.memo.split('\n')) {
      if (!/^\s*\|/.test(line)) continue;
      if (/\b(I cannot|I can't|As an AI|I apologi[sz]e|unable to generate)\b/i.test(line)) {
        offenders.push(line.trim().slice(0, 100));
      }
    }
    if (offenders.length === 0) return null;
    return {
      message: `${offenders.length} apology row(s) in memo`,
      offenders,
      feedback: `Memo answer rows must contain real answers, not apology text. Replace these rows with proper answers.`,
    };
  },
});

register({
  id: 'no_in_cell_meta_commentary',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'memo',
  scope: SCOPES.MEMO,
  check(ctx) {
    if (!ctx.memo) return null;
    // Bracketed editor notes "[Note: …]", "[TODO …]", OR unbracketed leaks
    // like "NOTE TO MARKER" / "appears to be incomplete" inside table cells.
    const offenders = [];
    for (const line of ctx.memo.split('\n')) {
      if (!/^\s*\|/.test(line)) continue;
      if (
        /\[(Note|TODO|FIXME|TBD|Insert)\b/i.test(line) ||
        /\bNOTE\s+TO\s+MARKER\b/i.test(line) ||
        /\bappears?\s+to\s+be\s+incomplete\b/i.test(line)
      ) {
        offenders.push(line.trim().slice(0, 100));
      }
    }
    if (offenders.length === 0) return null;
    return {
      message: `${offenders.length} memo cell(s) contain editor-style notes`,
      offenders,
      feedback: `Memo cells must contain real content, not editor notes like [Note: …], "NOTE TO MARKER", or "appears to be incomplete".`,
    };
  },
});

register({
  id: 'answer_space_present',
  category: CATEGORIES.REGENERATE,
  regeneratePhase: 'paper',
  scope: SCOPES.PAPER,
  check(ctx) {
    if (!ctx.paper) return null;
    // For non-MCQ, non-table sub-questions, assert there's at least one
    // underscore-line OR an Answer:/Working: stub OR an inline blank in the
    // 8 lines below the sub-question header.
    const lines = ctx.paper.split('\n');
    const HAS_UNDERSCORES = /_{5,}/;
    const HAS_LABEL = /^\s*(Answer|Antwoord|Working|Werking)\s*:/i;
    const HAS_TABLE = /^\s*\|.*\|/;
    const HAS_MCQ = /^\s*[a-dA-D][.)]\s/;
    const TF = /\btrue\s*(?:\/|or)\s*false\b|\bT\s*\/\s*F\b|\bwaar\s*(?:\/|of)\s*onwaar\b/i;
    const offenders = [];
    for (let i = 0; i < lines.length; i++) {
      const m = SUBQ_LINE.exec(lines[i]);
      if (!m) continue;
      const marks = parseInt(m[2], 10);
      if (!Number.isFinite(marks) || marks <= 0) continue;
      // Inline blank in the question itself counts.
      if (HAS_UNDERSCORES.test(lines[i]) || TF.test(lines[i])) continue;
      // Look ahead until the next sub-question or 10 lines, whichever first.
      const stopAt = Math.min(lines.length, i + 11);
      let stop = stopAt;
      for (let j = i + 1; j < stopAt; j++) {
        if (SUBQ_LINE.test(lines[j])) { stop = j; break; }
      }
      const ahead = lines.slice(i + 1, stop);
      const aheadStr = ahead.join('\n');
      const ok =
        HAS_UNDERSCORES.test(aheadStr) ||
        HAS_LABEL.test(aheadStr) ||
        HAS_TABLE.test(aheadStr) ||
        HAS_MCQ.test(aheadStr);
      if (!ok) offenders.push(m[1]);
    }
    if (offenders.length === 0) return null;
    return {
      message: `${offenders.length} sub-question(s) missing answer space: ${offenders.slice(0, 8).join(', ')}`,
      offenders,
      feedback: `Sub-questions ${offenders.slice(0, 8).join(', ')} have no underscored answer line, "Answer:" stub, MCQ options, or table to write in.`,
    };
  },
});

// ══════════════════════════════════════════════════════════════════════════
// REGENERATE — failures that need another Claude call with corrective
// feedback. The runner only flags them; the regeneration plumbing
// (lib/regenerate.js, Step 2) reads `feedback` from each failure and
// reissues the relevant phase up to a cap.
//
// `regeneratePhase` tells the plumbing which phase to reissue:
//   'plan'  — the plan validation step (Phase 0)
//   'paper' — the question paper writer (Phase 1/2)
//   'memo'  — the memo generator (Phase 3)
// ══════════════════════════════════════════════════════════════════════════

register({
  id: 'memo_has_answer_table',
  category: CATEGORIES.REGENERATE,
  scope: SCOPES.MEMO,
  regeneratePhase: 'memo',
  check(ctx) {
    if (!ctx.memo) return null;
    if (hasAnswerTable(ctx.memo)) return null;
    return {
      message: 'memo is missing the NO. | ANSWER answer-table header',
      feedback: 'The memorandum must include a row-by-row answer table with header "| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |" (or Afrikaans equivalent). Re-emit the memo with this table present.',
    };
  },
});

register({
  id: 'memo_has_cog_analysis',
  category: CATEGORIES.REGENERATE,
  scope: SCOPES.MEMO,
  regeneratePhase: 'memo',
  check(ctx) {
    if (!ctx.memo) return null;
    if (hasCogAnalysis(ctx.memo)) return null;
    return {
      message: 'memo is missing the COGNITIVE LEVEL ANALYSIS section',
      feedback: 'The memorandum must include a COGNITIVE LEVEL ANALYSIS / KOGNITIEWE VLAK ANALISE section with the per-level breakdown table.',
    };
  },
});

register({
  id: 'memo_row_count_matches_paper',
  category: CATEGORIES.REGENERATE,
  scope: SCOPES.MEMO,
  regeneratePhase: 'memo',
  check(ctx) {
    if (!ctx.memo || !ctx.paper) return null;
    if (!hasAnswerTable(ctx.memo)) return null; // covered upstream
    // Count paper sub-questions (each SUBQ_LINE is one row in the memo).
    let paperRows = 0;
    for (const line of ctx.paper.split('\n')) {
      if (SUBQ_LINE.test(line)) paperRows++;
    }
    if (paperRows === 0) return null;
    const memoRows = countAnswerTableRows(ctx.memo);
    // We allow ±1 (some pipelines collapse a parent + first child into one
    // memo row). Bigger gaps are real truncation / over-counting.
    const drift = memoRows - paperRows;
    if (Math.abs(drift) <= 1) return null;
    return {
      message: `memo answer-table has ${memoRows} body rows; paper has ${paperRows} sub-questions (drift ${drift})`,
      memoRows,
      paperRows,
      drift,
      feedback: `The memo answer table must have one row per paper sub-question. Paper has ${paperRows} sub-questions; memo has ${memoRows} rows.`,
    };
  },
});

register({
  id: 'mcq_options_count_correct',
  category: CATEGORIES.REGENERATE,
  scope: SCOPES.PAPER,
  regeneratePhase: 'paper',
  check(ctx) {
    if (!ctx.paper) return null;
    // Each MCQ block must have exactly 4 options (a/b/c/d). 2-option or
    // 5-option blocks indicate a malformed MCQ.
    const lines = ctx.paper.split('\n');
    const offenders = [];
    for (let i = 0; i < lines.length; i++) {
      const m = SUBQ_LINE.exec(lines[i]);
      if (!m) continue;
      const seen = new Set();
      let optionCount = 0;
      for (let j = i + 1; j < Math.min(lines.length, i + 11); j++) {
        if (SUBQ_LINE.test(lines[j])) break;
        const om = MCQ_OPTION_LINE.exec(lines[j]);
        if (om) {
          seen.add(om[1].toLowerCase());
          optionCount++;
        }
      }
      // Only flag blocks that LOOK like MCQ (2+ option lines) but don't
      // have exactly 4 distinct letters a-d.
      if (optionCount >= 2 && (seen.size !== 4 || !['a', 'b', 'c', 'd'].every((L) => seen.has(L)))) {
        offenders.push({ q: m[1], letters: [...seen].sort().join('') });
      }
    }
    if (offenders.length === 0) return null;
    return {
      message: `${offenders.length} MCQ block(s) with non-standard option counts: ${offenders.slice(0, 5).map((o) => `${o.q}(${o.letters})`).join(', ')}`,
      offenders,
      feedback: `Each MCQ must have exactly four options labelled a, b, c, d. Offenders: ${offenders.map((o) => `Q${o.q} has [${o.letters}]`).join('; ')}.`,
    };
  },
});

register({
  id: 'mcq_answer_letter_in_options',
  category: CATEGORIES.REGENERATE,
  scope: SCOPES.MEMO,
  regeneratePhase: 'memo',
  check(ctx) {
    const letters = extractMcqAnswerLetters(ctx);
    if (letters.size === 0) return null;
    // Build the set of available option letters for each MCQ from the paper.
    const lines = ctx.paper.split('\n');
    const optionsByQ = new Map();
    for (let i = 0; i < lines.length; i++) {
      const m = SUBQ_LINE.exec(lines[i]);
      if (!m) continue;
      const opts = new Set();
      for (let j = i + 1; j < Math.min(lines.length, i + 11); j++) {
        if (SUBQ_LINE.test(lines[j])) break;
        const om = MCQ_OPTION_LINE.exec(lines[j]);
        if (om) opts.add(om[1].toUpperCase());
      }
      if (opts.size > 0) optionsByQ.set(m[1], opts);
    }
    const offenders = [];
    for (const [num, answer] of letters) {
      const opts = optionsByQ.get(num);
      if (!opts) continue;
      if (!opts.has(answer)) {
        offenders.push({ q: num, answer, options: [...opts].sort().join('') });
      }
    }
    if (offenders.length === 0) return null;
    return {
      message: `${offenders.length} MCQ memo answer(s) reference a letter not present in the options: ${offenders.map((o) => `Q${o.q}=${o.answer}`).join(', ')}`,
      offenders,
      feedback: `Each MCQ memo answer letter must be one of the question's options. Mismatches: ${offenders.map((o) => `Q${o.q} answer=${o.answer}, options=[${o.options}]`).join('; ')}.`,
    };
  },
});

register({
  id: 'mcq_no_duplicate_options',
  category: CATEGORIES.REGENERATE,
  scope: SCOPES.PAPER,
  regeneratePhase: 'paper',
  check(ctx) {
    if (!ctx.paper) return null;
    const lines = ctx.paper.split('\n');
    const offenders = [];
    for (let i = 0; i < lines.length; i++) {
      const m = SUBQ_LINE.exec(lines[i]);
      if (!m) continue;
      const optionTexts = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 11); j++) {
        if (SUBQ_LINE.test(lines[j])) break;
        const om = MCQ_OPTION_LINE.exec(lines[j]);
        if (om) optionTexts.push(om[2].trim().toLowerCase().replace(/\s+/g, ' '));
      }
      if (optionTexts.length < 2) continue;
      const seen = new Set();
      const dupes = [];
      for (const t of optionTexts) {
        if (seen.has(t)) dupes.push(t);
        seen.add(t);
      }
      if (dupes.length > 0) offenders.push({ q: m[1], duplicates: dupes });
    }
    if (offenders.length === 0) return null;
    return {
      message: `${offenders.length} MCQ block(s) have duplicate option text`,
      offenders,
      feedback: `MCQ options must all be distinct. Offenders: ${offenders.slice(0, 3).map((o) => `Q${o.q} [${o.duplicates.join(' / ')}]`).join('; ')}.`,
    };
  },
});

register({
  id: 'cog_distribution_within_tolerance',
  category: CATEGORIES.REGENERATE,
  scope: SCOPES.PAPER,
  regeneratePhase: 'paper',
  check(ctx) {
    if (!ctx.paper || !ctx.plan?.questions?.length || !ctx.cog?.levels?.length) return null;
    if (!ctx.cogMarks?.length) return null;
    const balance = verifyCogBalance({
      paper: ctx.paper,
      plan: ctx.plan,
      cog: ctx.cog,
      cogMarks: ctx.cogMarks,
      tolerance: ctx.cogTolerance,
    });
    if (balance.lowConfidence) return null; // unreliable map; skip
    if (balance.clean) return null;
    return {
      message: `cog-level distribution drifted: ${balance.imbalances.length} level(s) over tolerance`,
      imbalances: balance.imbalances,
      feedback: balance.imbalances
        .map((r) => `${r.level}: plan ${r.prescribed}, paper ${r.actual} (drift ${r.drift > 0 ? '+' : ''}${r.drift})`)
        .join('; '),
    };
  },
});

register({
  id: 'topic_coverage_distinct',
  category: CATEGORIES.REGENERATE,
  scope: SCOPES.PLAN,
  regeneratePhase: 'plan',
  check(ctx) {
    if (!ctx.plan?.questions?.length) return null;
    // Every question's topic must be distinct enough — i.e. no two
    // questions share the exact same `topic` field. This is a weak proxy
    // for diversity; the real check is for fuzz-batch AI judging.
    const topics = ctx.plan.questions.map((q) => String(q.topic || '').trim().toLowerCase()).filter(Boolean);
    if (topics.length < 2) return null;
    const counts = new Map();
    for (const t of topics) counts.set(t, (counts.get(t) || 0) + 1);
    const dupes = [...counts.entries()].filter(([, n]) => n > 1);
    // A handful of exam questions sharing a topic is fine. Flag when more
    // than half the questions cluster on one topic.
    const heaviest = dupes.sort((a, b) => b[1] - a[1])[0];
    if (!heaviest || heaviest[1] <= Math.ceil(topics.length / 2)) return null;
    return {
      message: `plan topic "${heaviest[0]}" covers ${heaviest[1]}/${topics.length} questions`,
      duplicates: dupes,
      feedback: `Plan questions must cover diverse topics. "${heaviest[0]}" appears ${heaviest[1]} times across ${topics.length} questions — broaden the topic spread.`,
    };
  },
});

register({
  id: 'resource_type_matches_content',
  category: CATEGORIES.REGENERATE,
  scope: SCOPES.PAPER,
  regeneratePhase: 'paper',
  check(ctx) {
    if (!ctx.paper || !ctx.resourceType) return null;
    // Cheap structural heuristic — full subjective fit-check is DEV_ONLY.
    // Investigation papers must include the word "Investigation" /
    // "Ondersoek" in the first 30 lines. Worksheets must NOT have a
    // [N] block-total structure.
    const head = ctx.paper.split('\n').slice(0, 30).join('\n');
    if (/^Investigation$/i.test(ctx.resourceType)) {
      if (!/\b(Investigation|Ondersoek)\b/i.test(head)) {
        return {
          message: `Investigation paper has no "Investigation"/"Ondersoek" heading in first 30 lines`,
          feedback: `An Investigation resource must announce itself with "Investigation" / "Ondersoek" in the heading area.`,
        };
      }
    }
    if (/^Worksheet$/i.test(ctx.resourceType)) {
      const blockCount = (ctx.paper.match(/\[(\d+)\]/g) || []).length;
      if (blockCount >= 2) {
        return {
          message: `Worksheet has ${blockCount} [N] section block totals (worksheets shouldn't have section totals)`,
          feedback: `Worksheets must not use SECTION [N] block totals. Remove section headings or convert this resource to a Test/Exam.`,
        };
      }
    }
    return null;
  },
});

// ══════════════════════════════════════════════════════════════════════════
// DEV_ONLY — subjective / aggregate / AI-judge invariants. Run in fuzz
// batches and surfaced on the dev dashboard. NEVER block teacher delivery
// (the orchestrator filters category=DEV_ONLY out of `blocking`).
// ══════════════════════════════════════════════════════════════════════════

register({
  id: 'mark_scope_discipline',
  category: CATEGORIES.DEV_ONLY,
  scope: SCOPES.PAPER,
  check(ctx) {
    // Detects "List N" / "Name N" stems whose mark allocation is
    // implausible (e.g. "Name 5 things" but only 1 mark, or 2 things for
    // 8 marks). The full check lives in test/mark-scope-discipline.test.js
    // — here we run a cheap pass and report rate, never block.
    if (!ctx.paper) return null;
    const offenders = [];
    const SCOPE_RE = /\b(list|name|give|state|noem|gee)\b.*?\b(two|three|four|five|six|seven|eight|twee|drie|vier|vyf|ses|sewe|agt|\d+)\b/i;
    const WORD = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
                   twee: 2, drie: 3, vier: 4, vyf: 5, ses: 6, sewe: 7, agt: 8 };
    for (const line of ctx.paper.split('\n')) {
      const sm = SUBQ_LINE.exec(line);
      if (!sm) continue;
      const marks = parseInt(sm[2], 10);
      const sc = SCOPE_RE.exec(line);
      if (!sc) continue;
      const w = sc[2].toLowerCase();
      const n = WORD[w] ?? parseInt(w, 10);
      if (!Number.isFinite(n)) continue;
      // Mark-to-item ratio out of [0.5, 2.5] range is suspicious.
      const ratio = marks / n;
      if (ratio < 0.5 || ratio > 2.5) {
        offenders.push({ q: sm[1], marks, items: n, ratio: Number(ratio.toFixed(2)) });
      }
    }
    if (offenders.length === 0) return null;
    return {
      message: `${offenders.length} sub-question(s) with mark-scope ratio outside [0.5, 2.5]`,
      offenders,
    };
  },
});

register({
  id: 'aggregate_quality_metrics',
  category: CATEGORIES.DEV_ONLY,
  scope: SCOPES.PAPER,
  check(/* ctx */) {
    // Placeholder for the fuzz-batch aggregator. Always passes in the
    // hot path — the dashboard runs its own analysis offline.
    return null;
  },
});

register({
  id: 'ai_judge_resource_type_fit',
  category: CATEGORIES.DEV_ONLY,
  scope: SCOPES.PAPER,
  check(/* ctx */) {
    // Placeholder for the AI-judge invariant ("is this Investigation
    // actually investigative?"). Implemented in fuzz harness; we never
    // pay the judge cost on the teacher's hot path.
    return null;
  },
});

