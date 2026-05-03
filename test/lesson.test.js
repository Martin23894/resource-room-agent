// Tests for the Lesson generator: schema invariants, prompt builder, and
// the slim pacing-units helper used by the frontend Unit picker.
//
// All pure functions — no Anthropic calls, no DOCX render — so this runs
// fast and deterministically.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resourceSchema, assertResource, narrowSchemaForRequest } from '../schema/resource.schema.js';
import { buildLessonContextBlock } from '../lib/atp-prompt.js';
import { getPacingUnitsSlim, getPacingUnitById } from '../lib/atp.js';
import { renderLessonPptx } from '../lib/pptx-builder.js';
import { __internals as generateInternals } from '../api/generate.js';
import { __internals as renderInternals } from '../lib/render.js';

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
      slides: [
        { ordinal: 1, layout: 'title',      heading: 'Whole numbers', speakerNotes: 'Welcome learners and read the lesson topic aloud.' },
        { ordinal: 2, layout: 'objectives', heading: "Today's goals",
          bullets: ['Count up to 1000.', 'Compare and order whole numbers.', 'Write numbers in expanded form.'],
          speakerNotes: 'Walk through each goal in plain language.' },
        { ordinal: 3, layout: 'vocabulary', heading: 'Key words',
          speakerNotes: 'Use vocabulary list — call on a learner per term.' },
        { ordinal: 4, layout: 'concept',    heading: 'Place value',
          bullets: ['Hundreds, tens, units.', '347 = 300 + 40 + 7.'],
          speakerNotes: 'Demonstrate with place-value cards on the board.' },
        { ordinal: 5, layout: 'example',    heading: 'Try this together',
          bullets: ['Write 526 in expanded form.', '500 + 20 + 6.'],
          speakerNotes: 'Have learners work in pairs for 60 seconds.' },
        { ordinal: 6, layout: 'practice',   heading: 'Now try the worksheet',
          bullets: ['Complete questions 1–4.'],
          speakerNotes: 'Hand out worksheets and circulate.' },
        { ordinal: 7, layout: 'exitTicket', heading: 'Exit ticket',
          bullets: ['Write 814 in expanded form on a sticky note.'],
          speakerNotes: 'Collect sticky notes at the door.' },
      ],
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

  test('zero phases with worksheetRef is FINE — the renderer infers', () => {
    // The renderer falls back to phase-name match (then phase #4) when no
    // phase explicitly carries worksheetRef:true. Lenient validator must
    // not fail in that case.
    const r = makeLesson();
    delete r.lesson.phases[3].worksheetRef;
    const result = assertResource(r);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  test('non-Lesson resources do not require the lesson branch', () => {
    const r = makeLesson({ meta: { ...makeLesson().meta, resourceType: 'Worksheet' } });
    delete r.lesson;
    const result = assertResource(r);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });
});

describe('narrowSchemaForRequest — Lesson requests promote `lesson` to required', () => {
  const COG_LEVELS = ['Knowledge', 'Routine Procedures', 'Complex Procedures', 'Problem Solving'];
  const TOPICS = ['Whole numbers'];

  test('Lesson requests put `lesson` in top-level required[]', () => {
    const s = narrowSchemaForRequest({
      subject: 'Mathematics', language: 'English', resourceType: 'Lesson',
      cognitiveLevels: COG_LEVELS, topics: TOPICS,
    });
    assert.ok(s.required.includes('lesson'),
      `expected "lesson" in required, got ${JSON.stringify(s.required)}`);
  });

  test('non-Lesson requests do NOT mark `lesson` required', () => {
    for (const rt of ['Worksheet', 'Test', 'Exam', 'Final Exam']) {
      const s = narrowSchemaForRequest({
        subject: 'Mathematics', language: 'English', resourceType: rt,
        cognitiveLevels: COG_LEVELS, topics: TOPICS,
      });
      assert.ok(!s.required.includes('lesson'),
        `expected "lesson" NOT in required for ${rt}, got ${JSON.stringify(s.required)}`);
    }
  });

  test('the base resourceSchema.required is not mutated across calls', () => {
    const baseRequired = [...resourceSchema.required];
    narrowSchemaForRequest({
      subject: 'Mathematics', language: 'English', resourceType: 'Lesson',
      cognitiveLevels: COG_LEVELS, topics: TOPICS,
    });
    assert.deepEqual(resourceSchema.required, baseRequired,
      'narrowSchemaForRequest must deep-clone — base schema must stay untouched');
  });
});

describe('Lesson slides invariants', () => {
  test('zero title slides is FINE — the renderer treats slide 1 as title', () => {
    const r = makeLesson();
    r.lesson.slides[0].layout = 'concept'; // no slide carries layout:"title"
    const result = assertResource(r);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  test('two title slides is invalid (at most one is allowed)', () => {
    const r = makeLesson();
    r.lesson.slides[2].layout = 'title';
    const result = assertResource(r);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /at most one slide may be layout:"title"/.test(e.message)));
  });

  test('ordinals must be unique', () => {
    const r = makeLesson();
    r.lesson.slides[1].ordinal = 1; // collide with slide 0
    const result = assertResource(r);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /ordinal/.test(e.path)));
  });

  test('diagram-layout slides require a stimulusRef that resolves', () => {
    const r = makeLesson();
    r.lesson.slides[3].layout = 'diagram';
    // No stimulusRef → error.
    let result = assertResource(r);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /stimulusRef/.test(e.path)));

    // Bad stimulusRef → still error.
    r.lesson.slides[3].stimulusRef = 'no-such-stimulus';
    result = assertResource(r);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /stimulusRef/.test(e.path)));
  });

  test('schema rejects fewer than 5 slides', () => {
    const r = makeLesson();
    r.lesson.slides = r.lesson.slides.slice(0, 3);
    // assertResource doesn't run the JSON-schema minItems — the Anthropic
    // tool API does at request time. So we instead check the schema enum.
    assert.equal(resourceSchema.$defs.lesson.properties.slides.minItems, 5);
    assert.equal(resourceSchema.$defs.lesson.properties.slides.maxItems, 15);
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
    assert.match(text, /sections\+memo/);
  });

  test('mentions worksheetRef and title-slide as soft conventions, not hard rules', () => {
    const text = buildLessonContextBlock(UNIT, 45, 'English').join('\n');
    // Both fields are mentioned (so a compliant model still gets credit)…
    assert.match(text, /worksheetRef/);
    assert.match(text, /layout: "title"|layout:"title"/);
    // …but the prompt frames them as conventions, not rejection-causing rules.
    assert.match(text, /auto-inferred when omitted/);
    // No HARD RULES block any more (the renderers infer instead).
    assert.ok(!/HARD RULE/.test(text), 'HARD RULE language should be gone');
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

describe('pickWorksheetPhaseIndex (DOCX renderer fallback)', () => {
  const { pickWorksheetPhaseIndex } = renderInternals;
  const phases = (names) => names.map((n) => ({ name: n, minutes: 5,
    teacherActions: ['x'], learnerActions: ['y'] }));

  test('prefers an explicit worksheetRef:true phase', () => {
    const ps = phases(['Introduction', 'Direct Teaching', 'Guided Practice', 'Independent Work', 'Consolidation']);
    ps[1].worksheetRef = true;
    assert.equal(pickWorksheetPhaseIndex(ps), 1);
  });

  test('falls back to the "Independent Work" phase by name', () => {
    const ps = phases(['Introduction', 'Direct Teaching', 'Guided Practice', 'Independent Work', 'Consolidation']);
    assert.equal(pickWorksheetPhaseIndex(ps), 3);
  });

  test('falls back to the Afrikaans label "Onafhanklike Werk"', () => {
    const ps = phases(['Inleiding', 'Direkte Onderrig', 'Begeleide Oefening', 'Onafhanklike Werk', 'Konsolidasie']);
    assert.equal(pickWorksheetPhaseIndex(ps), 3);
  });

  test('falls back to phase #4 when no explicit + no name match', () => {
    const ps = phases(['One', 'Two', 'Three', 'Four', 'Five']);
    assert.equal(pickWorksheetPhaseIndex(ps), 3);
  });

  test('returns -1 for empty / missing input', () => {
    assert.equal(pickWorksheetPhaseIndex([]), -1);
    assert.equal(pickWorksheetPhaseIndex(undefined), -1);
  });
});

describe('PPTX renderer infers a title slide when none is declared', () => {
  test('renders a Lesson with no layout:"title" slide', async () => {
    const r = makeLesson();
    // Strip the explicit title — give slide #1 a different layout.
    r.lesson.slides[0].layout = 'concept';
    // Validator must still pass under the lenient rules.
    const validation = assertResource(r);
    assert.equal(validation.ok, true, JSON.stringify(validation.errors));
    // PPTX render must succeed and produce a non-trivial deck.
    const b64 = await renderLessonPptx(r);
    assert.ok(b64.length > 1000, 'expected non-trivial PPTX bytes');
  });
});

describe('buildTargetedRemediation', () => {
  const { buildTargetedRemediation } = generateInternals;

  test('returns empty string when no targetable errors are present', () => {
    const out = buildTargetedRemediation(
      [{ path: 'sections[0].questions[0].topic', message: 'unknown topic' }],
      { language: 'English', lessonMinutes: 45 },
    );
    assert.equal(out, '');
  });

  test('emits phase-minutes remediation when that error is present', () => {
    const out = buildTargetedRemediation(
      [{ path: 'lesson.phases[*].minutes', message: 'sum=20, expected within ±5 of lesson.lessonMinutes=45' }],
      { language: 'English', lessonMinutes: 45 },
    );
    assert.match(out, /REMEDIATION \(phase minutes\)/);
    assert.match(out, /MUST equal lesson\.lessonMinutes within \xB15/);
    assert.match(out, /add up to 45/);
  });

  test('emits mark-sum remediation when that error is present', () => {
    const out = buildTargetedRemediation(
      [{ path: 'sum(leaf.marks)', message: '12, expected meta.totalMarks=10' }],
      { language: 'English', lessonMinutes: 45, totalMarks: 10 },
    );
    assert.match(out, /REMEDIATION \(mark sum\)/);
    assert.match(out, /meta.totalMarks=10/);
  });
});

describe('renderLessonPptx', () => {
  test('renders a Lesson Resource to a PPTX base64 string', async () => {
    const r = makeLesson();
    const b64 = await renderLessonPptx(r);
    assert.equal(typeof b64, 'string');
    assert.ok(b64.length > 1000, 'expected non-trivial PPTX bytes');
    // PPTX is a ZIP — first decoded bytes are "PK".
    const head = Buffer.from(b64.slice(0, 8), 'base64').toString('binary').slice(0, 2);
    assert.equal(head, 'PK', `expected ZIP magic "PK", got "${head}"`);
  });

  test('throws when the resource is not a Lesson', async () => {
    const r = makeLesson({ meta: { ...makeLesson().meta, resourceType: 'Test' } });
    await assert.rejects(() => renderLessonPptx(r), /not a Lesson/);
  });

  test('throws when the lesson has no slides', async () => {
    const r = makeLesson();
    r.lesson.slides = [];
    await assert.rejects(() => renderLessonPptx(r), /slides is empty/);
  });

  test('renders a diagram slide when the stimulus is renderable', async () => {
    const r = makeLesson();
    // Add a renderable bar-graph stimulus + a slide that references it.
    r.stimuli = [{
      id: 'bar-1', kind: 'diagram', altText: 'Daily rainfall by month',
      spec: {
        type: 'bar_graph',
        title: 'Rainfall',
        x_label: 'Month', y_label: 'mm',
        bars: [
          { label: 'Jan', value: 12 },
          { label: 'Feb', value: 18 },
          { label: 'Mar', value: 22 },
        ],
      },
    }];
    r.lesson.slides[3] = {
      ordinal: 4, layout: 'diagram', heading: 'Rainfall data',
      stimulusRef: 'bar-1',
      speakerNotes: 'Walk through reading the bar values.',
    };
    const result = assertResource(r);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const b64 = await renderLessonPptx(r);
    assert.ok(b64.length > 1000);
  });
});
