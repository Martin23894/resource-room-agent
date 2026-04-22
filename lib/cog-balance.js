// Post-Phase-2 verification that the written paper's cognitive-level
// distribution matches the plan's per-question assignments. Runs in pure
// code (no Claude call) by mapping each sub-question in the paper to its
// plan entry and summing marks per cognitive level.
//
// Used by the pipeline to trigger a SINGLE Phase-2 rewrite when the paper
// drifts from the plan by more than the tolerance (e.g. the plan says
// "Q5 is Problem Solving (4 marks)" but Claude wrote Q5 as a recall
// question contributing to Knowledge instead).

// Matches a learner-paper sub-question line like:
//   "1.1 Name three provinces. (3)"
//   "5.3a Explain … (4)"
//   "1.2.1 Calculate … (2)"
const SUBQ_LINE = /^\s*(\d+(?:\.\d+)*(?:[a-z])?)\s+.*\((\d+)\)\s*$/;

// Build a lookup from the plan that maps each question number (as written
// in the plan, with any "Q" prefix stripped) to its cognitive level.
function buildPlanLookup(plan) {
  const lookup = new Map();
  for (const q of plan?.questions || []) {
    const key = String(q.number || '').replace(/^Q/i, '').trim();
    if (key) lookup.set(key, q.cogLevel);
  }
  return lookup;
}

// For a paper sub-question like "5.3a", find the plan's cogLevel:
//   1. Exact match — "5.3a"
//   2. Strip trailing letter — "5.3"
//   3. Walk up the dotted parts — "5.3" → "5"
function findCogLevel(number, lookup) {
  if (lookup.has(number)) return lookup.get(number);

  const noLetter = number.replace(/[a-z]$/i, '');
  if (noLetter !== number && lookup.has(noLetter)) return lookup.get(noLetter);

  const parts = noLetter.split('.');
  while (parts.length >= 1) {
    const key = parts.join('.');
    if (lookup.has(key)) return lookup.get(key);
    if (parts.length === 1) break;
    parts.pop();
  }
  return null;
}

/**
 * Verify the paper's cognitive-level distribution against the plan.
 *
 * @param {object} args
 * @param {string} args.paper       The full question-paper text.
 * @param {object} args.plan        The validated plan with questions[].
 * @param {object} args.cog         getCogLevels() result — { levels, pcts }.
 * @param {number[]} args.cogMarks  Prescribed marks per level (from largestRemainder).
 * @param {number} args.tolerance   Allowed ±marks per level before flagging drift.
 *
 * @returns {{
 *   clean: boolean,
 *   actualByLevel: Record<string, number>,
 *   imbalances: Array<{level: string, prescribed: number, actual: number, drift: number}>,
 *   unmapped: Array<{number: string, marks: number}>,
 *   lowConfidence: boolean
 * }}
 *
 * A result is `clean: true` when every level is within ±tolerance of its
 * prescribed marks. When `lowConfidence: true` (too many paper questions
 * did not map to any plan entry), callers should treat the result as
 * unreliable and SKIP the rebalance rewrite.
 */
export function verifyCogBalance({ paper, plan, cog, cogMarks, tolerance }) {
  const lookup = buildPlanLookup(plan);
  const actualByLevel = Object.fromEntries(cog.levels.map((l) => [l, 0]));
  const unmapped = [];

  for (const line of String(paper || '').split('\n')) {
    const m = SUBQ_LINE.exec(line);
    if (!m) continue;
    const number = m[1];
    const marks = parseInt(m[2], 10);
    if (!Number.isFinite(marks) || marks <= 0) continue;

    const level = findCogLevel(number, lookup);
    if (!level || actualByLevel[level] === undefined) {
      unmapped.push({ number, marks });
      continue;
    }
    actualByLevel[level] += marks;
  }

  const totalMapped = Object.values(actualByLevel).reduce((a, b) => a + b, 0);
  const totalUnmapped = unmapped.reduce((s, u) => s + u.marks, 0);
  const mappedRatio = (totalMapped + totalUnmapped) > 0
    ? totalMapped / (totalMapped + totalUnmapped)
    : 1;
  const lowConfidence = mappedRatio < 0.8;

  const imbalances = lowConfidence
    ? []
    : cog.levels
        .map((level, i) => ({
          level,
          prescribed: cogMarks[i],
          actual: actualByLevel[level] || 0,
          drift: (actualByLevel[level] || 0) - cogMarks[i],
        }))
        .filter((row) => Math.abs(row.drift) > tolerance);

  return {
    clean: imbalances.length === 0,
    actualByLevel,
    imbalances,
    unmapped,
    lowConfidence,
  };
}

/**
 * Format an imbalance result as a feedback string for the Phase-2 rewrite
 * prompt. Shows each level's prescribed vs actual marks with drift.
 */
export function formatImbalances(result) {
  return result.imbalances
    .map((r) => `  ${r.level}: plan requires ${r.prescribed} marks, paper has ${r.actual} (drift ${r.drift > 0 ? '+' : ''}${r.drift})`)
    .join('\n');
}
