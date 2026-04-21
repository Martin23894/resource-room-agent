// Count the total marks in a generated question paper.
//
// Primary pattern: `(N)` at end-of-line — the CAPS convention for per-item
// mark allocation. Falls back to `[N]` block totals only when no per-line
// marks are found (some memo-only outputs use the block form).

const PER_ITEM = /\((\d+)\)\s*$/gm;
const BLOCK_TOTAL = /\[(\d+)\]/g;

export function countMarks(text) {
  if (!text) return 0;
  let total = 0;
  let match;
  while ((match = PER_ITEM.exec(text)) !== null) total += parseInt(match[1], 10);
  if (total === 0) {
    while ((match = BLOCK_TOTAL.exec(text)) !== null) total += parseInt(match[1], 10);
  }
  return total;
}
