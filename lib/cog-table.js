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
// We accept rows like:
//   | 1.1 | answer | guidance | Low Order | 1 |
//   | 4.2 | answer | guidance | Middle Order | 2 |
//   | Q5.3a | answer | guidance | Inferential | 3 |
const ROW_NUMBER_RE = /^Q?\s*\d+(?:\.\d+)*[a-z]?$/i;
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
    if (!Number.isFinite(m) || m <= 0) continue;
    if (!level || level.length === 0) continue;
    out.push({ number: num.replace(/^Q\s*/i, ''), level, mark: m });
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
 * @param {string} memoText            The full memo (answer table +
 *                                     cog analysis + breakdown).
 * @param {object} args
 * @param {string[]} args.levels       Cognitive level names in the order
 *                                     they appear in the cog table (e.g.
 *                                     ['Low Order','Middle Order','High Order']).
 * @param {number}   args.totalMarks   Paper total — used for % computation
 *                                     and to overwrite the TOTAL row's
 *                                     Actual Marks cell.
 * @returns {{ text: string, changed: boolean, computedByLevel: Record<string, number>, totalCounted: number }}
 */
export function correctCogAnalysisTable(memoText, { levels, totalMarks }) {
  if (typeof memoText !== 'string' || memoText.length === 0) {
    return { text: memoText, changed: false, computedByLevel: {}, totalCounted: 0 };
  }
  const rows = parseMemoAnswerRows(memoText);
  if (rows.length === 0) {
    return { text: memoText, changed: false, computedByLevel: {}, totalCounted: 0 };
  }
  const tally = tallyByLevel(rows);

  // Map level keys to the prompt-supplied level names so we know which
  // value to write into each cog-table row.
  const levelKey = (l) => l.replace(/\s+/g, ' ').trim().toLowerCase();
  const computedByLevel = {};
  for (const lvl of levels) computedByLevel[lvl] = 0;
  for (const [tallyLvl, count] of tally.entries()) {
    // Find the matching prompt-level by case-insensitive equality.
    const k = levelKey(tallyLvl);
    const match = levels.find((l) => levelKey(l) === k);
    if (match) computedByLevel[match] = (computedByLevel[match] || 0) + count;
  }
  const totalCounted = Object.values(computedByLevel).reduce((a, b) => a + b, 0);

  const lines = memoText.split('\n');
  const t = findCogTable(lines);
  if (!t) {
    return { text: memoText, changed: false, computedByLevel, totalCounted };
  }

  // Walk the rows between header and total. For each, find which prompt
  // level its first cell matches and rewrite the Actual Marks / % cells.
  let changed = false;
  const stop = t.totalIdx === -1 ? lines.length : t.totalIdx;
  for (let i = t.headerIdx + 1; i < stop; i++) {
    const cells = splitCells(lines[i]);
    if (!cells || cells.length < 3) continue;
    // Skip separator rows.
    if (cells.every((c) => /^[-:]+$/.test(c) || c === '')) continue;
    const firstCell = cells[0];
    if (TOTAL_FIRST_CELL_RE.test(firstCell)) continue;
    const k = levelKey(firstCell);
    const match = levels.find((l) => levelKey(l) === k);
    if (!match) continue;
    const correctMarks = computedByLevel[match] ?? 0;
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
