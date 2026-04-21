// Pure helpers for CAPS cognitive-level and mark-allocation math.
// Duplicated in public/index.html for the sidebar preview — that duplication
// is removed in Phase 1.3 when the frontend fetches shared config from /api.

/**
 * Largest Remainder Method.
 * Splits `total` into buckets sized by `pcts` (which must sum to 100) such that
 * the bucket values are integers and sum to exactly `total`.
 * Fractional leftovers are awarded to the buckets with the largest remainders.
 *
 * @param {number} total  whole-number total to distribute
 * @param {number[]} pcts percentages (integers, summing to 100)
 * @returns {number[]}    integer allocations, same length as pcts, summing to total
 */
export function largestRemainder(total, pcts) {
  const raw = pcts.map((p) => (total * p) / 100);
  const floored = raw.map(Math.floor);
  const remainders = raw.map((v, i) => ({ i, r: v - floored[i] }));
  const deficit = total - floored.reduce((a, b) => a + b, 0);
  remainders.sort((a, b) => b.r - a.r);
  for (let k = 0; k < deficit; k++) floored[remainders[k].i]++;
  return floored;
}

/**
 * Converts a total mark count to the CAPS-prescribed time allocation.
 * Mapping source: DBE CAPS Intermediate/Senior Phase time guides.
 */
export function marksToTime(m) {
  if (m <= 10) return '15 minutes';
  if (m <= 20) return '30 minutes';
  if (m <= 25) return '45 minutes';
  if (m <= 30) return '45 minutes';
  if (m <= 50) return '1 hour';
  if (m <= 60) return '1 hour 30 minutes';
  if (m <= 70) return '1 hour 45 minutes';
  if (m <= 75) return '2 hours';
  if (m <= 100) return '2 hours 30 minutes';
  return Math.round((m * 1.5) / 60) + ' hours';
}

/**
 * Returns the DBE cognitive-level framework for a given subject name.
 * Maths, NST, Social Sciences, LO/Life Skills, EMS, Technology → Bloom's.
 * English/Afrikaans HL and FAL → Barrett's (Response-to-Text papers).
 * Subject matching is substring-based on a lower-cased name so English and
 * Afrikaans variants both match (e.g. "Wiskunde" → Maths, "Huistaal" → HL).
 */
export function getCogLevels(subj) {
  const s = (subj || '').toLowerCase();
  if (s.includes('math') || s.includes('wiskunde'))
    return { levels: ['Knowledge', 'Routine Procedures', 'Complex Procedures', 'Problem Solving'], pcts: [25, 45, 20, 10] };
  if (s.includes('home language') || s.includes('huistaal'))
    return { levels: ['Literal', 'Reorganisation', 'Inferential', 'Evaluation and Appreciation'], pcts: [20, 20, 40, 20] };
  if (s.includes('additional') || s.includes('addisionele') || s.includes('eerste'))
    return { levels: ['Literal', 'Reorganisation', 'Inferential', 'Evaluation and Appreciation'], pcts: [20, 20, 40, 20] };
  if (s.includes('natural science') && !s.includes('technology'))
    return { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [50, 35, 15] };
  if (s.includes('natural sciences and technology') || s.includes('nst') || s.includes('natuur'))
    return { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [50, 35, 15] };
  // Life Skills and Life Orientation are checked BEFORE Social Sciences so that
  // "Life Skills — Personal and Social Wellbeing" (which contains "social")
  // matches Life Skills' 30/40/30 instead of the Social Sciences 30/50/20 split.
  if (s.includes('life') || s.includes('lewens') || s.includes('orientation') || s.includes('oriëntering'))
    return { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30, 40, 30] };
  if (s.includes('social') || s.includes('sosiale') || s.includes('geskieden') || s.includes('history') || s.includes('geography') || s.includes('geografie'))
    return { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30, 50, 20] };
  if (s.includes('technolog') || s.includes('tegnol'))
    return { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30, 50, 20] };
  if (s.includes('economic') || s.includes('ekonom'))
    return { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30, 50, 20] };
  return { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30, 40, 30] };
}

/** True when the framework is Barrett's (English/Afrikaans Response-to-Text). */
export function isBarretts(cog) {
  return cog?.levels?.[0] === 'Literal';
}
