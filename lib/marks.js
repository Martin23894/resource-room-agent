// Count the total marks in a generated question paper.
//
// Primary pattern: `(N)` at end-of-line — the CAPS convention for per-item
// mark allocation. Falls back to `[N]` block totals only when no per-line
// marks are found (some memo-only outputs use the block form).
//
// Hierarchical-question handling: when a parent question line carries a
// summary `(N)` total AND the lines below it are lettered sub-parts that
// each carry their own `(X)` mark, the parent's `(N)` is a SUMMARY of the
// children, not an additional mark. Counting both inflates the total.
// (Resource 5 audit: Q12.2 "Old system. (4)" with sub-parts (1)+(3) was
// counted as 8 instead of 4, cascading into a 3-way mark inconsistency
// where countMarks lied to Phase 2a's drift correction.)
//
// Detection rule: a line is a "parent total" (and its `(N)` should be
// skipped) iff the next non-blank line within a small window starts with
// a parenthesised letter `(a)`, `(b)`, `(c)` … AND that line itself ends
// with its own `(X)` mark. Plain numbered sub-questions like "12.1" /
// "12.2" don't trigger the rule because each carries its own marks
// independently — the parent there is a section heading without (N).

const PER_ITEM = /\((\d+)\)\s*$/;
const BLOCK_TOTAL = /\[(\d+)\]/g;

// "(a)" / "(b)" / … sub-part marker at line start, with its own (X) at end.
// We use `\([a-z]\)` (no \b after the closing paren — there's no word
// boundary between two non-word chars like `)` and ` `, so adding `\b`
// would silently prevent the match).
const LETTERED_SUBPART_WITH_MARK = /^\s*\([a-z]\)\s.*\(\d+\)\s*$/i;

// A numbered-question line: "12.2 ..." or "5.3.1 ..." at line start.
// Lettered sub-parts like "(a) ..." are NOT parents and must not trigger
// the skip — only numbered questions can be parents.
const NUMBERED_QUESTION_LINE = /^\s*\d+(?:\.\d+)*\s/;

// A numbered question line whose first content is itself an inline sub-part
// marker — e.g. "12.1 (a) Identify three options. (3)". Here the (3) is the
// mark for sub-part (a), NOT a parent summary, so we must NOT skip it. The
// pattern requires the lettered marker immediately after the number+space,
// avoiding accidental matches on stems containing "(a) for example" mid-sentence.
const INLINE_LETTERED_SUBPART = /^\s*\d+(?:\.\d+)*\s+\([a-z]\)\s/i;

// How many lines below a candidate parent we'll scan looking for a
// lettered sub-part. Real CAPS papers have at most a few blank lines
// between a parent question and its first (a) sub-part.
const PARENT_LOOKAHEAD = 6;

function isParentSummaryLine(lines, idx) {
  const line = lines[idx];
  // The candidate line must itself end in (N).
  if (!PER_ITEM.test(line)) return false;
  // Only NUMBERED question lines can be parents. A lettered (a) line that
  // happens to have lettered (b)/(c) siblings below it is itself a sub-part,
  // not a parent — counting it would under-count by skipping a real child.
  if (!NUMBERED_QUESTION_LINE.test(line)) return false;
  // Inline sub-part: "12.1 (a) ... (3)" — the (3) is sub-part (a)'s mark,
  // not a parent summary. Don't skip.
  if (INLINE_LETTERED_SUBPART.test(line)) return false;
  // Lettered sub-part with its OWN mark must appear within the next
  // PARENT_LOOKAHEAD non-blank lines, before any other numbered question
  // (e.g. "13.1") starts.
  let scanned = 0;
  for (let j = idx + 1; j < lines.length && scanned < PARENT_LOOKAHEAD; j++) {
    const tr = lines[j].trim();
    if (tr === '') continue;
    scanned++;
    // Stop scanning if we've moved past this question into the next
    // numbered sub-question (e.g. parent was "12.2 …" and we just hit
    // "12.3 …" or "13.1 …"). A new numbered header means the parent has
    // no lettered children.
    if (NUMBERED_QUESTION_LINE.test(tr)) return false;
    if (LETTERED_SUBPART_WITH_MARK.test(lines[j])) return true;
  }
  return false;
}

export function countMarks(text) {
  if (!text) return 0;
  const lines = text.split('\n');
  let total = 0;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(PER_ITEM);
    if (!m) continue;
    if (isParentSummaryLine(lines, i)) continue; // skip parent summary
    total += parseInt(m[1], 10);
  }

  if (total === 0) {
    let bm;
    BLOCK_TOTAL.lastIndex = 0;
    while ((bm = BLOCK_TOTAL.exec(text)) !== null) total += parseInt(bm[1], 10);
  }
  return total;
}
