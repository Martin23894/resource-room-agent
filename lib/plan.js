// Validates a question plan returned by Claude in Phase 1 of the pipeline.
// The plan is an array of { number, type, topic, marks, cogLevel } entries.
// A plan must:
//   * sum to exactly the requested total marks
//   * hit each cognitive level's mark target within ±tolerance
//   * not exceed the Knowledge-level mark cap with low-demand question types
//   * not use a low-demand type (MCQ, True/False, Matching) at a high
//     cognitive level (upper two levels of the framework)
// Returns the plan unchanged if it passes, or null if it's rejected.

export const LOW_DEMAND_TYPES = [
  'MCQ',
  'True/False',
  'True-False',
  'True or False',
  'Matching',
];

function isLowDemandType(type) {
  const t = (type || '').toLowerCase();
  return LOW_DEMAND_TYPES.some((ld) => t.includes(ld.toLowerCase()));
}

/**
 * Build the plan-validator input context from the pipeline's cognitive state.
 * `cog` comes from getCogLevels(); `cogMarks` from largestRemainder(total, cog.pcts).
 */
export function planContext({ totalMarks, cog, cogMarks, cogTolerance }) {
  return {
    totalMarks,
    cog,
    cogMarks,
    cogTolerance,
    maxLowDemandMarks: cogMarks[0],
    highDemandLevels: cog.levels.slice(Math.max(0, cog.levels.length - 2)),
  };
}

/**
 * Validate a plan. Returns the plan object if valid, or null if rejected.
 * A `logger` with a .info() method may be passed to record the specific
 * reason for rejection (useful for debugging plan-retry loops).
 */
export function validatePlan(plan, ctx, logger) {
  const log = logger?.info ? logger.info.bind(logger) : () => {};

  if (!plan || !Array.isArray(plan.questions) || plan.questions.length === 0) {
    return null;
  }

  // 1. Total marks must match exactly.
  const planTotal = plan.questions.reduce((s, q) => s + (parseInt(q.marks, 10) || 0), 0);
  if (planTotal !== ctx.totalMarks) {
    log(`Plan total ${planTotal} !== requested ${ctx.totalMarks} — rejecting`);
    return null;
  }

  // 2. Each cognitive level must land within ±tolerance of its target.
  const cogActual = Object.fromEntries(ctx.cog.levels.map((l) => [l, 0]));
  for (const q of plan.questions) {
    if (cogActual[q.cogLevel] !== undefined) {
      cogActual[q.cogLevel] += parseInt(q.marks, 10) || 0;
    }
  }
  for (let i = 0; i < ctx.cog.levels.length; i++) {
    const level = ctx.cog.levels[i];
    const actual = cogActual[level] || 0;
    const target = ctx.cogMarks[i];
    if (Math.abs(actual - target) > ctx.cogTolerance) {
      log(`Cog level "${level}" has ${actual} marks, target ${target} ±${ctx.cogTolerance} — rejecting`);
      return null;
    }
  }

  // 3. Low-demand types combined must not exceed the Knowledge-level cap.
  const lowDemandTotal = plan.questions
    .filter((q) => isLowDemandType(q.type))
    .reduce((s, q) => s + (parseInt(q.marks, 10) || 0), 0);
  if (lowDemandTotal > ctx.maxLowDemandMarks) {
    log(`Low-demand types total ${lowDemandTotal} marks, max ${ctx.maxLowDemandMarks} — rejecting`);
    return null;
  }

  // 4. High-cog-level questions must not use a low-demand type.
  for (const q of plan.questions) {
    if (ctx.highDemandLevels.includes(q.cogLevel) && isLowDemandType(q.type)) {
      log(`Q${q.number} is ${q.cogLevel} but uses ${q.type} — rejecting`);
      return null;
    }
  }

  return plan;
}
