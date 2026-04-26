// Deterministic correction of the cognitive-level analysis table.
//
// Bug 5 — Claude's Phase 3B (standard) and Phase D (RTT) sometimes write
// the cog analysis table with Actual Marks values that DON'T match the
// answer-table marks. The Phase 4 verifier (Haiku) catches some but not
// all of these, and the correction round can introduce its own errors.
//
// This module fixes that with pure code:
//   1. Parse the memo answer table for (number, level, mark) rows.
//   2. Sum marks per cognitive level.
//   3. Find the cog analysis pipe table in the memo and rewrite its
//      "Actual Marks" and "Actual %" columns to match the parsed sums.
//   4. Optionally rewrite the per-level breakdown text so its claimed
//      total agrees with the bracketed item sum.
//
// We never invent levels or marks — we only RECONCILE a cog table that
// disagrees with its own answer rows. If the memo has no answer table or
// no cog table, we return the input unchanged.

// Pipe-table row that has at least 5 cells, with the trailing cell being
// an integer mark and a recognisable cognitive-level cell at index 3.
//
// We accept question-number cells in any of these shapes:
//   "1.1"        → bare numbered sub-question
//   "1.1.1"      → multi-level (e.g. CAPS Maths)
//   "5.3a"       → letter suffix without parens
//   "5.3(a)"     → letter suffix with parens (Paper 10 Maths memo format)
//   "Q1.1"       → Q-prefix
//   "Q5.3(a)"    → both
//   "8.1 (a)"    → optional space before the parenthesised letter
const ROW_NUMBER_RE = /^Q?\s*\d+(?:\.\d+)*\s*(?:\(?[a-z]\)?)?$/i;
const HEADER_FIRST_CELL_RE = /^(NO\.|NR\.|N°|#)$/i;

function splitCells(line) {
  // Trim leading/trailing pipes, then split. Empty leading/trailing cells
  // (from the outer pipes) are dropped.
  const stripped = line.trim();
  if (!stripped.startsWith('|')) return null;
  const cells = stripped.split('|').map((s) => s.trim());
  // Drop the outer empties from `| a | b |` → `['', 'a', 'b', '']`
  if (cells.length >= 2 && cells[0] === '') cells.shift();
  if (cells.length >= 1 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/**
 * Parse a memo's answer-table rows into structured records.
 *
 * Returns an array of `{ number, level, mark }`. Header rows, separator
 * rows (`|---|---|`), and rows whose mark cell is non-numeric are skipped.
 *
 * Tolerant of:
 *   - English and Afrikaans column headers
 *   - Whitespace around cells
 *   - Question numbers with or without "Q" prefix
 *   - Sub-letter suffixes ("5.3a")
 */
export function parseMemoAnswerRows(memoText) {
  if (typeof memoText !== 'string' || memoText.length === 0) return [];
  const out = [];
  for (const line of memoText.split('\n')) {
    const cells = splitCells(line);
    if (!cells || cells.length < 5) continue;
    // Skip pipe-separator rows like `|---|---|`
    if (cells.every((c) => /^[-:]+$/.test(c) || c === '')) continue;
    const [num, , , level, mark] = cells;
    if (!num || HEADER_FIRST_CELL_RE.test(num)) continue;
    if (!ROW_NUMBER_RE.test(num)) continue;
    const m = parseInt(mark, 10);
    // Accept zero-mark rows: the Bug 9 fix prompts the model to emit ALL
    // FOUR Barrett's levels even if a level has 0 marks. Reject only
    // negative or non-numeric marks.
    if (!Number.isFinite(m) || m < 0) continue;
    if (!level || level.length === 0) continue;
    out.push({ number: num.replace(/^Q\s*/i, '').trim(), level, mark: m });
  }
  return out;
}

/**
 * Sum marks per cognitive level, returning a Map keyed by level.
 *
 * Levels are matched case-insensitively and with normalised whitespace
 * so "Low Order" / "low order" / "Low  Order" all collapse to the same
 * bucket. The returned map preserves the casing of the FIRST occurrence.
 */
export function tallyByLevel(rows) {
  const counts = new Map();
  const keyMap = new Map(); // normalised key → display label
  for (const r of rows) {
    const key = r.level.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!keyMap.has(key)) keyMap.set(key, r.level.replace(/\s+/g, ' ').trim());
    counts.set(keyMap.get(key), (counts.get(keyMap.get(key)) || 0) + r.mark);
  }
  return counts;
}

// Cog analysis table header row: pipe table whose first cell is
// "Cognitive Level" / "Kognitiewe Vlak" / "Barrett's Level" / "Barrett se
// Vlak" and that has BOTH "Prescribed" / "Voorgeskrewe" AND "Actual" /
// "Werklike" cells. We accept either label set.
const COG_TABLE_FIRST_CELL_RE = /^(Cognitive Level|Kognitiewe Vlak|Barrett'?s Level|Barrett se Vlak)$/i;
const COG_TABLE_PRESCRIBED_CELL_RE = /^Prescribed/i;
const COG_TABLE_PRESCRIBED_AFR_RE = /^Voorgeskrewe/i;
const COG_TABLE_ACTUAL_CELL_RE = /^Actual/i;
const COG_TABLE_ACTUAL_AFR_RE = /^Werklike/i;
const TOTAL_FIRST_CELL_RE = /^(TOTAL|TOTAAL|TOTALE)$/i;

/**
 * Locate the cognitive-level analysis table in the memo. Returns
 *   { headerIdx, totalIdx, columns: { actual, actualPct } }
 * or null if no recognisable cog table is found.
 *
 * `lines` is the memo split on newlines (we modify lines in place when
 * applying the correction so we want to keep the index reference live).
 *
 * The header row determines which columns hold "Actual Marks" and
 * "Actual %". We tolerate one of those columns being missing — we only
 * write the cells that exist.
 */
function findCogTable(lines) {
  for (let i = 0; i < lines.length; i++) {
    const cells = splitCells(lines[i]);
    if (!cells || cells.length < 3) continue;
    if (!COG_TABLE_FIRST_CELL_RE.test(cells[0])) continue;
    // Must have both a "Prescribed" cell AND an "Actual" cell — that's
    // what tells us this is the analysis table, not the per-section
    // | Cognitive Level | Questions | Marks | summary table.
    const hasPrescribed = cells.some((c) => COG_TABLE_PRESCRIBED_CELL_RE.test(c) || COG_TABLE_PRESCRIBED_AFR_RE.test(c));
    const hasActual = cells.some((c) => COG_TABLE_ACTUAL_CELL_RE.test(c) || COG_TABLE_ACTUAL_AFR_RE.test(c));
    if (!hasPrescribed || !hasActual) continue;

    // Column indices for Actual Marks and Actual %.
    let actualIdx = -1;
    let actualPctIdx = -1;
    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c];
      if (COG_TABLE_ACTUAL_CELL_RE.test(cell) || COG_TABLE_ACTUAL_AFR_RE.test(cell)) {
        if (/%/.test(cell)) actualPctIdx = c;
        else if (actualIdx === -1) actualIdx = c;
      }
    }
    if (actualIdx === -1 && actualPctIdx === -1) continue;

    // Find the TOTAL row that closes the table.
    let totalIdx = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const tCells = splitCells(lines[j]);
      if (!tCells) {
        // Blank or non-pipe line — table ended without a TOTAL row.
        if (lines[j].trim() === '') break;
        continue;
      }
      if (TOTAL_FIRST_CELL_RE.test(tCells[0] || '')) { totalIdx = j; break; }
    }

    return { headerIdx: i, totalIdx, actualIdx, actualPctIdx };
  }
  return null;
}

/**
 * Rewrite a single cell in a pipe-table row. Preserves the row's leading
 * and trailing pipes plus surrounding whitespace pattern so the line
 * looks identical apart from the new cell value.
 */
function rewriteCell(line, cellIdx, newValue) {
  const cells = splitCells(line);
  if (!cells || cellIdx < 0 || cellIdx >= cells.length) return line;
  cells[cellIdx] = newValue;
  return '| ' + cells.join(' | ') + ' |';
}

function fmtPct(actual, total) {
  if (!total) return '0.0%';
  return ((actual * 100) / total).toFixed(1) + '%';
}

/**
 * Correct the cog analysis table in `memoText` so its Actual Marks /
 * Actual % cells agree with the marks summed from the answer table.
 *
 * Matching the answer-table levels to the cog-table rows is done by
 * normalised string equality on the LEVEL NAME ITSELF, not against a
 * caller-supplied list. This means the function works language-agnostically
 * — an Afrikaans memo with "Kennis / Roetine Prosedures / …" labels
 * reconciles against an Afrikaans cog table the same way an English memo
 * reconciles against an English cog table. (The earlier design accepted a
 * `levels` parameter and silently skipped rows whose label didn't appear
 * there, which broke reconciliation for every Afrikaans Maths memo.)
 *
 * @param {string} memoText            The full memo (answer table +
 *                                     cog analysis + breakdown).
 * @param {object} args
 * @param {number} args.totalMarks     Paper total — used for % computation
 *                                     and to overwrite the TOTAL row's
 *                                     Actual Marks cell.
 * @param {string[]} [args.levels]     OPTIONAL hint listing the canonical
 *                                     level names (in display casing). If
 *                                     supplied, computedByLevel keys use
 *                                     these names; otherwise it uses the
 *                                     labels found in the memo. Either
 *                                     way, the in-place rewrite is driven
 *                                     by what is in the memo.
 * @returns {{ text: string, changed: boolean, computedByLevel: Record<string, number>, totalCounted: number }}
 */
export function correctCogAnalysisTable(memoText, { levels, totalMarks } = {}) {
  if (typeof memoText !== 'string' || memoText.length === 0) {
    return { text: memoText, changed: false, computedByLevel: {}, totalCounted: 0 };
  }
  const rows = parseMemoAnswerRows(memoText);
  if (rows.length === 0) {
    return { text: memoText, changed: false, computedByLevel: {}, totalCounted: 0 };
  }
  const tally = tallyByLevel(rows);

  const levelKey = (l) => l.replace(/\s+/g, ' ').trim().toLowerCase();

  // computedByLevel reports the per-level totals using the LABELS FOUND
  // IN THE MEMO. The earlier design keyed by caller-supplied English
  // names which always returned zeros for Afrikaans memos, masking
  // reconciliation success behind a misleading log line.
  const tallyByKey = new Map(); // normalised key → marks
  for (const [lvl, count] of tally.entries()) {
    tallyByKey.set(levelKey(lvl), count);
  }
  const computedByLevel = {};
  for (const [lvl, count] of tally.entries()) computedByLevel[lvl] = count;
  const totalCounted = Array.from(tallyByKey.values()).reduce((a, b) => a + b, 0);

  const lines = memoText.split('\n');
  const t = findCogTable(lines);
  if (!t) {
    return { text: memoText, changed: false, computedByLevel, totalCounted };
  }

  // Walk the rows between header and total. For each, look the first
  // cell up in the tallyByKey map; if found, rewrite the Actual Marks
  // and Actual % cells.
  let changed = false;
  const stop = t.totalIdx === -1 ? lines.length : t.totalIdx;
  for (let i = t.headerIdx + 1; i < stop; i++) {
    const cells = splitCells(lines[i]);
    if (!cells || cells.length < 3) continue;
    if (cells.every((c) => /^[-:]+$/.test(c) || c === '')) continue;
    const firstCell = cells[0];
    if (TOTAL_FIRST_CELL_RE.test(firstCell)) continue;
    const k = levelKey(firstCell);
    if (!tallyByKey.has(k)) {
      // The cog-table row's level label has no matching answer-row level.
      // Default to 0 so the cell is corrected if it claims a non-zero
      // value — this catches the case where Claude wrote a level into the
      // cog table that has no answer rows backing it up.
      const correctMarks = 0;
      if (t.actualIdx !== -1 && cells[t.actualIdx] !== '0') {
        lines[i] = rewriteCell(lines[i], t.actualIdx, '0');
        changed = true;
      }
      if (t.actualPctIdx !== -1 && cells[t.actualPctIdx] !== '0.0%') {
        lines[i] = rewriteCell(lines[i], t.actualPctIdx, '0.0%');
        changed = true;
      }
      continue;
    }
    const correctMarks = tallyByKey.get(k);
    const correctPct = fmtPct(correctMarks, totalMarks);

    if (t.actualIdx !== -1) {
      const before = cells[t.actualIdx];
      const after = String(correctMarks);
      if (before !== after) {
        lines[i] = rewriteCell(lines[i], t.actualIdx, after);
        changed = true;
      }
    }
    if (t.actualPctIdx !== -1) {
      const before = cells[t.actualPctIdx];
      const after = correctPct;
      if (before !== after) {
        lines[i] = rewriteCell(lines[i], t.actualPctIdx, after);
        changed = true;
      }
    }
  }

  // Repair the TOTAL row so its Actual Marks cell equals `totalCounted`.
  if (t.totalIdx !== -1) {
    const cells = splitCells(lines[t.totalIdx]);
    if (cells) {
      if (t.actualIdx !== -1 && cells[t.actualIdx] !== String(totalCounted)) {
        lines[t.totalIdx] = rewriteCell(lines[t.totalIdx], t.actualIdx, String(totalCounted));
        changed = true;
      }
      if (t.actualPctIdx !== -1) {
        const totalPct = totalMarks ? '100%' : '0%';
        if (cells[t.actualPctIdx] !== totalPct) {
          lines[t.totalIdx] = rewriteCell(lines[t.totalIdx], t.actualPctIdx, totalPct);
          changed = true;
        }
      }
    }
  }

  return { text: lines.join('\n'), changed, computedByLevel, totalCounted };
}
