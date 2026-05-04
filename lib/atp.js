// Single source of truth for the CAPS Annual Teaching Plan topic database.
// Loaded once at startup from data/atp.json. Both the backend pipeline and
// the frontend (via /api/atp) read from here.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '..', 'data', 'atp.json');
const PACING_PATH = join(__dirname, '..', 'data', 'atp-pacing.json');

const raw = JSON.parse(readFileSync(DATA_PATH, 'utf8'));

// Shape: { intermediate: [...subject names...], senior: [...subject names...] }
export const SUBJECTS = raw.subjects;

// CAPS exam-scope rule.
//   Term 1 assessment → Term 1 content only.
//   Term 2 exam       → Term 1 + Term 2 content.
//   Term 3 assessment → Term 3 content only.
//   Term 4 exam       → Term 3 + Term 4 content.
// Stored with integer keys; JSON stringifies them as strings so we normalise.
export const EXAM_SCOPE = Object.fromEntries(
  Object.entries(raw.examScope).map(([k, v]) => [Number(k), v.map(Number)]),
);

// Flatten the `{subject: {grade: {term: {topics, tasks}}}}` shape into two
// lookup tables matching the legacy inline shapes used by the pipeline:
//   ATP[subject][grade][term]       → string[]        (topic list)
//   ATP_TASKS[subject][grade][term] → TaskDef[]       (resource types + marks)
export const ATP = {};
export const ATP_TASKS = {};
for (const [subject, grades] of Object.entries(raw.atp)) {
  ATP[subject] = {};
  ATP_TASKS[subject] = {};
  for (const [grade, terms] of Object.entries(grades)) {
    const g = Number(grade);
    ATP[subject][g] = {};
    ATP_TASKS[subject][g] = {};
    for (const [term, cell] of Object.entries(terms)) {
      const t = Number(term);
      ATP[subject][g][t] = cell.topics || [];
      ATP_TASKS[subject][g][t] = cell.tasks || [];
    }
  }
}

/**
 * Returns the CAPS topic list for a given subject/grade/term.
 * When `isExamType` is true, the list is expanded per the EXAM_SCOPE rule
 * so that Term 2 exams cover T1+T2 and Term 4 exams cover T3+T4.
 */
export function getATPTopics(subject, grade, term, isExamType) {
  const scope = isExamType ? (EXAM_SCOPE[term] || [term]) : [term];
  return scope.flatMap((t) => (ATP[subject]?.[grade]?.[t]) || []);
}

// Exposed verbatim so the /api/atp endpoint can serialise it to the frontend.
export const ATP_RAW = raw;

// ---------------------------------------------------------------------------
// Rich CAPS pacing data (data/atp-pacing.json). Loaded lazily-but-once at
// import time. Contains the full subtopic concept tree, prerequisites,
// per-strand mark splits, etc. for every subject × grade × year. Falls back
// to an empty corpus if the file is missing so the legacy ATP path keeps
// working in environments that haven't run the extractor.
//
// Schema: see docs/atp-pacing-schema.md.
// ---------------------------------------------------------------------------

const PACING = existsSync(PACING_PATH)
  ? JSON.parse(readFileSync(PACING_PATH, 'utf8'))
  : { subjects: {} };

/** Returns true if rich pacing data is available for this slot. */
export function hasPacingData(subject, grade) {
  return Boolean(PACING.subjects?.[subject]?.[String(grade)]);
}

/**
 * Latest year for which a PacingDoc exists for (subject, grade). Per the
 * schema-doc decision: "use the latest available" — so 2026 wins over
 * 2023-24 wherever a 2026 ATP has been extracted.
 * Returns null when no pacing data is available.
 */
export function latestPacingYear(subject, grade) {
  const yearsObj = PACING.subjects?.[subject]?.[String(grade)];
  if (!yearsObj) return null;
  const years = Object.keys(yearsObj);
  if (years.length === 0) return null;
  // String sort works because year keys are either "2026" or "2023-24",
  // and "2026" > "2023-24" lexicographically. Stable for any future ATPs
  // that follow the same naming.
  return years.sort().pop();
}

/**
 * Returns the rich PacingDoc for (subject, grade, year). When `year` is
 * omitted, picks the latest available. Returns null when missing.
 */
export function getPacingDoc(subject, grade, year) {
  const y = year || latestPacingYear(subject, grade);
  if (!y) return null;
  return PACING.subjects?.[subject]?.[String(grade)]?.[y] || null;
}

/**
 * Returns every Unit (the atomic teaching block) covered by a request,
 * applying the same EXAM_SCOPE expansion as getATPTopics. Empty array
 * when no pacing data exists. Year defaults to latest available.
 */
export function getPacingUnits(subject, grade, term, isExamType, year) {
  const doc = getPacingDoc(subject, grade, year);
  if (!doc) return [];
  const scope = isExamType ? (EXAM_SCOPE[term] || [term]) : [term];
  return scope.flatMap((t) => doc.terms?.[String(t)]?.units || []);
}

/**
 * Inverse of getPacingUnits: returns every Unit for the same (subject,
 * grade) that is NOT in the request's term scope. Each unit is annotated
 * with `_term` so the prompt builder can group by term in the output.
 *
 * Used by the "## Out of scope for this paper" prompt block so the model
 * can see explicitly what NOT to test (Money in T3, Conditionals in
 * Grade 7, etc. — both flagged by the 2026-05 teacher review).
 *
 * Empty array when no pacing data exists, or when the request scope
 * already covers all four terms (e.g. Final Exam).
 */
export function getOutOfScopePacingUnits(subject, grade, term, isExamType, year) {
  const doc = getPacingDoc(subject, grade, year);
  if (!doc) return [];
  const inScope = new Set(isExamType ? (EXAM_SCOPE[term] || [term]) : [term]);
  const out = [];
  for (const t of [1, 2, 3, 4]) {
    if (inScope.has(t)) continue;
    const termUnits = doc.terms?.[String(t)]?.units || [];
    for (const u of termUnits) {
      out.push({ ...u, _term: t });
    }
  }
  return out;
}

/**
 * Returns every FormalAssessment for a request's term scope.
 * For a Term 1 worksheet, returns just T1's assessments; for a Term 2
 * exam, returns T1+T2 assessments per CAPS scope rules.
 */
export function getPacingFormalAssessments(subject, grade, term, isExamType, year) {
  const doc = getPacingDoc(subject, grade, year);
  if (!doc) return [];
  const scope = isExamType ? (EXAM_SCOPE[term] || [term]) : [term];
  return scope.flatMap((t) => doc.terms?.[String(t)]?.formalAssessment || []);
}

/**
 * Find a single pacing Unit by its stable id within a (subject, grade) slot.
 * Walks every term + year so the caller doesn't need to know which term the
 * unit belongs to — useful for the Lesson generator where the frontend posts
 * a unitId chosen from the merged Unit picker.
 *
 * Returns { unit, term, year } when found, or null.
 */
export function getPacingUnitById(subject, grade, unitId) {
  const yearsObj = PACING.subjects?.[subject]?.[String(grade)];
  if (!yearsObj) return null;
  for (const [year, doc] of Object.entries(yearsObj)) {
    for (const [term, termPlan] of Object.entries(doc.terms || {})) {
      const unit = (termPlan.units || []).find((u) => u.id === unitId);
      if (unit) return { unit, term: Number(term), year };
    }
  }
  return null;
}

/**
 * Return the slim Unit list for a single (subject, grade, term) — only the
 * fields the frontend Unit picker needs. Skips formal-assessment-slot rows
 * (they carry no pedagogical content, so they aren't teachable lessons).
 */
export function getPacingUnitsSlim(subject, grade, term) {
  const units = getPacingUnits(subject, grade, term, false);
  return units
    .filter((u) => !u.isAssessmentSlot)
    .map((u) => ({
      id:             u.id,
      topic:          u.topic,
      capsStrand:     u.capsStrand || null,
      subStrand:      u.subStrand || null,
      weeks:          u.weeks || [],
      hours:          u.hours || null,
      durationLabel:  u.durationLabel || null,
      isRevision:     !!u.isRevision,
    }));
}

// Exposed for diagnostics (e.g. an /api/atp-pacing endpoint or scripts).
export const ATP_PACING_RAW = PACING;
