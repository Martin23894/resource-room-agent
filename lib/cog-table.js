// Deterministic emission AND correction of the cognitive-level analysis table.
//
// History: this file used to ONLY correct (Bug 5 reconciliation). The
// cog analysis was emitted by Claude in Phase 3B and we patched the
// Actual Marks column afterwards. Five separate audits showed Claude
// also miscomputing the Prescribed Marks column, the Actual % column,
// the per-level breakdown headers and the breakdown listed items — the
// pattern that motivated the structural refactor.
//
// New approach (post Phase-1 refactor): the LLM produces only content
// (questions, answers, marking guidance, rubric, extension). Code emits
// every numeric structure in the memo:
//   - The cog analysis pipe table (level/% /prescribed/actual/actual %)
//   - The TOTAL row (always sums each column exactly)
//   - The breakdown lines per level (headers and items always agree)
//
// `buildCogAnalysisTable` is the new emitter. `correctCogAnalysisTable`
// stays as a defensive belt-and-braces pass for any RTT memo that still
// goes through the Claude-driven path.

import { i18n } from './i18n.js';
import { largestRemainder } from './cognitive.js';

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

// ─── Deterministic emitter ─────────────────────────────────────────────
//
// `buildCogAnalysisTable` produces the cog-analysis section of a memo
// from first principles: the cog framework + cover total + the parsed
// answer rows. By construction:
//
//   - Prescribed Marks sum to TOTAL (largest-remainder allocation)
//   - Actual Marks sum to whatever the answer rows summed to
//   - Actual % sum to 100% (within rounding) when answer rows sum to TOTAL
//   - Each breakdown header equals the bracketed-items sum on that line
//
// The five audit cycles all found Claude breaking at least one of these
// invariants. Generating the section in code means the only way they can
// diverge is if the answer rows themselves are inconsistent — which Phase
// 4 / answer-table validators are responsible for catching.

function fmtPctEmit(actual, total) {
  if (!total) return '0.0%';
  return ((actual * 100) / total).toFixed(1) + '%';
}

// Match an answer-row level label (in any language / casing / whitespace)
// to one canonical English level. Tries the canonical English name first,
// then the language-specific translation if a translations table is given.
function levelMatcher(canonicalLevel, translations) {
  const normalise = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const en = normalise(canonicalLevel);
  const af = normalise(translations?.[canonicalLevel] || '');
  return (rowLabel) => {
    const r = normalise(rowLabel);
    return r === en || (af && r === af);
  };
}

/**
 * Build the cognitive-level analysis section of a memo.
 *
 * @param {object} args
 * @param {Array<{number: string, level: string, mark: number}>} args.answerRows
 *        Output of parseMemoAnswerRows on the memo's answer table.
 * @param {{ levels: string[], pcts: number[] }} args.cog
 *        Framework metadata from getCogLevels(subject). `levels` is in
 *        canonical English; we translate for Afrikaans output.
 * @param {number} args.totalMarks   Paper total — drives prescribed marks
 *        AND the % denominator. We do NOT recompute prescribed against the
 *        answer-row sum, since the cover total is the authoritative answer.
 * @param {string} [args.language='English']
 * @param {boolean} [args.isBarretts=false]  Use Barrett's-style heading and
 *        the Combined Barrett's column header instead of Cognitive Level.
 * @param {string} [args.framework]  Optional framework label for the heading
 *        ("Bloom's Taxonomy (DoE cognitive levels)" / "Barrett's Taxonomy").
 *        If omitted, no parenthetical is appended to the heading.
 *
 * @returns {{
 *   heading: string,
 *   table: string,
 *   breakdown: string,
 *   actualByLevel: Record<string, number>,
 *   totalActual: number,
 *   text: string
 * }}
 */
export function buildCogAnalysisTable({
  answerRows,
  cog,
  totalMarks,
  language = 'English',
  isBarretts = false,
  framework,
}) {
  const L = i18n(language);
  const translations = L.cogLevels || {};
  const cols = isBarretts ? L.cogTable?.barrettCols : L.cogTable?.cols;
  const totalLabel = L.totalLabel || 'TOTAL';
  const marksWord = L.marksWord || 'marks';

  const prescribed = largestRemainder(totalMarks, cog.pcts);

  // Per-level rows. We tally ALL answer rows that match each canonical
  // level (in either English or the translated form) so a memo with mixed
  // labels still adds up correctly.
  const rows = cog.levels.map((canonical, i) => {
    const matches = levelMatcher(canonical, translations);
    const matchingRows = answerRows.filter((r) => matches(r.level));
    const actual = matchingRows.reduce((s, r) => s + r.mark, 0);
    return {
      canonical,
      label: translations[canonical] || canonical,
      pct: cog.pcts[i],
      prescribed: prescribed[i],
      actual,
      actualPct: fmtPctEmit(actual, totalMarks),
      items: matchingRows,
    };
  });

  const totalActual = rows.reduce((s, r) => s + r.actual, 0);
  const totalActualPct = fmtPctEmit(totalActual, totalMarks);

  // Pipe table.
  const headerCells = [
    cols?.level || 'Cognitive Level',
    cols?.pct || 'Prescribed %',
    cols?.prescribed || 'Prescribed Marks',
    cols?.actual || 'Actual Marks',
    cols?.actualPct || 'Actual %',
  ];
  const rowToLine = (cells) => '| ' + cells.join(' | ') + ' |';
  const tableLines = [
    rowToLine(headerCells),
    rowToLine(headerCells.map(() => '---')),
  ];
  for (const r of rows) {
    tableLines.push(rowToLine([r.label, `${r.pct}%`, String(r.prescribed), String(r.actual), r.actualPct]));
  }
  tableLines.push(rowToLine([
    totalLabel,
    '100%',
    String(totalMarks),
    String(totalActual),
    // When the counted answer rows match the cover total exactly, this is
    // 100%. When they don't, we surface the actual % so the discrepancy is
    // visible — Bug 39 prevention (no fabricated 100% on a drifted paper).
    totalActual === totalMarks ? '100%' : totalActualPct,
  ]));

  // Breakdown lines: each non-zero level lists its sub-questions with
  // bracketed marks, summed to the level total. Header `(X marks)` and the
  // trailing `= X marks` are computed from the same source so they cannot
  // disagree (Bug 47 prevention).
  const breakdownLines = rows.map((r) => {
    if (r.actual === 0) {
      return `${r.label} (0 ${marksWord}): — = 0 ${marksWord}`;
    }
    const items = r.items.map((it) => `Q${it.number} (${it.mark})`).join(' + ');
    return `${r.label} (${r.actual} ${marksWord}): ${items} = ${r.actual} ${marksWord}`;
  });

  // Heading.
  const heading = framework && L.cogTable?.heading
    ? L.cogTable.heading(framework)
    : (L.cogTable?.heading ? L.cogTable.heading('').replace(/\s*\(\)\s*$/, '') : 'COGNITIVE LEVEL ANALYSIS');

  const actualByLevel = {};
  for (const r of rows) actualByLevel[r.canonical] = r.actual;

  const text = [
    heading,
    '',
    tableLines.join('\n'),
    '',
    breakdownLines.join('\n\n'),
  ].join('\n');

  return {
    heading,
    table: tableLines.join('\n'),
    breakdown: breakdownLines.join('\n\n'),
    actualByLevel,
    totalActual,
    text,
  };
}
