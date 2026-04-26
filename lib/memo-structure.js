// Structural validator for memo output.
//
// Used in Phase 4 memo correction to detect fragment-shaped responses
// where Claude returned only the cognitive analysis (or only the answer
// table) and dropped the other half. The previous guard ("correction
// length > 500 chars") accepted these partial responses because the cog
// analysis alone is easily > 500 chars.
//
// We check for BOTH of the two mandatory sections by header markers,
// covering the English and Afrikaans column labels.
//
// F7 (Resource 1/2 audit Bug A): the validator ALSO returns a count of
// answer-table rows so callers can distinguish "header present, body
// missing" from "complete table". The previous binary `answerTable: bool`
// let a 1-row memo pass `retryRttSection`'s guard even when 6 rows were
// expected.

// Pipe-table row shape: `| NO. | ANSWER | MARKING GUIDANCE | … |`
// The row that acts as the header always contains the "NO." / "NR." cell
// followed by the ANSWER / ANTWOORD cell. We tolerate extra whitespace and
// the optional trailing pipe.
const ANSWER_TABLE_HEADER_RE = /\|\s*(NO\.|NR\.|No\.|Nr\.)\s*\|\s*(ANSWER|ANTWOORD)\s*\|/i;

// The cognitive analysis section either
//   (a) uses a section heading "COGNITIVE LEVEL ANALYSIS" / "KOGNITIEWE VLAK ANALISE", or
//   (b) starts with a pipe-table header row whose first cell is "Cognitive Level"
//       / "Kognitiewe Vlak" and the second cell contains "Prescribed" / "Voorgeskrewe".
//
// We match EITHER form. We do NOT match the bare string "COGNITIVE LEVEL" on
// its own — that phrase also appears as a column label inside the answer
// table header (`| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |`).
const COG_ANALYSIS_HEADING_RE = /(COGNITIVE\s+LEVEL\s+ANALYSIS|KOGNITIEWE\s+VLAK\s+ANALISE)/i;
const COG_ANALYSIS_TABLE_HEADER_RE = /\|\s*(Cognitive Level|Kognitiewe Vlak)\s*\|\s*(Prescribed|Voorgeskrewe)/i;

/**
 * Does the memo text contain the row-by-row answer table?
 * Matches both English (NO. | ANSWER) and Afrikaans (NR. | ANTWOORD).
 */
export function hasAnswerTable(memoText) {
  if (typeof memoText !== 'string' || memoText.length === 0) return false;
  return ANSWER_TABLE_HEADER_RE.test(memoText);
}

/**
 * Does the memo text contain the cognitive-level analysis section?
 */
export function hasCogAnalysis(memoText) {
  if (typeof memoText !== 'string' || memoText.length === 0) return false;
  return COG_ANALYSIS_HEADING_RE.test(memoText) || COG_ANALYSIS_TABLE_HEADER_RE.test(memoText);
}

// Body row of an answer table: a pipe row whose first cell is a question
// number (1.1, 1.1.1, 5.3a, 5.3(a), Q1.1) or a Section-C content-point
// label (Content Point N, Inhoudspunt N, C.N) — matching the parser in
// lib/cog-table.js.
const ANSWER_ROW_NUMBER_CELL_RE = /^\s*\|\s*(?:Q\s*)?(?:\d+(?:\.\d+)*\s*(?:\(?[a-z]\)?)?|(?:Content\s+Point|Inhoudspunt|C[.\s]?)\s*\d+)\s*\|/i;

/**
 * Count the number of answer-table body rows in a memo. Header and
 * separator rows are excluded; only rows whose first cell looks like a
 * sub-question number or content-point label are counted.
 */
export function countAnswerTableRows(memoText) {
  if (typeof memoText !== 'string' || memoText.length === 0) return 0;
  let n = 0;
  for (const line of memoText.split('\n')) {
    if (ANSWER_ROW_NUMBER_CELL_RE.test(line)) n++;
  }
  return n;
}

/**
 * A memo is structurally complete iff it contains BOTH the answer table
 * and the cognitive analysis. Returns a small object describing what's
 * present, so the caller can log and decide.
 *
 * `answerRowCount` (F7) lets callers distinguish "header alone" from
 * "header + N rows", which `retryRttSection` uses to retry sections
 * whose tables were truncated to just the header.
 */
export function validateMemoStructure(memoText) {
  const answerTable = hasAnswerTable(memoText);
  const cogAnalysis = hasCogAnalysis(memoText);
  const answerRowCount = answerTable ? countAnswerTableRows(memoText) : 0;
  const complete = answerTable && cogAnalysis;
  return {
    complete,
    answerTable,
    answerRowCount,
    cogAnalysis,
    length: typeof memoText === 'string' ? memoText.length : 0,
  };
}
