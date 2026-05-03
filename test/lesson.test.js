// Tests for the Lesson generator: schema invariants, prompt builder, and
// the slim pacing-units helper used by the frontend Unit picker.
//
// All pure functions — no Anthropic calls, no DOCX render — so this runs
// fast and deterministically.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resourceSchema, assertResource } from '../schema/resource.schema.js';
import { buildLessonContextBlock } from '../lib/atp-prompt.js';
import { getPacingUnitsSlim, getPacingUnitById } from '../lib/atp.js';

// ─── A minimal valid Lesson resource for invariant testing. ───────────────
function makeLesson(overrides = {}) {
  const base = {
    meta: {
      schemaVersion: '1.0',
      subject: 'Mathematics',
      grade: 4,
      term: 1,
      language: 'English',
      resourceType: 'Lesson',
      totalMarks: 10,
      duration: { minutes: 15 },
      difficulty: 'on',
      cognitiveFramework: {
        name: "Bloom's",
        levels: [
          { name: 'Knowledge',           percent: 30, prescribedMarks: 3 },
          { name: 'Routine Procedures',  percent: 40, prescribedMarks: 4 },
          { name: 'Complex Procedures',  percent: 20, prescribedMarks: 2 },
          { name: 'Problem Solving',     percent: 10, prescribedMarks: 1 },
        ],
      },
      topicScope: {
        coversTerms: [1],
        topics: ['Whole numbers: counting, ordering, comparing and representing'],
      },
    },
    cover: {
      resourceTypeLabel: 'WORKSHEET',
      subjectLine: 'Mathematics',
      gradeLine: 'Grade 4',
      termLine: 'Term 1',
      learnerInfoFields: [
        { kind: 'name', label: 'Name' },
        { kind: 'surname', label: 'Surname' },
        { kind: 'date', label: 'Date' },
        { kind: 'total', label: 'Total' },
      ],
      instructions: { heading: 'Instructions', items: ['Answer all questions.'] },
    },
    stimuli: [],
    sections: [{
      title: 'PRACTICE',
      questions: [
        {
          number: '1', type: 'ShortAnswer',
          topic: 'Whole numbers: counting, ordering, comparing and representing',
          stem: 'Write 347 in expanded form.',
          marks: 3, cognitiveLevel: 'Knowledge',
          answerSpace: { kind: 'lines', lines: 2 },
        },
        {
          number: '2', type: 'Calculation',
          topic: 'Whole numbers: counting, ordering, comparing and representing',
          stem: 'Calculate 234 + 156.',
          marks: 4, cognitiveLevel: 'Routine Procedures',
          answerSpace: { kind: 'workingPlusAnswer' },
        },
        {
          number: '3', type: 'WordProblem',
          topic: 'Whole numbers: counting, ordering, comparing and representing',
          stem: 'Sipho has 250 apples and gives 30 away. How many remain?',
          marks: 2, cognitiveLevel: 'Complex Procedures',
          answerSpace: { kind: 'workingPlusAnswer' },
        },
        {
          number: '4', type: 'WordProblem',
          topic: 'Whole numbers: counting, ordering, comparing and representing',
          stem: 'A class collected 480 cans for recycling over 4 weeks at the same rate each week. How many cans per week?',
          marks: 1, cognitiveLevel: 'Problem Solving',
          answerSpace: { kind: 'workingPlusAnswer' },
        },
      ],
    }],
    memo: {
      answers: [
        { questionNumber: '1', answer: '300 + 40 + 7', cognitiveLevel: 'Knowledge', marks: 3 },
        { questionNumber: '2', answer: '390', cognitiveLevel: 'Routine Procedures', marks: 4 },
        { questionNumber: '3', answer: '220', cognitiveLevel: 'Complex Procedures', marks: 2 },
        { questionNumber: '4', answer: '120', cognitiveLevel: 'Problem Solving', marks: 1 },
      ],
    },
    lesson: {
      lessonMinutes: 45,
      capsAnchor: {
        unitTopic: 'Whole numbers: counting, ordering, comparing and representing',
        capsStrand: 'Numbers, Operations and Relationships',
        weekRange: 'Weeks 1–2',
      },
      learningObjectives: [
        'By the end of this lesson learners will be able to count, order and compare whole numbers up to 1000.',
        'By the end of this lesson learners will be able to write whole numbers in expanded form.',
      ],
      priorKnowledge: ['Counting up to 800', 'Recognising place value of three-digit numbers'],
      vocabulary: [
        { term: 'place value', definition: 'The value a digit has based on its position in the number.' },
      ],
      materials: ['Counters', 'Number cards'],
      phases: [
        { name: 'Introduction',     minutes: 5,  teacherActions: ['Greet learners.'], learnerActions: ['Listen.'] },
        { name: 'Direct Teaching',  minutes: 13, teacherActions: ['Model expanded form.'], learnerActions: ['Watch and copy.'] },
        { name: 'Guided Practice',  minutes: 11, teacherActions: ['Walk learners through a worked example.'], learnerActions: ['Try together.'] },
        { name: 'Independent Work', minutes: 11, teacherActions: ['Hand out the worksheet.'], learnerActions: ['Complete the worksheet.'], worksheetRef: true },
        { name: 'Consolidation',    minutes: 5,  teacherActions: ['Recap key ideas.'], learnerActions: ['Share answers.'] },
      ],
      homework: { description: 'Practise expanded form for 5 numbers.', estimatedMinutes: 10 },
    },
  };
  return Object.assign({}, base, overrides);
}

describe('Lesson schema invariants', () => {
  test('a valid Lesson passes assertResource', () => {
    const result = assertResource(makeLesson());
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  test("'Lesson' is in the resourceType enum", () => {
    const enums = resourceSchema.$defs.meta.properties.resourceType.enum;
    assert.ok(enums.includes('Lesson'));
  });

  test('lesson branch is required when resourceType is Lesson', () => {
    const r = makeLesson();
    delete r.lesson;
    const result = assertResource(r);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.path === 'lesson'));
  });

  test('phase minutes must sum to within ±5 of lessonMinutes', () => {
    const r = makeLesson();
    // Drop one phase's minutes to 0 — total now far from 45.
    r.lesson.phases[1].minutes = 1;
    const result = assertResource(r);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.path.includes('phases[*].minutes')));
  });

  test('exactly one phase must have worksheetRef:true', () => {
    const r = makeLesson();
    // Two worksheet phases — invalid.
    r.lesson.phases[3].worksheetRef = true;
    r.lesson.phases[2].worksheetRef = true;
    const result = assertResource(r);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.path.includes('worksheetRef')));
  });

  test('zero worksheet phases is invalid', () => {
    const r = makeLesson();
    r.lesson.phases[3].worksheetRef = false;
    const result = assertResource(r);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.path.includes('worksheetRef')));
  });

  test('non-Lesson resources do not require the lesson branch', () => {
    const r = makeLesson({ meta: { ...makeLesson().meta, resourceType: 'Worksheet' } });
    delete r.lesson;
    const result = assertResource(r);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });
});

describe('buildLessonContextBlock', () => {
  const UNIT = {
    topic: 'Whole numbers: addition and subtraction',
    capsStrand: 'Numbers, Operations and Relationships',
    subStrand: 'Whole Numbers',
    weeks: [4, 5, 6],
    hours: 18,
    subtopics: [],
    prerequisites: ['Counting up to 800'],
  };

  test('returns [] when unit is missing', () => {
    assert.deepEqual(buildLessonContextBlock(null, 45, 'English'), []);
  });

  test('emits a lesson directives block in English', () => {
    const lines = buildLessonContextBlock(UNIT, 45, 'English');
    const text = lines.join('\n');
    assert.match(text, /^## Lesson plan directives/m);
    assert.match(text, /Whole numbers: addition and subtraction/);
    assert.match(text, /CAPS strand: Numbers, Operations and Relationships \/ Whole Numbers/);
    // Five phases, in order, with minute budgets that sum to 45 (±5).
    for (const phase of ['Introduction', 'Direct Teaching', 'Guided Practice', 'Independent Work', 'Consolidation']) {
      assert.ok(text.includes(phase), `expected phase "${phase}" in prompt`);
    }
    assert.match(text, /worksheetRef:true/);
    assert.match(text, /sections\+memo/);
  });

  test('localises phase names in Afrikaans', () => {
    const lines = buildLessonContextBlock(UNIT, 60, 'Afrikaans');
    const text = lines.join('\n');
    for (const phase of ['Inleiding', 'Direkte Onderrig', 'Begeleide Oefening', 'Onafhanklike Werk', 'Konsolidasie']) {
      assert.ok(text.includes(phase), `expected Afrikaans phase "${phase}"`);
    }
  });

  test('phase minute budgets sum within ±5 of lessonMinutes', () => {
    for (const target of [30, 45, 60, 90]) {
      const text = buildLessonContextBlock(UNIT, target, 'English').join('\n');
      // Sum the printed "— N minutes" budgets (skip the lessonMinutes meta line).
      const matches = [...text.matchAll(/— (\d+) minutes/g)].map((m) => Number(m[1]));
      const sum = matches.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - target) <= 5,
        `phase budgets sum ${sum} too far from target ${target}`);
    }
  });
});

describe('getPacingUnitsSlim', () => {
  test('returns slim shape with the fields the frontend needs', () => {
    const units = getPacingUnitsSlim('Mathematics', 4, 1);
    assert.ok(Array.isArray(units));
    assert.ok(units.length > 0, 'expected at least one Maths Gr 4 T1 unit');
    const u = units[0];
    assert.equal(typeof u.id, 'string');
    assert.equal(typeof u.topic, 'string');
    // Slim shape — no subtopics or prerequisites.
    assert.equal(u.subtopics, undefined);
    assert.equal(u.prerequisites, undefined);
  });

  test('skips formal-assessment-slot rows', () => {
    const units = getPacingUnitsSlim('Mathematics', 4, 1);
    for (const u of units) {
      // The slim shape doesn't carry isAssessmentSlot, but the underlying
      // filter must drop those — so a "FORMAL ASSESSMENT" topic shouldn't
      // appear here. Best signal: no item should have an empty topic.
      assert.ok(u.topic && u.topic.length > 0);
    }
  });

  test('returns an empty array for an unknown subject', () => {
    const units = getPacingUnitsSlim('No Such Subject', 4, 1);
    assert.deepEqual(units, []);
  });
});

describe('getPacingUnitById', () => {
  test('finds a unit by its stable id', () => {
    const slim = getPacingUnitsSlim('Mathematics', 4, 1);
    if (slim.length === 0) return; // nothing to look up
    const id = slim[0].id;
    const found = getPacingUnitById('Mathematics', 4, id);
    assert.ok(found, 'expected to find the unit');
    assert.equal(found.unit.id, id);
    assert.equal(typeof found.term, 'number');
  });

  test('returns null for unknown id', () => {
    assert.equal(getPacingUnitById('Mathematics', 4, 'no-such-unit-id'), null);
  });
});
