// Deterministic mark-budget rebalancer.
//
// Sonnet 4.6 fills the schema with content of the right shape but its
// leaf-mark sums drift off the requested totalMarks AND across cognitive
// levels. JSON Schema cannot express either cross-field constraint, so
// the API can't reject these — we fix them deterministically post-call.
//
// Three phases (in order; later phases run only if earlier ones converged):
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
// PHASE 3 — drop+bump (when Phase 2 stalls on a 1-mark-only over level):
//   The dominant residual failure mode in RTT papers is over-supplied
//   Reorganisation/Literal where every leaf is worth 1 mark. Phase 2
//   refuses to decrement (would break the marks≥1 floor) so the drift
//   sticks at -2/-3 on Inferential. Phase 3 breaks the stall by
//   removing one 1-mark leaf from the over level and bumping an under
//   leaf by +1. Each iteration shifts 2 marks of cog distribution
//   (over loses 1, under gains 1) at constant paper sum. Side effects:
//   the dropped leaf's memo entry is removed and any composite/section
//   that becomes empty is pruned. Numbering gaps are accepted (CAPS
//   papers occasionally have non-contiguous numbering).
//
//   Safety guards prevent shrinking a section below 2 leaves and
//   capping iterations to MAX_DROP_ITER so we can't strip a paper.
//
// Tolerance is ±1: we try to get every level to exactly prescribed, but
// stop swapping once both the over and under gaps are ≤1, since further
// swaps would oscillate or distort content too much.

const MAX_ITER = 60;        // single-nudge phase cap
const MAX_SWAP_ITER = 40;   // paired-swap phase cap
const MAX_DROP_ITER = 6;    // phase 3 cap — each drop strips a question
const COG_TOLERANCE = 1;    // stop swapping when over and under gaps both ≤ this
const MIN_LEAVES_PER_SECTION = 2; // don't shrink a section below this on drop

// Marker we prepend so a re-rebalance recognises and replaces an existing
// correction line rather than stacking notes.
const MARK_OVERRIDE_PREFIX = '[Marks awarded:';

/**
 * Keep `markingGuidance` consistent with the post-rebalance `marks` total.
 *
 * The original text was authored by the model when the question was worth
 * its first allocation (e.g. "Award 2 marks for correct answer. Award 1 mark
 * for working."). When rebalance changes the leaf's marks, the body prose
 * is now factually wrong but it still carries pedagogical value (rationale,
 * acceptable-answer hints). We can't reliably auto-rewrite the breakdown
 * — counts are split across multiple "1 mark for X" clauses — so we prefix
 * an authoritative override line. The teacher reads the corrected total
 * first; the original text follows as context.
 *
 * Idempotent: repeated calls update the prefix in place.
 */
function reconcileMarkingGuidance(answer, newMarks) {
  if (!answer) return;
  const noun = newMarks === 1 ? 'mark' : 'marks';
  const overrideLine = `${MARK_OVERRIDE_PREFIX} ${newMarks} ${noun}]`;

  const existing = typeof answer.markingGuidance === 'string' ? answer.markingGuidance : '';
  const stripped = existing.replace(
    new RegExp('^\\s*\\[Marks awarded:[^\\]]*\\]\\s*', ''),
    '',
  );
  answer.markingGuidance = stripped
    ? `${overrideLine} ${stripped}`
    : overrideLine;
}

// Walk the resource and collect every leaf in document order. Returns
// flat leaves[] for callers that don't care about parents (Phase 1, 2).
function collectLeaves(resource) {
  const leaves = [];
  const walk = (q) => {
    if (Array.isArray(q.subQuestions)) q.subQuestions.forEach(walk);
    else leaves.push(q);
  };
  for (const s of resource.sections || []) for (const q of s.questions || []) walk(q);
  return leaves;
}

// Find the section that contains a given leaf (by reference). Used by
// Phase 3 safety check to ensure we don't shrink a section below
// MIN_LEAVES_PER_SECTION.
function findSectionOfLeaf(resource, target) {
  for (const s of resource.sections || []) {
    if (sectionContainsLeaf(s, target)) return s;
  }
  return null;
}
function sectionContainsLeaf(section, target) {
  const walk = (q) => {
    if (q === target) return true;
    if (Array.isArray(q.subQuestions)) return q.subQuestions.some(walk);
    return false;
  };
  return (section.questions || []).some(walk);
}
function countLeavesInSection(section) {
  let n = 0;
  const walk = (q) => {
    if (Array.isArray(q.subQuestions)) q.subQuestions.forEach(walk);
    else n++;
  };
  (section.questions || []).forEach(walk);
  return n;
}

// Splice a leaf out of its parent array. Returns true on success.
function removeLeafFromTree(resource, target) {
  const dropFrom = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === target) { arr.splice(i, 1); return true; }
      if (Array.isArray(arr[i].subQuestions)) {
        if (dropFrom(arr[i].subQuestions)) return true;
      }
    }
    return false;
  };
  for (const s of resource.sections || []) {
    if (dropFrom(s.questions || [])) return true;
  }
  return false;
}

// Remove the memo answer matching a question number. Returns true on success.
function removeMemoAnswer(resource, questionNumber) {
  const arr = resource.memo?.answers;
  if (!Array.isArray(arr)) return false;
  const idx = arr.findIndex((a) => a.questionNumber === questionNumber);
  if (idx === -1) return false;
  arr.splice(idx, 1);
  return true;
}

// After Phase 3 may have stripped leaves, prune any composite (or section)
// whose subQuestions / questions array is now empty. Composites become
// schema-invalid (subQuestions.minItems = 1) so this is required after drops.
function pruneEmptyContainers(resource) {
  const pruneSubs = (arr) => arr.filter((q) => {
    if (Array.isArray(q.subQuestions)) {
      q.subQuestions = pruneSubs(q.subQuestions);
      return q.subQuestions.length > 0;
    }
    return true;
  });
  for (const s of resource.sections || []) {
    if (Array.isArray(s.questions)) s.questions = pruneSubs(s.questions);
  }
}

export function rebalanceMarks(resource) {
  if (!resource?.meta) return { adjustments: [], finalSum: 0, targetSum: 0, converged: false };
  const targetSum = resource.meta.totalMarks;
  const prescribed = new Map(
    (resource.meta.cognitiveFramework?.levels || []).map((l) => [l.name, l.prescribedMarks || 0]),
  );

  let leaves = collectLeaves(resource);

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
    if (ans) {
      ans.marks = chosen.marks;
      reconcileMarkingGuidance(ans, chosen.marks);
    }

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
      // Swap as long as ANY level is over-supplied beyond tolerance, into
      // whichever level is most under (any deficit, not just deficits beyond
      // tolerance — otherwise an over-supplied level can be stranded when
      // every under level is only -1).
      const over = gaps.filter((g) => g.gap > COG_TOLERANCE).sort((a, b) => b.gap - a.gap)[0];
      const under = gaps.filter((g) => g.gap < 0).sort((a, b) => a.gap - b.gap)[0];
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
      if (overAns) {
        overAns.marks = overLeaf.marks;
        reconcileMarkingGuidance(overAns, overLeaf.marks);
      }
      if (underAns) {
        underAns.marks = underLeaf.marks;
        reconcileMarkingGuidance(underAns, underLeaf.marks);
      }

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

  // ── PHASE 3 — drop+bump for stalled 1-mark over levels ──────────
  // Phase 2 stalls when the over-supplied level has no leaves with
  // marks > 1 to decrement. Drop one 1-mark leaf from over and bump
  // a leaf in under by +1. Net: paper-sum constant, distribution
  // shifts by 2 marks (1 from over, 1 to under).
  //
  // Trigger: any under level with gap < -tolerance (significant deficit),
  // sourced from any over level with gap > 0. Phase 2's tighter trigger
  // (`over.gap > tolerance`) misses cases where the deficit is spread
  // across multiple +1 surpluses — a common RTT pattern where every
  // non-Inferential level lands at +1 and Inferential lands at -3.
  if (converged) {
    for (let iter = 0; iter < MAX_DROP_ITER; iter++) {
      // Refresh leaves cache — Phase 3 mutates the tree.
      leaves = collectLeaves(resource);

      const tally = new Map();
      for (const l of leaves) tally.set(l.cognitiveLevel, (tally.get(l.cognitiveLevel) || 0) + (l.marks || 0));
      const gaps = [...prescribed.entries()].map(([name, pres]) => ({
        name, gap: (tally.get(name) || 0) - pres,
      }));
      const under = gaps.filter((g) => g.gap < -COG_TOLERANCE).sort((a, b) => a.gap - b.gap)[0];
      if (!under) break; // under within tolerance — stop

      // Pick an over level (gap > 0) that has only 1-mark leaves — that's
      // exactly the case Phase 2 couldn't handle. If a candidate over level
      // has a marks>1 leaf, prefer swap-via-rerun-of-Phase-2 logic over a
      // content drop. We do that here inline: if any over level has a
      // marks>1 leaf, pick that one and swap (mark-preserving) instead.
      const oversByPriority = gaps
        .filter((g) => g.gap > 0)
        .sort((a, b) => b.gap - a.gap);
      if (oversByPriority.length === 0) break;

      // Try mark-preserving swap first (Phase 2 with relaxed gap > 0 trigger).
      let didSwap = false;
      for (const over of oversByPriority) {
        const overSwappable = leaves
          .filter((l) => l.cognitiveLevel === over.name && (l.marks || 0) > 1)
          .sort((a, b) => (b.marks || 0) - (a.marks || 0))[0];
        if (!overSwappable) continue;
        // Pick smallest under leaf so successive iterations spread the
        // bump across multiple under-supplied questions instead of
        // stacking all marks on one (5×1 → 5×2 reads better than 4×1 + 1×5).
        const underLeafSwap = leaves
          .filter((l) => l.cognitiveLevel === under.name)
          .sort((a, b) => (a.marks || 0) - (b.marks || 0))[0];
        if (!underLeafSwap) continue;

        const ob = overSwappable.marks;
        const ub = underLeafSwap.marks;
        overSwappable.marks = ob - 1;
        underLeafSwap.marks = ub + 1;
        const oa = answerByNum.get(overSwappable.number);
        const ua = answerByNum.get(underLeafSwap.number);
        if (oa) { oa.marks = overSwappable.marks; reconcileMarkingGuidance(oa, overSwappable.marks); }
        if (ua) { ua.marks = underLeafSwap.marks; reconcileMarkingGuidance(ua, underLeafSwap.marks); }
        adjustments.push(
          { questionNumber: overSwappable.number, level: over.name, before: ob, after: overSwappable.marks, kind: 'swap-out' },
          { questionNumber: underLeafSwap.number, level: under.name, before: ub, after: underLeafSwap.marks, kind: 'swap-in' },
        );
        didSwap = true;
        break;
      }
      if (didSwap) continue;

      // No marks>1 leaf available across any over level — fall through to drop+bump.
      const over = oversByPriority[0];

      // Pick a 1-mark leaf to drop. Prefer leaves whose section can spare
      // one without falling below MIN_LEAVES_PER_SECTION.
      const overOneMarkLeaves = leaves.filter((l) => l.cognitiveLevel === over.name && (l.marks || 0) === 1);
      let toDrop = null;
      for (const leaf of overOneMarkLeaves) {
        const sec = findSectionOfLeaf(resource, leaf);
        if (!sec) continue;
        if (countLeavesInSection(sec) > MIN_LEAVES_PER_SECTION) { toDrop = leaf; break; }
      }
      if (!toDrop) break; // no safe drop candidate — stop

      // Pick the SMALLEST leaf in `under` to bump by +1 — spreads the
      // gain across multiple under-supplied questions instead of stacking
      // it on one (e.g. 5×1m → 5×2m reads better than 4×1m + 1×5m).
      const underLeaf = leaves
        .filter((l) => l.cognitiveLevel === under.name)
        .sort((a, b) => (a.marks || 0) - (b.marks || 0))[0];
      if (!underLeaf) break;

      // Execute the drop.
      const droppedNum = toDrop.number;
      removeLeafFromTree(resource, toDrop);
      removeMemoAnswer(resource, droppedNum);
      answerByNum.delete(droppedNum);

      // Execute the bump.
      const underBefore = underLeaf.marks;
      underLeaf.marks = underBefore + 1;
      const underAns = answerByNum.get(underLeaf.number);
      if (underAns) {
        underAns.marks = underLeaf.marks;
        reconcileMarkingGuidance(underAns, underLeaf.marks);
      }

      adjustments.push({
        questionNumber: droppedNum,
        level: over.name,
        before: 1,
        after: 0,
        kind: 'dropped',
      });
      adjustments.push({
        questionNumber: underLeaf.number,
        level: underLeaf.cognitiveLevel,
        before: underBefore,
        after: underLeaf.marks,
        kind: 'bumped',
      });
    }

    // Drops may have left an empty composite/section. Prune so
    // assertResource (subQuestions.minItems = 1) doesn't reject.
    pruneEmptyContainers(resource);
    leaves = collectLeaves(resource);
  }

  const finalSum = leaves.reduce((a, l) => a + (l.marks || 0), 0);
  return { adjustments, finalSum, targetSum, converged: finalSum === targetSum };
}
