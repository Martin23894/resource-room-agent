// Deterministic AUTO_FIX repairs that run BEFORE the pre-delivery gate.
//
// The gate's AUTO_FIX category names problems whose repair is mechanical
// (no Claude call needed): swap MCQ option labels, delete phantom memo
// rows, snap memo mark cells to the paper's (X) values, etc. These
// repairs run in this module so the gate sees the post-fix state and
// either passes cleanly or escalates to REGENERATE for the truly
// non-deterministic failures.
//
// Architecture:
//   FIXES — ordered list of { id, applies }. Each `applies(ctx)`
//           returns null (no change) or a partial { paper?, memo? }
//           that the runner merges into ctx.
//   runAutoFixes — runs every fix in order, accumulates updates,
//                  returns the merged ctx + the list of fix ids that
//                  fired so the caller can log telemetry.
//
// Fixes are intentionally NARROW — each one targets a single failure
// shape. Anything broader (whole-paper rewrites, content corrections)
// belongs in the REGENERATE plumbing, not here.

import { parseMemoAnswerRows } from './cog-table.js';
import { countMarks } from './marks.js';

// ── shared parsers ─────────────────────────────────────────────────────

// Mirrors lib/invariants.js — kept local to keep this module self-
// contained and avoid importing from the runner (the runner imports us).
const SUBQ_LINE = /^\s*(\d+(?:\.\d+)*(?:[a-z])?)\s+.*\((\d+)\)\s*$/;
const MCQ_OPTION_LINE = /^\s*([a-dA-D])([.)])\s+(.+)$/;

/**
 * Find every MCQ block in the paper.
 *
 * @param {string} paper
 * @returns {Array<{
 *   questionNumber: string,
 *   questionLineIdx: number,
 *   options: Array<{ letter: string, sep: string, text: string, lineIdx: number }>,
 * }>}
 */
function findMcqBlocks(paper) {
  const lines = paper.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = SUBQ_LINE.exec(lines[i]);
    if (!m) continue;
    const options = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 11); j++) {
      if (SUBQ_LINE.test(lines[j])) break;
      const om = MCQ_OPTION_LINE.exec(lines[j]);
      if (om) {
        options.push({
          letter: om[1].toUpperCase(),
          sep: om[2],
          text: om[3],
          lineIdx: j,
        });
      }
    }
    if (options.length >= 2) {
      blocks.push({
        questionNumber: m[1],
        questionLineIdx: i,
        options,
      });
    }
  }
  return blocks;
}

/**
 * Parse memo answer rows for MCQ questions, returning the answer
 * letter per question. Captures any single letter (a-z) so out-of-range
 * answers are preserved (the gate will catch them via
 * mcq_answer_letter_in_options).
 */
function findMcqMemoAnswers(memo, mcqQuestionNumbers) {
  const out = new Map();
  if (!memo) return out;
  const ROW_RE = /^\s*\|\s*(?:Q\s*)?(\d+(?:\.\d+)*(?:[a-z])?)\s*\|\s*([A-Za-z])(?:\.|\b)\s*\|/gm;
  let r;
  while ((r = ROW_RE.exec(memo)) !== null) {
    if (mcqQuestionNumbers.has(r[1])) {
      out.set(r[1], r[2].toUpperCase());
    }
  }
  return out;
}

// ============================================================
// FIX 1 — MCQ label shuffler
// ============================================================
//
// When the correct-answer letter clusters too heavily on one letter
// (mcq_distribution_balanced) or marches in a predictable run/cycle
// (mcq_no_obvious_answer_pattern), redistribute the correct letter
// across A/B/C/D using a deterministic round-robin.
//
// Mechanism: for each MCQ question whose target letter differs from its
// current correct letter, swap the option text between those two
// positions. Labels (a/b/c/d) stay in alphabetical order on the page;
// only the text content moves. The memo's answer letter is updated to
// match.

const TARGET_CYCLE = ['A', 'B', 'C', 'D'];

function shouldShuffle(currentCounts, total) {
  // Re-implement the gate's heuristics so this fix only fires when the
  // gate would have flagged. Keeps fix logic synced with detection.
  if (total < 4) return false;
  const maxAllowed = Math.ceil(total * 0.6);
  for (const L of TARGET_CYCLE) {
    if ((currentCounts[L] || 0) > maxAllowed) return true;
  }
  return false;
}

function detectRun(orderedLetters) {
  // True iff there's a run of ≥ 4 consecutive identical letters.
  let runStart = 0;
  for (let i = 1; i <= orderedLetters.length; i++) {
    if (i === orderedLetters.length || orderedLetters[i] !== orderedLetters[runStart]) {
      if (i - runStart >= 4) return true;
      runStart = i;
    }
  }
  return false;
}

function detectStrictCycle(orderedLetters) {
  if (orderedLetters.length < 4) return false;
  for (let i = 0; i < orderedLetters.length; i++) {
    if (orderedLetters[i] !== TARGET_CYCLE[i % 4]) return false;
  }
  return true;
}

/**
 * Build a map from question number → target letter. Round-robin over
 * the questions sorted by number so the assignment is deterministic
 * for a given paper. Questions whose current letter would collide with
 * the round-robin target keep their letter (no-op swap).
 */
function buildTargetAssignment(blocks, currentAnswers) {
  // Sort by numeric path so 1.10 comes after 1.9 etc.
  const sorted = [...blocks].sort((a, b) => {
    const ax = a.questionNumber.split('.').map((s) => parseInt(s, 10) || 0);
    const bx = b.questionNumber.split('.').map((s) => parseInt(s, 10) || 0);
    for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
      const d = (ax[i] || 0) - (bx[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  });
  const targets = new Map();
  // Phase-shift the round-robin start by hash(firstQuestionNumber) so
  // two consecutive runs of the same generation params don't both
  // produce the literal A,B,C,D pattern. Deterministic per paper.
  const seed = sorted.length > 0
    ? sorted[0].questionNumber.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 4
    : 0;
  let i = 0;
  for (const blk of sorted) {
    const current = currentAnswers.get(blk.questionNumber);
    if (!current) continue; // memo doesn't have an answer for this MCQ; skip
    const target = TARGET_CYCLE[(i + seed) % 4];
    targets.set(blk.questionNumber, target);
    i++;
  }
  return targets;
}

/**
 * Swap the option-line texts in `lines` so the option whose text
 * matched `oldLetter` now sits under `newLetter`. Mutates `lines`.
 * Returns true if a swap happened.
 */
function swapOptionLetters(lines, options, oldLetter, newLetter) {
  if (oldLetter === newLetter) return false;
  const oldOpt = options.find((o) => o.letter === oldLetter);
  const newOpt = options.find((o) => o.letter === newLetter);
  if (!oldOpt || !newOpt) return false;
  // Rebuild each line with the OTHER option's text. Preserve the
  // existing label letter and separator on each line — only the text
  // body moves.
  const oldLine = lines[oldOpt.lineIdx];
  const newLine = lines[newOpt.lineIdx];
  // Match the literal label "a." / "B)" prefix and replace text only.
  // The MCQ_OPTION_LINE regex has 3 groups: letter, separator, text;
  // we keep groups 1+2 from the existing line and substitute group 3.
  lines[oldOpt.lineIdx] = oldLine.replace(MCQ_OPTION_LINE, (m, L, sep /* , txt */) => {
    return m.slice(0, m.indexOf(sep) + sep.length) + ' ' + newOpt.text;
  });
  lines[newOpt.lineIdx] = newLine.replace(MCQ_OPTION_LINE, (m, L, sep /* , txt */) => {
    return m.slice(0, m.indexOf(sep) + sep.length) + ' ' + oldOpt.text;
  });
  return true;
}

/**
 * Update the memo's answer letter for `questionNumber` from `oldLetter`
 * to `newLetter`. Replaces the cell text in-place; returns the new
 * memo string (or the original if no row was matched).
 */
function rewriteMemoAnswerCell(memo, questionNumber, newLetter) {
  // Match the row's first two cells: `| 1.1 | <letter> |`. Capture
  // everything around so only the letter changes. We tolerate a `Q`
  // prefix and an optional trailing `.` after the letter.
  const escaped = questionNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^\\s*\\|\\s*(?:Q\\s*)?${escaped}\\s*\\|\\s*)([A-Za-z])(\\.?\\s*\\|)`, 'm');
  return memo.replace(re, (_m, pre, _old, post) => `${pre}${newLetter}${post}`);
}

/**
 * Auto-fix: shuffle MCQ option labels so the correct-answer letter is
 * roughly uniform across A/B/C/D. Returns null if the paper either has
 * no MCQs or already has an acceptable distribution; otherwise returns
 * { paper, memo } with the shuffled labels.
 */
export function shuffleMcqLabels(ctx) {
  if (!ctx?.paper || !ctx?.memo) return null;
  const blocks = findMcqBlocks(ctx.paper);
  if (blocks.length < 4) return null;

  const mcqNums = new Set(blocks.map((b) => b.questionNumber));
  const answers = findMcqMemoAnswers(ctx.memo, mcqNums);
  if (answers.size < 4) return null;

  // Decide whether to fire. Match the gate's two checks.
  const currentCounts = { A: 0, B: 0, C: 0, D: 0 };
  for (const L of answers.values()) {
    if (currentCounts[L] !== undefined) currentCounts[L]++;
  }
  const orderedByQ = blocks
    .map((b) => answers.get(b.questionNumber))
    .filter(Boolean);
  if (
    !shouldShuffle(currentCounts, answers.size) &&
    !detectRun(orderedByQ) &&
    !detectStrictCycle(orderedByQ)
  ) {
    return null;
  }

  const targets = buildTargetAssignment(blocks, answers);
  const lines = ctx.paper.split('\n');
  let memo = ctx.memo;
  let anyChange = false;

  for (const blk of blocks) {
    const target = targets.get(blk.questionNumber);
    const current = answers.get(blk.questionNumber);
    if (!target || !current || target === current) continue;
    // Only swap if BOTH letters exist as options on this question.
    const hasOld = blk.options.some((o) => o.letter === current);
    const hasNew = blk.options.some((o) => o.letter === target);
    if (!hasOld || !hasNew) continue;
    if (swapOptionLetters(lines, blk.options, current, target)) {
      memo = rewriteMemoAnswerCell(memo, blk.questionNumber, target);
      anyChange = true;
    }
  }
  if (!anyChange) return null;
  return { paper: lines.join('\n'), memo };
}

// ============================================================
// FIX 2 — Phantom memo row + apology row stripper
// ============================================================
//
// Targets:
//   no_phantom_memo_rows   — rows whose number doesn't map to any
//                            paper sub-question (e.g. an "8.7" row
//                            when the paper only has 1.1 … 8.6)
//   no_phantom_apology_rows — rows containing "I cannot generate" /
//                             "As an AI" / "I apologise" cell content
//
// Both are deletion-only fixes: we drop the offending line entirely
// from the memo. We never invent replacement content — that's a
// REGENERATE concern.

const ANSWER_ROW_NUMBER_CELL_RE = /^\s*\|\s*(?:Q\s*)?(\d+(?:\.\d+)*\s*(?:\(?[a-z]\)?)?|(?:Content\s+Point|Inhoudspunt|C[.\s]?)\s*\d+)\s*\|/i;
const APOLOGY_RE = /\b(I cannot|I can't|As an AI|I apologi[sz]e|unable to generate)\b/i;

function buildPaperNumberSet(paper) {
  const out = new Set();
  for (const line of paper.split('\n')) {
    const m = SUBQ_LINE.exec(line);
    if (m) {
      out.add(m[1]);
      // Register parent prefixes so "1.1" memo row matches "1.1.1" paper.
      const parts = m[1].split('.');
      for (let k = 1; k <= parts.length; k++) out.add(parts.slice(0, k).join('.'));
    }
  }
  return out;
}

function isPhantomRowNumber(num, paperNumbers) {
  // Section-C content-point labels are accepted regardless of paper map
  // (RTT pipeline emits them deterministically).
  if (/^(?:Content\s+Point|Inhoudspunt|C[.\s])\s*\d+$/i.test(num)) return false;
  const stripped = num.replace(/\s/g, '').replace(/\(([a-z])\)$/i, '$1').replace(/[a-z]$/i, '');
  if (paperNumbers.has(num) || paperNumbers.has(num.replace(/\s/g, ''))) return false;
  if (paperNumbers.has(stripped)) return false;
  const parts = stripped.split('.');
  while (parts.length > 0) {
    if (paperNumbers.has(parts.join('.'))) return false;
    parts.pop();
  }
  return true;
}

/**
 * Auto-fix: strip phantom answer rows and apology rows from the memo.
 * Only the answer-table body rows are eligible — header, separator,
 * and cog-analysis rows are never touched.
 */
export function stripPhantomMemoRows(ctx) {
  if (!ctx?.memo || !ctx?.paper) return null;
  const paperNumbers = buildPaperNumberSet(ctx.paper);
  if (paperNumbers.size === 0) return null;

  const lines = ctx.memo.split('\n');
  const out = [];
  let stripped = 0;
  for (const line of lines) {
    // Apology rows: any pipe row containing apology text.
    if (/^\s*\|/.test(line) && APOLOGY_RE.test(line)) {
      stripped++;
      continue;
    }
    // Phantom rows: pipe row whose first cell is an answer-row number
    // that doesn't appear in the paper. Preserve whitespace inside the
    // cell when testing for "Content Point N" / "Inhoudspunt N" — they
    // need the literal space to match — then strip it for everything
    // else so "5.3 (a)" → "5.3a" matches the paper number set.
    const m = ANSWER_ROW_NUMBER_CELL_RE.exec(line);
    if (m) {
      const raw = m[1].trim();
      const isContentPoint = /^(?:Content\s+Point|Inhoudspunt|C[.\s])\s*\d+$/i.test(raw);
      const num = isContentPoint ? raw : raw.replace(/\s/g, '').replace(/\(([a-z])\)/i, '$1');
      if (isPhantomRowNumber(num, paperNumbers)) {
        stripped++;
        continue;
      }
    }
    out.push(line);
  }
  if (stripped === 0) return null;
  return { memo: out.join('\n') };
}

// ============================================================
// FIX 3 — Memo mark cell repair
// ============================================================
//
// Snaps each memo answer-row's mark cell to the paper sub-question's
// (X) value when they disagree. The pipe-row cell layout is fixed
// (NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK), so we
// rewrite the LAST cell of each matching row.
//
// Only fires for rows whose number maps to a paper sub-question with a
// valid (X) — phantom rows are deleted by FIX 2 in an earlier pass.

function buildPaperMarkMap(paper) {
  const out = new Map();
  for (const line of paper.split('\n')) {
    const m = SUBQ_LINE.exec(line);
    if (!m) continue;
    const marks = parseInt(m[2], 10);
    if (Number.isFinite(marks) && marks > 0) out.set(m[1], marks);
  }
  return out;
}

/**
 * Replace the MARK cell on a single pipe-row matching `questionNumber`.
 * Pipe rows have shape `| <num> | <ans> | <guide> | <level> | <mark> |`.
 * We replace the last numeric cell.
 */
function rewriteMemoMarkCell(memoLine, newMark) {
  // Match the trailing `| <number> |` cell. Allows whitespace and an
  // optional final pipe with trailing whitespace.
  const re = /(\|\s*)\d+(\s*\|\s*)$/;
  if (!re.test(memoLine)) return memoLine;
  return memoLine.replace(re, (_m, pre, post) => `${pre}${newMark}${post}`);
}

/**
 * Auto-fix: rewrite memo mark cells where they disagree with the
 * paper's (X) values. Returns null if every row is already aligned.
 */
export function repairMemoMarks(ctx) {
  if (!ctx?.memo || !ctx?.paper) return null;
  const paperMarks = buildPaperMarkMap(ctx.paper);
  if (paperMarks.size === 0) return null;

  const memoRows = parseMemoAnswerRows(ctx.memo);
  if (memoRows.length === 0) return null;

  // Build a quick lookup: number → expected mark. Includes both the
  // exact number and its no-letter variant ("5.3a" → "5.3").
  const targetByNum = new Map();
  for (const row of memoRows) {
    const num = row.number;
    if (paperMarks.has(num)) targetByNum.set(num, paperMarks.get(num));
    else {
      const stripped = num.replace(/[a-z]$/i, '');
      if (paperMarks.has(stripped)) targetByNum.set(num, paperMarks.get(stripped));
    }
  }
  // Collect mismatches.
  const mismatches = [];
  for (const row of memoRows) {
    const target = targetByNum.get(row.number);
    if (!Number.isFinite(target)) continue;
    if (row.mark !== target) mismatches.push({ number: row.number, was: row.mark, target });
  }
  if (mismatches.length === 0) return null;

  // Walk memo lines, rewriting the mark cell on rows we know to be
  // mismatched. We re-parse the row number from the line itself so we
  // never edit cog-analysis or header rows by accident.
  const lines = ctx.memo.split('\n');
  const targetMap = new Map(mismatches.map((m) => [m.number, m.target]));
  for (let i = 0; i < lines.length; i++) {
    const m = ANSWER_ROW_NUMBER_CELL_RE.exec(lines[i]);
    if (!m) continue;
    const num = m[1].replace(/\s/g, '').replace(/\(([a-z])\)/i, '$1');
    if (!targetMap.has(num)) continue;
    lines[i] = rewriteMemoMarkCell(lines[i], targetMap.get(num));
  }
  return { memo: lines.join('\n') };
}

// ============================================================
// FIX 4 — Section [N] bracket repair
// ============================================================
//
// After paper regen changes individual (X) marks, Claude often forgets
// to update the section [N] block totals (the standalone "[N]" lines
// that appear at the end of each SECTION A / SECTION B block). This
// deterministic fix recomputes each section's [N] from the actual marks
// in that section, eliminating the section_brackets_sum_to_total failure
// without another Claude call.

const SECTION_HEADER_RE_FIX4 = /^(\s*)(SECTION|AFDELING)\s+([A-Z])\b/i;
const STANDALONE_BRACKET_RE = /^\s*\[(\d+)\]\s*$/;

/**
 * Recompute each SECTION's standalone [N] bracket from the actual (X)
 * marks inside that section. Only fires when at least one bracket is
 * wrong. Returns { paper } or null.
 */
export function repairSectionBrackets(ctx) {
  if (!ctx?.paper || !ctx.totalMarks) return null;

  const lines = ctx.paper.split('\n');

  // Collect section start line indices.
  const sectionStarts = [];
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_HEADER_RE_FIX4.test(lines[i])) sectionStarts.push(i);
  }
  if (sectionStarts.length === 0) return null;

  let changed = false;
  for (let s = 0; s < sectionStarts.length; s++) {
    const start = sectionStarts[s];
    const end = s + 1 < sectionStarts.length ? sectionStarts[s + 1] : lines.length;

    // Find the standalone [N] line within this section (search backward).
    let bracketIdx = -1;
    for (let i = end - 1; i >= start; i--) {
      if (STANDALONE_BRACKET_RE.test(lines[i])) { bracketIdx = i; break; }
    }
    if (bracketIdx === -1) continue;

    const existingVal = parseInt(STANDALONE_BRACKET_RE.exec(lines[bracketIdx])[1], 10);
    // Count marks in the section content ABOVE the bracket line.
    const sectionContent = lines.slice(start, bracketIdx).join('\n');
    const actualSum = countMarks(sectionContent);
    if (actualSum > 0 && actualSum !== existingVal) {
      lines[bracketIdx] = `[${actualSum}]`;
      changed = true;
    }
  }
  if (!changed) return null;
  return { paper: lines.join('\n') };
}

// ============================================================
// FIX 5 — Paper footer TOTAL line repair
// ============================================================
//
// After paper regen updates body marks (fixing cover_eq_body), Claude
// sometimes miscalculates the footer TOTAL line, producing a
// footer_matches_cover failure. Since the correct total is always
// ctx.totalMarks, we can fix this deterministically: locate the last
// TOTAL/TOTAAL/TOTALE line in the paper's tail and snap its number to
// ctx.totalMarks.

const FOOTER_TOTAL_RE = /(TOTAL|TOTAAL|TOTALE)\s*:?\s*(?:_{2,}[^/]*\/\s*)?(\d+)/i;

/**
 * Find the last TOTAL/TOTAAL line in the paper (last 30 non-blank lines)
 * and set its number to ctx.totalMarks. Returns { paper } or null.
 */
export function repairPaperFooter(ctx) {
  if (!ctx?.paper || !ctx.totalMarks) return null;

  const lines = ctx.paper.split('\n');
  const nonBlankIdxs = lines.reduce((acc, l, i) => { if (l.trim()) acc.push(i); return acc; }, []);
  const tail = nonBlankIdxs.slice(-30);

  let matchLineIdx = -1;
  let existingVal = -1;
  for (let k = tail.length - 1; k >= 0; k--) {
    const i = tail[k];
    const m = FOOTER_TOTAL_RE.exec(lines[i]);
    if (m) { matchLineIdx = i; existingVal = parseInt(m[2], 10); break; }
  }
  if (matchLineIdx === -1 || existingVal === ctx.totalMarks) return null;

  // Replace the captured number in-place, preserving surrounding format.
  lines[matchLineIdx] = lines[matchLineIdx].replace(
    FOOTER_TOTAL_RE,
    (full, keyword, num) => full.slice(0, full.length - num.length) + ctx.totalMarks,
  );
  return { paper: lines.join('\n') };
}

// ============================================================
// RUNNER
// ============================================================

const FIXES = [
  // Order matters:
  //   1. Repair section brackets FIRST — snaps [N] to actual body marks
  //      so subsequent checks see consistent totals.
  //   2. Repair footer SECOND — sets the TOTAL line to ctx.totalMarks.
  //   3. Strip phantom memo rows THIRD — removes rows before mark repair.
  //   4. Repair memo marks FOURTH — snaps memo cells to paper (X) values.
  //   5. MCQ shuffler LAST — sees the fully corrected memo.
  { id: 'section_brackets', applies: repairSectionBrackets },
  { id: 'paper_footer',     applies: repairPaperFooter },
  { id: 'phantom_memo_rows', applies: stripPhantomMemoRows },
  { id: 'memo_marks',        applies: repairMemoMarks },
  { id: 'mcq_label_shuffle', applies: shuffleMcqLabels },
];

/**
 * Run every registered auto-fix in order. Each fix sees the latest
 * ctx (with prior fixes' updates merged in). Returns
 *   { ctx, applied: string[] }
 * where `applied` is the list of fix ids that produced changes.
 *
 * @param {object} ctx
 * @param {object} [opts]
 * @param {object} [opts.logger]
 * @returns {{ ctx, applied: string[] }}
 */
export function runAutoFixes(ctx, opts = {}) {
  let curr = ctx;
  const applied = [];
  for (const f of FIXES) {
    let updates;
    try {
      updates = f.applies(curr);
    } catch (err) {
      if (opts.logger) {
        opts.logger.warn({ id: f.id, err: err?.message }, 'auto-fix threw — skipping');
      }
      continue;
    }
    if (!updates) continue;
    const merged = { ...curr };
    if (typeof updates.paper === 'string') merged.paper = updates.paper;
    if (typeof updates.memo  === 'string') merged.memo  = updates.memo;
    curr = merged;
    applied.push(f.id);
    if (opts.logger) opts.logger.info({ id: f.id }, 'auto-fix applied');
  }
  return { ctx: curr, applied };
}

// Re-export the fix registry shape so tests can introspect ordering.
export const _FIXES = FIXES;
