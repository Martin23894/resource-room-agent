// Single source of truth for the CAPS Annual Teaching Plan topic database.
// Loaded once at startup from data/atp.json. Both the backend pipeline and
// the frontend (via /api/atp) read from here.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '..', 'data', 'atp.json');

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
