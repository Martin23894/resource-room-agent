// Deterministic mark-budget rebalancer.
//
// Sonnet 4.6 fills the schema with content of the right shape but its
// leaf-mark sums drift off the requested totalMarks AND across cognitive
// levels. JSON Schema cannot express either cross-field constraint, so
// the API can't reject these — we fix them deterministically post-call.
//
// Two phases:
//
// PHASE 1 — paper-sum nudge (one ±1 nudge per iteration):
//   1. delta = totalMarks - leafSum
//   2. If delta < 0 (paper too heavy): pick the cog level whose actual
//      marks are MOST over their prescribed share, then nudge -1 on the
//      largest leaf in that level (relative distortion is smaller —
//      4→3 reads cleaner than 1→0 floor break).
//   3. If delta > 0 (paper too light): pick the cog level whose actual
//      marks are MOST under prescribed, nudge +1 on the largest leaf in it.
//   4. Mirror into memo.answers[questionNumber].marks (lockstep invariant).
//   5. Repeat until delta == 0 or no candidate exists.
//
// PHASE 2 — paired cog-distribution swaps (one ±1/+1 swap per iteration):
//   Once paper-sum is correct, cog distribution can still be off (model
//   over-supplies one level and under-supplies another at constant total).
//   Single-leaf nudges can't fix this — they always change the paper sum.
//   Paired swaps shift one mark FROM the most over-supplied level TO the
//   most under-supplied level by simultaneously decrementing one leaf and
//   incrementing another:
//   1. Find the level with max positive gap (over-supplied, gap > tolerance).
//   2. Find the level with max negative gap (under-supplied, gap < -tolerance).
//   3. Decrement the largest leaf in the over level (must have marks > 1
//      so we don't break the floor).
//   4. Increment the largest leaf in the under level.
//   5. Mirror both into memo.
//   6. Repeat until both sides are within tolerance of prescribed.
//
// Tolerance is ±1: we try to get every level to exactly prescribed, but
// stop swapping once both the over and under gaps are ≤1, since further
// swaps would oscillate or distort content too much.

const MAX_ITER = 60;        // single-nudge phase cap
const MAX_SWAP_ITER = 40;   // paired-swap phase cap
const COG_TOLERANCE = 1;    // stop swapping when over and under gaps both ≤ this

export function rebalanceMarks(resource) {
  if (!resource?.meta) return { adjustments: [], finalSum: 0, targetSum: 0, converged: false };
  const targetSum = resource.meta.totalMarks;
  const prescribed = new Map(
    (resource.meta.cognitiveFramework?.levels || []).map((l) => [l.name, l.prescribedMarks || 0]),
  );

  // Collect every leaf in document order. Composites are skipped — only
  // leaves carry marks per the schema.
  const leaves = [];
  const walk = (q) => {
    if (Array.isArray(q.subQuestions)) q.subQuestions.forEach(walk);
    else leaves.push(q);
  };
  for (const s of resource.sections || []) for (const q of s.questions || []) walk(q);

  const answerByNum = new Map(
    (resource.memo?.answers || []).map((a) => [a.questionNumber, a]),
  );

  const adjustments = [];
  let converged = false;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const sum = leaves.reduce((a, l) => a + (l.marks || 0), 0);
    const delta = targetSum - sum;
    if (delta === 0) { converged = true; break; }

    const wantDecrement = delta < 0;

    // Score levels by gap = actual - prescribed.
    const tally = new Map();
    for (const l of leaves) tally.set(l.cognitiveLevel, (tally.get(l.cognitiveLevel) || 0) + (l.marks || 0));
    const levelOrder = [...prescribed.keys()]
      .map((name) => ({ name, gap: (tally.get(name) || 0) - (prescribed.get(name) || 0) }))
      .sort((a, b) => (wantDecrement ? b.gap - a.gap : a.gap - b.gap));

    // Find the largest adjustable leaf in the most-off level. Fall back to
    // subsequent levels if the top one has no candidate (e.g. all 1-mark
    // when we need to decrement).
    let chosen = null;
    for (const { name } of levelOrder) {
      const candidates = leaves
        .filter((l) => l.cognitiveLevel === name)
        .filter((l) => (wantDecrement ? (l.marks || 0) > 1 : true))
        .sort((a, b) => (b.marks || 0) - (a.marks || 0));
      if (candidates.length > 0) { chosen = candidates[0]; break; }
    }
    if (!chosen) {
      // Last resort: ignore the cog distribution and just adjust any eligible leaf.
      const candidates = leaves
        .filter((l) => (wantDecrement ? (l.marks || 0) > 1 : true))
        .sort((a, b) => (b.marks || 0) - (a.marks || 0));
      if (candidates.length === 0) break; // cannot make progress
      chosen = candidates[0];
    }

    const before = chosen.marks;
    chosen.marks = before + (wantDecrement ? -1 : 1);
    const ans = answerByNum.get(chosen.number);
    if (ans) ans.marks = chosen.marks;

    adjustments.push({
      questionNumber: chosen.number,
      level: chosen.cognitiveLevel,
      before,
      after: chosen.marks,
    });
  }

  // ── PHASE 2 — paired cog-distribution swaps ─────────────────────
  // Only run if paper sum is correct. Otherwise phase 1 is still
  // working and we don't want to pre-empt it with same-sum swaps.
  if (converged) {
    for (let iter = 0; iter < MAX_SWAP_ITER; iter++) {
      const tally = new Map();
      for (const l of leaves) tally.set(l.cognitiveLevel, (tally.get(l.cognitiveLevel) || 0) + (l.marks || 0));

      const gaps = [...prescribed.entries()].map(([name, pres]) => ({
        name, gap: (tally.get(name) || 0) - pres,
      }));
      const over = gaps.filter((g) => g.gap > COG_TOLERANCE).sort((a, b) => b.gap - a.gap)[0];
      const under = gaps.filter((g) => g.gap < -COG_TOLERANCE).sort((a, b) => a.gap - b.gap)[0];
      if (!over || !under) break; // converged within tolerance

      const overLeaf = leaves
        .filter((l) => l.cognitiveLevel === over.name && (l.marks || 0) > 1)
        .sort((a, b) => (b.marks || 0) - (a.marks || 0))[0];
      const underLeaf = leaves
        .filter((l) => l.cognitiveLevel === under.name)
        .sort((a, b) => (b.marks || 0) - (a.marks || 0))[0];
      if (!overLeaf || !underLeaf) break; // can't make progress

      const overBefore = overLeaf.marks;
      const underBefore = underLeaf.marks;
      overLeaf.marks = overBefore - 1;
      underLeaf.marks = underBefore + 1;
      const overAns = answerByNum.get(overLeaf.number);
      const underAns = answerByNum.get(underLeaf.number);
      if (overAns) overAns.marks = overLeaf.marks;
      if (underAns) underAns.marks = underLeaf.marks;

      adjustments.push({
        questionNumber: overLeaf.number,
        level: overLeaf.cognitiveLevel,
        before: overBefore,
        after: overLeaf.marks,
        kind: 'swap-out',
      });
      adjustments.push({
        questionNumber: underLeaf.number,
        level: underLeaf.cognitiveLevel,
        before: underBefore,
        after: underLeaf.marks,
        kind: 'swap-in',
      });
    }
  }

  const finalSum = leaves.reduce((a, l) => a + (l.marks || 0), 0);
  return { adjustments, finalSum, targetSum, converged: finalSum === targetSum };
}
