// Validates a question plan returned by Claude in Phase 1 of the pipeline.
// The plan is an array of { number, type, topic, marks, cogLevel } entries.
// A plan must:
//   * sum to exactly the requested total marks
//   * hit each cognitive level's mark target within ±tolerance
//   * not exceed the Knowledge-level mark cap with low-demand question types
//   * not use a low-demand type (MCQ, True/False, Matching) at a high
//     cognitive level (upper two levels of the framework)
//   * use at least `minDistinctAtpEntries` distinct ATP entries (prevents
//     one ATP topic hogging the whole paper — the "single-topic test" bug)
//   * keep any single ATP entry under `maxMarksPerAtpEntry` marks
// Returns the plan unchanged if it passes, or null if it's rejected.
//
// IMPORTANT — ATP-entry vs topic-string distinction:
// Earlier versions counted distinct topic STRINGS, but Claude can paraphrase
// one ATP topic into multiple labels ("history of money — barter", "history
// of money — coins", "history of money — paper money", "electronic banking",
// etc.) — all of which collapse to a single ATP entry. String-distinctness
// would pass; ATP-entry-distinctness rejects the monoculture. Audit-driven
// pass replaces the old check.

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
 * `atpTopics` (optional) — the actual ATP topic strings for this cell.
 */
export function planContext({ totalMarks, cog, cogMarks, cogTolerance, atpTopics = [] }) {
  const list = Array.isArray(atpTopics) ? atpTopics.filter((t) => typeof t === 'string' && t.length) : [];
  return {
    totalMarks,
    cog,
    cogMarks,
    cogTolerance,
    maxLowDemandMarks: cogMarks[0],
    highDemandLevels: cog.levels.slice(Math.max(0, cog.levels.length - 2)),
    atpTopics: list,
    // Require ≥ 3 distinct ATP entries when the ATP has enough of them,
    // otherwise match what's available. Worksheets and small-mark papers
    // still need ≥ 2 if there's any diversity to be had.
    minDistinctAtpEntries: list.length >= 3 ? 3 : Math.max(1, list.length),
    // Cap any single ATP entry at 50% of marks (rounded up so a 25-mark
    // paper allows 13 but not 14). Prevents the "one topic" failure mode.
    maxMarksPerAtpEntry: Math.ceil(totalMarks * 0.5),
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

  // 5 + 6. Topic diversity — count distinct ATP ENTRIES, not topic strings.
  //    For each plan question, fuzzy-match the topic field against the ATP
  //    list. Sum marks per ATP entry. The plan must use at least
  //    minDistinctAtpEntries distinct ATP entries, and no single ATP entry
  //    can hold more than maxMarksPerAtpEntry marks.
  //    Skip these checks if atpTopics is empty — no data to match against.
  if (ctx.atpTopics && ctx.atpTopics.length) {
    const atpMarkMap = new Map(); // atpIndex (or -1 for unmatched) → marks
    for (const q of plan.questions) {
      const idx = matchAtpEntry(q.topic, ctx.atpTopics);
      const marks = parseInt(q.marks, 10) || 0;
      atpMarkMap.set(idx, (atpMarkMap.get(idx) || 0) + marks);
    }
    // Distinct ATP entries used (excluding the unmatched bucket -1, which
    // is itself a sign of a poorly-labelled plan but doesn't artificially
    // boost the diversity count).
    const matched = new Map([...atpMarkMap].filter(([k]) => k !== -1));
    const distinctEntries = matched.size;
    if (distinctEntries < ctx.minDistinctAtpEntries) {
      log(`Plan uses ${distinctEntries} distinct ATP entr${distinctEntries === 1 ? 'y' : 'ies'}, minimum ${ctx.minDistinctAtpEntries} — rejecting`);
      return null;
    }
    for (const [idx, marks] of matched) {
      if (marks > ctx.maxMarksPerAtpEntry) {
        const entry = ctx.atpTopics[idx];
        const preview = entry.length > 60 ? entry.slice(0, 60) + '…' : entry;
        log(`ATP entry "${preview}" has ${marks} marks, max ${ctx.maxMarksPerAtpEntry} — rejecting`);
        return null;
      }
    }
  } else {
    // Fallback: when no ATP list is available, fall back to the old
    // string-distinctness check so we still reject obvious monocultures
    // even on subjects/cells with sparse ATP data.
    const topicMarkMap = new Map();
    for (const q of plan.questions) {
      const topic = normaliseTopic(q.topic);
      if (!topic) continue;
      topicMarkMap.set(topic, (topicMarkMap.get(topic) || 0) + (parseInt(q.marks, 10) || 0));
    }
    if (topicMarkMap.size < ctx.minDistinctAtpEntries) {
      log(`Plan uses ${topicMarkMap.size} distinct topic(s), minimum ${ctx.minDistinctAtpEntries} — rejecting`);
      return null;
    }
    for (const [topic, marks] of topicMarkMap) {
      if (marks > ctx.maxMarksPerAtpEntry) {
        log(`Topic "${topic}" has ${marks} marks, max ${ctx.maxMarksPerAtpEntry} — rejecting`);
        return null;
      }
    }
  }

  return plan;
}

// Case-insensitive, whitespace-collapsed topic key.
function normaliseTopic(topic) {
  if (topic == null) return '';
  return String(topic).trim().toLowerCase().replace(/\s+/g, ' ');
}

// ATP topic strings often contain a leading category and a colon (e.g.
// "Whole numbers: counting, ordering, comparing, …"). When the plan's
// `topic` paraphrases the entry — "place value" / "comparing whole numbers"
// — we want to recognise it as that ATP entry. We tokenise both into
// content words (≥ 4 chars, lowercased) and pick the entry with the most
// overlap. Returns the index in `atpTopics` of the best match, or -1 if
// no entry shares ≥ 1 distinctive content word.
//
// Distinctive words are content-bearing nouns/verbs that survive the ≥ 4-char
// filter; very common stop words (THE, AND, etc.) are too short to pass.
export function matchAtpEntry(planTopic, atpTopics) {
  const planWords = contentWords(planTopic);
  if (!planWords.size) return -1;

  let bestIdx = -1;
  let bestOverlap = 0;
  for (let i = 0; i < atpTopics.length; i++) {
    const atpWords = contentWords(atpTopics[i]);
    let overlap = 0;
    for (const w of planWords) if (atpWords.has(w)) overlap++;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIdx = i;
    }
  }
  return bestIdx;
}

const STOP_WORDS = new Set([
  'with', 'from', 'into', 'onto', 'over', 'their', 'them', 'they',
  'this', 'that', 'these', 'those', 'using', 'about', 'when', 'where',
  'while', 'such', 'each', 'some', 'most', 'more', 'less', 'than', 'then',
  'have', 'been', 'being', 'will', 'would', 'should', 'could', 'must',
  'between', 'within',
]);

function contentWords(s) {
  if (!s) return new Set();
  const norm = String(s).toLowerCase()
    // strip punctuation but keep word-internal apostrophes
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
  return new Set(norm);
}

// Exposed for tests.
export const __internals = { matchAtpEntry, contentWords };
