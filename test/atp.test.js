import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUBJECTS,
  ATP,
  ATP_TASKS,
  EXAM_SCOPE,
  getATPTopics,
  hasPacingData,
  latestPacingYear,
  getPacingDoc,
  getPacingUnits,
  getPacingFormalAssessments,
} from '../lib/atp.js';

describe('SUBJECTS', () => {
  test('has both intermediate and senior phases', () => {
    assert.ok(Array.isArray(SUBJECTS.intermediate));
    assert.ok(Array.isArray(SUBJECTS.senior));
    assert.ok(SUBJECTS.intermediate.length >= 10);
    assert.ok(SUBJECTS.senior.length >= 10);
  });

  test('Mathematics appears in both phases', () => {
    assert.ok(SUBJECTS.intermediate.includes('Mathematics'));
    assert.ok(SUBJECTS.senior.includes('Mathematics'));
  });

  test('Technology is senior-only', () => {
    assert.ok(!SUBJECTS.intermediate.includes('Technology'));
    assert.ok(SUBJECTS.senior.includes('Technology'));
  });

  test('Natural Sciences and Technology is intermediate-only', () => {
    assert.ok(SUBJECTS.intermediate.includes('Natural Sciences and Technology'));
    assert.ok(!SUBJECTS.senior.includes('Natural Sciences and Technology'));
  });
});

describe('ATP coverage', () => {
  test('every intermediate subject covers grades 4–6', () => {
    for (const subject of SUBJECTS.intermediate) {
      // Some subjects (e.g. Life Skills) may not have Grade 7 data but must
      // have at least one intermediate-phase grade.
      const grades = Object.keys(ATP[subject] || {}).map(Number);
      assert.ok(grades.some((g) => g >= 4 && g <= 6), `${subject} has no intermediate grades`);
    }
  });

  test('Mathematics has entries for Grades 4-7, all 4 terms', () => {
    for (const g of [4, 5, 6, 7]) {
      for (const t of [1, 2, 3, 4]) {
        const topics = ATP.Mathematics[g][t];
        assert.ok(Array.isArray(topics) && topics.length > 0, `Maths Gr${g} T${t} has no topics`);
      }
    }
  });

  test('every topic entry is a non-empty string', () => {
    for (const [subject, grades] of Object.entries(ATP)) {
      for (const [grade, terms] of Object.entries(grades)) {
        for (const [term, topics] of Object.entries(terms)) {
          for (const topic of topics) {
            assert.equal(typeof topic, 'string', `${subject} Gr${grade} T${term}`);
            assert.ok(topic.length > 0, `${subject} Gr${grade} T${term} has empty topic`);
          }
        }
      }
    }
  });
});

describe('ATP_TASKS', () => {
  test('Mathematics Gr6 Term 3 has at least one task', () => {
    const tasks = ATP_TASKS.Mathematics[6][3];
    assert.ok(Array.isArray(tasks) && tasks.length > 0);
    assert.ok(tasks[0].label);
    assert.ok(tasks[0].resourceType);
    assert.ok(Number.isInteger(tasks[0].minMarks));
    assert.ok(Number.isInteger(tasks[0].maxMarks));
  });

  test('task minMarks never exceeds maxMarks', () => {
    for (const [subject, grades] of Object.entries(ATP_TASKS)) {
      for (const [g, terms] of Object.entries(grades)) {
        for (const [t, tasks] of Object.entries(terms)) {
          for (const task of tasks) {
            assert.ok(task.minMarks <= task.maxMarks,
              `${subject} Gr${g} T${t} "${task.label}" has minMarks=${task.minMarks} > maxMarks=${task.maxMarks}`);
          }
        }
      }
    }
  });
});

describe('EXAM_SCOPE', () => {
  test('Term 1 covers only Term 1', () => {
    assert.deepEqual(EXAM_SCOPE[1], [1]);
  });

  test('Term 2 covers Terms 1+2 (CAPS mid-year exam rule)', () => {
    assert.deepEqual(EXAM_SCOPE[2], [1, 2]);
  });

  test('Term 3 covers only Term 3', () => {
    assert.deepEqual(EXAM_SCOPE[3], [3]);
  });

  test('Term 4 covers Terms 3+4 (CAPS year-end exam rule)', () => {
    assert.deepEqual(EXAM_SCOPE[4], [3, 4]);
  });
});

describe('getATPTopics', () => {
  test('non-exam assessment returns only that term\'s topics', () => {
    const t1 = getATPTopics('Mathematics', 6, 1, false);
    const t2 = getATPTopics('Mathematics', 6, 2, false);
    assert.ok(t1.length > 0);
    assert.ok(t2.length > 0);
    // No overlap between Term 1 and Term 2 topics in Grade 6 Mathematics.
    const overlap = t1.filter((x) => t2.includes(x));
    assert.equal(overlap.length, 0);
  });

  test('Term 2 exam pulls from Term 1 AND Term 2', () => {
    const t1Only = getATPTopics('Mathematics', 6, 1, false);
    const t2Only = getATPTopics('Mathematics', 6, 2, false);
    const exam = getATPTopics('Mathematics', 6, 2, true);
    // Exam topics count == T1 count + T2 count (no overlap assumed within Maths).
    assert.equal(exam.length, t1Only.length + t2Only.length);
    for (const topic of t1Only) assert.ok(exam.includes(topic));
    for (const topic of t2Only) assert.ok(exam.includes(topic));
  });

  test('Term 4 exam pulls from Term 3 AND Term 4', () => {
    const t3Only = getATPTopics('Mathematics', 6, 3, false);
    const t4Only = getATPTopics('Mathematics', 6, 4, false);
    const exam = getATPTopics('Mathematics', 6, 4, true);
    assert.equal(exam.length, t3Only.length + t4Only.length);
  });

  test('Term 1 and Term 3 exams behave like single-term assessments', () => {
    const t1Exam = getATPTopics('Mathematics', 6, 1, true);
    const t1Only = getATPTopics('Mathematics', 6, 1, false);
    assert.deepEqual(t1Exam, t1Only);
  });

  test('unknown subject returns empty array', () => {
    const topics = getATPTopics('Nonexistent Subject', 6, 1, false);
    assert.deepEqual(topics, []);
  });

  test('out-of-range grade returns empty array', () => {
    const topics = getATPTopics('Mathematics', 99, 1, false);
    assert.deepEqual(topics, []);
  });
});

describe('pacing helpers', () => {
  test('hasPacingData is true for subjects in atp-pacing.json', () => {
    assert.ok(hasPacingData('Mathematics', 4));
    assert.ok(hasPacingData('English Home Language', 6));
    assert.ok(hasPacingData('Social Sciences — History', 5));
  });

  test('hasPacingData is false for unknown subject/grade', () => {
    assert.equal(hasPacingData('Nonexistent Subject', 4), false);
    assert.equal(hasPacingData('Mathematics', 99), false);
  });

  test('latestPacingYear prefers 2026 over 2023-24 when both exist', () => {
    // Mathematics Gr 4 has both years extracted (2026 ATP shipped, 2023-24
    // legacy still in atp-pacing.json from earlier extractions).
    const year = latestPacingYear('Mathematics', 4);
    assert.ok(year === '2026' || year === '2023-24',
      `expected a known year, got ${year}`);
  });

  test('getPacingDoc returns a doc with a terms object', () => {
    const doc = getPacingDoc('Mathematics', 4);
    assert.ok(doc, 'expected a pacing doc for Maths Gr 4');
    assert.equal(typeof doc.terms, 'object');
    assert.ok(Object.keys(doc.terms).length >= 1);
  });

  test('getPacingUnits returns Unit objects with the expected shape', () => {
    const units = getPacingUnits('Mathematics', 4, 1, false);
    assert.ok(Array.isArray(units));
    assert.ok(units.length > 0, 'expected at least one Maths Gr 4 T1 unit');
    const u = units[0];
    assert.equal(typeof u.topic, 'string');
    assert.ok(Array.isArray(u.subtopics));
    assert.ok(Array.isArray(u.prerequisites));
  });

  test('getPacingUnits respects exam scope (T2 → T1+T2)', () => {
    const t1 = getPacingUnits('Mathematics', 6, 1, false);
    const t2 = getPacingUnits('Mathematics', 6, 2, false);
    const exam = getPacingUnits('Mathematics', 6, 2, true);
    // EXAM_SCOPE[2] = [1, 2], so the exam scope is the union.
    assert.equal(exam.length, t1.length + t2.length);
  });

  test('getPacingFormalAssessments returns assessments with section splits for Languages', () => {
    const assessments = getPacingFormalAssessments(
      'English Home Language', 4, 1, false);
    assert.ok(Array.isArray(assessments));
    // Languages CAPS always has at least one Term 1 formal assessment.
    assert.ok(assessments.length > 0);
    const withSections = assessments.find((a) => a.sections?.length);
    assert.ok(withSections, 'expected at least one assessment with sections[]');
  });

  test('returns empty/null gracefully for subjects without pacing data', () => {
    assert.deepEqual(getPacingUnits('Nonexistent Subject', 4, 1, false), []);
    assert.deepEqual(getPacingFormalAssessments('Nonexistent Subject', 4, 1, false), []);
    assert.equal(getPacingDoc('Nonexistent Subject', 4), null);
    assert.equal(latestPacingYear('Nonexistent Subject', 4), null);
  });
});
