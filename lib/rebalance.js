// Deterministic mark-budget rebalancer.
//
// Sonnet 4.6 fills the schema with content of the right shape but its
// leaf-mark sums drift off the requested totalMarks by ±1 to ±6 marks.
// JSON Schema cannot express the cross-field sum constraint, so the API
// can't reject this — we fix it deterministically post-call.
//
// Algorithm (one ±1 nudge per iteration):
//   1. delta = totalMarks - leafSum
//   2. If delta < 0 (paper is too heavy): pick the cog level whose actual
//      marks are MOST over their prescribed share, then nudge -1 on the
//      largest leaf in that level (content distortion is relative; a
//      5→4 swing reads cleaner than a 1→0 floor break).
//   3. If delta > 0 (paper is too light): pick the cog level whose actual
//      marks are MOST under prescribed, nudge +1 on the largest leaf in it.
//   4. Mirror the nudge into memo.answers[questionNumber].marks so the
//      memo and paper stay in lockstep (assertResource invariant).
//   5. Repeat until delta == 0 or no candidate exists.
//
// Why prefer the largest leaf in a level: relative distortion is smaller.
// A 4-mark Inferential becoming 5 reads naturally; a 1-mark Literal jumping
// to 2 is awkward on a question like "Name the author".

const MAX_ITER = 60; // generous safety net; typical drift resolves in ≤6 iters.

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

  const finalSum = leaves.reduce((a, l) => a + (l.marks || 0), 0);
  return { adjustments, finalSum, targetSum, converged: finalSum === targetSum };
}
