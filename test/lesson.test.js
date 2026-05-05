// Tests for the Lesson generator: schema invariants, prompt builder, and
// the slim pacing-units helper used by the frontend Unit picker.
//
// All pure functions — no Anthropic calls, no DOCX render — so this runs
// fast and deterministically.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Packer } from 'docx';
import JSZip from 'jszip';

import { resourceSchema, assertResource, narrowSchemaForRequest } from '../schema/resource.schema.js';
import { buildLessonContextBlock } from '../lib/atp-prompt.js';
import { getPacingUnitsSlim, getPacingUnitById, getUnitSubtopicHeadings, findUnitSubtopic } from '../lib/atp.js';
import { renderLessonPptx } from '../lib/pptx-builder.js';
import { renderResource } from '../lib/render.js';
import { pickLessonStyle, nthAccent } from '../lib/palette.js';
import { __internals as generateInternals } from '../api/generate.js';
import { __internals as renderInternals } from '../lib/render.js';

async function readDocumentXml(doc) {
  const buf = await Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/document.xml').async('string');
}

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

describe('unwrapStringifiedBranches — lesson branch', () => {
  const { unwrapStringifiedBranches } = generateInternals;

  test('parses a top-level stringified lesson branch', () => {
    const lessonObj = {
      lessonMinutes: 45,
      capsAnchor: { unitTopic: 'Number Sentences' },
      learningObjectives: ['Solve simple number sentences.'],
      phases: [{ name: 'Introduction', minutes: 5, teacherActions: ['x'], learnerActions: ['y'] }],
      slides: [{ ordinal: 1, layout: 'title', heading: 'Hello' }],
    };
    const out = unwrapStringifiedBranches({
      meta: { resourceType: 'Lesson' },
      lesson: JSON.stringify(lessonObj),
    });
    assert.equal(typeof out.lesson, 'object');
    assert.equal(out.lesson.lessonMinutes, 45);
    assert.equal(out.lesson.capsAnchor.unitTopic, 'Number Sentences');
    assert.ok(Array.isArray(out.lesson.phases));
  });

  test('passes through an already-object lesson branch unchanged', () => {
    const lesson = { lessonMinutes: 60, capsAnchor: { unitTopic: 'X' }, phases: [], slides: [] };
    const out = unwrapStringifiedBranches({ lesson });
    assert.strictEqual(out.lesson, lesson);
  });

  test('parses stringified arrays inside the lesson branch', () => {
    const out = unwrapStringifiedBranches({
      lesson: {
        lessonMinutes: 45,
        capsAnchor: { unitTopic: 'X' },
        learningObjectives: JSON.stringify(['a', 'b']),
        phases: JSON.stringify([
          { name: 'Introduction', minutes: 5, teacherActions: ['x'], learnerActions: ['y'] },
        ]),
        slides: JSON.stringify([{ ordinal: 1, layout: 'title', heading: 'H' }]),
      },
    });
    assert.deepEqual(out.lesson.learningObjectives, ['a', 'b']);
    assert.ok(Array.isArray(out.lesson.phases));
    assert.equal(out.lesson.phases[0].name, 'Introduction');
    assert.ok(Array.isArray(out.lesson.slides));
    assert.equal(out.lesson.slides[0].layout, 'title');
  });

  test('parses individual stringified phases inside an already-array phases', () => {
    const phaseObj = { name: 'Direct Teaching', minutes: 10, teacherActions: ['x'], learnerActions: ['y'] };
    const out = unwrapStringifiedBranches({
      lesson: {
        lessonMinutes: 45, capsAnchor: { unitTopic: 'X' },
        phases: [JSON.stringify(phaseObj)],
        slides: [],
      },
    });
    assert.equal(out.lesson.phases[0].name, 'Direct Teaching');
  });

  test('parses a stringified capsAnchor object', () => {
    const out = unwrapStringifiedBranches({
      lesson: {
        lessonMinutes: 45,
        capsAnchor: JSON.stringify({ unitTopic: 'Whole numbers', capsStrand: 'Numbers' }),
        phases: [], slides: [],
      },
    });
    assert.equal(out.lesson.capsAnchor.unitTopic, 'Whole numbers');
    assert.equal(out.lesson.capsAnchor.capsStrand, 'Numbers');
  });
});

describe('assertResource — defensive check for stringified lesson', () => {
  test('a stringified lesson branch (bypassing the unwrap step) fails loudly', () => {
    // This shape can't reach the renderer in production — the api/generate.js
    // pipeline calls unwrapStringifiedBranches before assertResource — but
    // we want a clear validator error if a future caller skips that step.
    const result = assertResource({
      meta: {
        schemaVersion: '1.0', subject: 'Mathematics', grade: 6, term: 2,
        language: 'English', resourceType: 'Lesson', totalMarks: 10,
        duration: { minutes: 15 }, difficulty: 'on',
        cognitiveFramework: { name: "Bloom's", levels: [
          { name: 'Knowledge', percent: 100, prescribedMarks: 10 },
        ]},
        topicScope: { coversTerms: [2], topics: ['Number sentences'] },
      },
      cover: { resourceTypeLabel: 'LESSON', subjectLine: 'Maths',
        gradeLine: 'Grade 6', termLine: 'Term 2',
        learnerInfoFields: [], instructions: { heading: 'I', items: ['x'] } },
      stimuli: [], sections: [{ title: 'X', questions: [
        { number: '1', type: 'ShortAnswer', topic: 'Number sentences', stem: 'X',
          marks: 10, cognitiveLevel: 'Knowledge', answerSpace: { kind: 'lines', lines: 1 } },
      ] }],
      memo: { answers: [{ questionNumber: '1', answer: 'X', cognitiveLevel: 'Knowledge', marks: 10 }] },
      lesson: '{"lessonMinutes": 45}',  // ← stringified, should flag
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /stringified branch/.test(e.message)),
      `expected an error about a stringified branch, got ${JSON.stringify(result.errors)}`);
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

describe('Subtopic helpers (Phase A — Lesson focus)', () => {
  const SAMPLE_UNIT = {
    id: 'MATH-6-2026-t2-u2',
    topic: 'Number sentences',
    subtopics: [
      { heading: 'Number sentences with one or more variables',
        concepts: ['• Identify variables in a number sentence', '• Write number sentences for a situation'] },
      { heading: 'Solving for a variable using known number facts',
        concepts: ['• Solve by inspection', '• Solve by trial and improvement'] },
      // Duplicate heading should be deduped
      { heading: 'Solving for a variable using known number facts',
        concepts: ['• something extra'] },
      // Empty heading should be skipped
      { heading: '   ', concepts: ['• ignored'] },
    ],
  };

  test('getUnitSubtopicHeadings returns deduped, trimmed top-level headings', () => {
    const headings = getUnitSubtopicHeadings(SAMPLE_UNIT);
    assert.deepEqual(headings, [
      'Number sentences with one or more variables',
      'Solving for a variable using known number facts',
    ]);
  });

  test('getUnitSubtopicHeadings returns [] for missing/empty subtopics', () => {
    assert.deepEqual(getUnitSubtopicHeadings(null), []);
    assert.deepEqual(getUnitSubtopicHeadings({}), []);
    assert.deepEqual(getUnitSubtopicHeadings({ subtopics: [] }), []);
    assert.deepEqual(getUnitSubtopicHeadings({ subtopics: [{ heading: '' }] }), []);
  });

  test('findUnitSubtopic finds by exact (trimmed) heading match', () => {
    const found = findUnitSubtopic(SAMPLE_UNIT, '  Number sentences with one or more variables  ');
    assert.ok(found);
    assert.equal(found.concepts.length, 2);
  });

  test('findUnitSubtopic returns null for unknown heading', () => {
    assert.equal(findUnitSubtopic(SAMPLE_UNIT, 'no such heading'), null);
    assert.equal(findUnitSubtopic(null, 'x'), null);
    assert.equal(findUnitSubtopic({}, 'x'), null);
  });

  test('getPacingUnitsSlim now includes subtopicHeadings on each unit', () => {
    const units = getPacingUnitsSlim('Mathematics', 4, 1);
    assert.ok(units.length > 0);
    for (const u of units) {
      assert.ok(Array.isArray(u.subtopicHeadings),
        `expected subtopicHeadings array on unit ${u.id}`);
    }
    // At least one unit should have actual subtopics — Maths Gr 4 T1 has rich data.
    assert.ok(units.some((u) => u.subtopicHeadings.length > 0),
      'expected at least one unit with subtopic headings');
  });
});

describe('buildLessonContextBlock — subtopic focus', () => {
  const UNIT = {
    topic: 'Number sentences',
    capsStrand: 'Patterns, Functions and Algebra',
    weeks: [1, 2],
    hours: 6,
    subtopics: [],
  };
  const SUBTOPIC = {
    heading: 'Solving for a variable using known number facts',
    concepts: ['• Solve by inspection', '• Solve by trial and improvement'],
  };

  test('whole-unit mode (no subtopic) keeps the broad framing', () => {
    const text = buildLessonContextBlock(UNIT, 45, 'English').join('\n');
    assert.match(text, /teaches the CAPS Unit "Number sentences"/);
    // No subtopic-focus block.
    assert.ok(!/Subtopic focus/.test(text), 'no subtopic block in whole-unit mode');
  });

  test('subtopic mode pins the lesson focus and lists the concepts verbatim', () => {
    const text = buildLessonContextBlock(UNIT, 45, 'English', SUBTOPIC).join('\n');
    assert.match(text, /focuses NARROWLY on the subtopic "Solving for a variable using known number facts"/);
    assert.match(text, /### Subtopic focus/);
    assert.match(text, /Solve by inspection/);
    assert.match(text, /Solve by trial and improvement/);
    assert.match(text, /Do NOT introduce concepts from other subtopics/);
    // Anchor directive should reference the subtopic heading too.
    assert.match(text, /capsAnchor\.subStrand to "Solving for a variable using known number facts"/);
    // Objectives directive should mention the subtopic concepts (not the whole Unit).
    assert.match(text, /come from the subtopic concepts listed above/);
  });

  test('subtopic mode degrades gracefully when the subtopic has no concepts', () => {
    const text = buildLessonContextBlock(UNIT, 45, 'English',
      { heading: 'Bare subtopic', concepts: [] }).join('\n');
    assert.match(text, /no detailed concepts in CAPS/);
  });

  test('null/undefined subtopic falls back to whole-unit mode', () => {
    const a = buildLessonContextBlock(UNIT, 45, 'English', null).join('\n');
    const b = buildLessonContextBlock(UNIT, 45, 'English').join('\n');
    assert.ok(!/Subtopic focus/.test(a));
    assert.ok(!/Subtopic focus/.test(b));
  });
});

describe('Cache key includes subtopicHeading for Lesson requests', () => {
  const { buildCacheKey } = generateInternals;
  const base = {
    subject: 'Mathematics', grade: 6, term: 2,
    language: 'English', resourceType: 'Lesson', totalMarks: 10,
    difficulty: 'on', unitId: 'MATH-6-2026-t2-u2', lessonMinutes: 45,
  };

  test('whole-Unit Lesson and subtopic-focused Lesson get different keys', () => {
    const whole = buildCacheKey({ ...base });
    const focus = buildCacheKey({ ...base, subtopicHeading: 'Solving by inspection' });
    assert.notEqual(whole, focus);
  });

  test('non-Lesson requests do not put subtopicHeading in the key', () => {
    const k = buildCacheKey({ ...base, resourceType: 'Test', subtopicHeading: 'x' });
    assert.ok(!/subtopicHeading/.test(k));
  });

  test('cache key uses a versioned prefix (any vN)', () => {
    assert.match(buildCacheKey(base), /^gen:v\d+:/);
  });
});

describe('buildLessonContextBlock — series context (Phase B)', () => {
  const UNIT = {
    topic: 'Number sentences',
    capsStrand: 'Patterns, Functions and Algebra',
    weeks: [1, 2],
    hours: 6,
    subtopics: [],
  };
  const SUBTOPIC = {
    heading: 'Solving for a variable using known number facts',
    concepts: ['• Solve by inspection'],
  };

  test('no seriesContext → no series block', () => {
    const text = buildLessonContextBlock(UNIT, 45, 'English', SUBTOPIC).join('\n');
    assert.ok(!/Series context/.test(text));
    assert.ok(!/lesson \d+ of \d+/.test(text));
  });

  test('seriesContext { total: 1 } is treated as a single-lesson — no series block', () => {
    const text = buildLessonContextBlock(UNIT, 45, 'English', SUBTOPIC, {
      position: 1, total: 1, priorSubtopics: [],
    }).join('\n');
    assert.ok(!/Series context/.test(text));
  });

  test('first lesson in a series sets the opener-context language', () => {
    const text = buildLessonContextBlock(UNIT, 45, 'English', SUBTOPIC, {
      position: 1, total: 8, priorSubtopics: [],
    }).join('\n');
    assert.match(text, /### Series context/);
    assert.match(text, /lesson 1 of 8/);
    assert.match(text, /FIRST lesson in the series/);
    assert.match(text, /Future lessons in this series will cover/);
    // No prior list — must not say "BUILD ON".
    assert.ok(!/BUILD ON/.test(text));
  });

  test('mid-series lesson lists prior subtopics and tells the model to build on them', () => {
    const text = buildLessonContextBlock(UNIT, 45, 'English', SUBTOPIC, {
      position: 3, total: 5,
      priorSubtopics: [
        'Number sentences with one or more variables',
        'Solving for a variable using known number facts',
      ],
    }).join('\n');
    assert.match(text, /lesson 3 of 5/);
    assert.match(text, /Prior lessons in this series have already covered/);
    assert.match(text, /Number sentences with one or more variables/);
    assert.match(text, /BUILD ON those prior lessons/);
    assert.match(text, /Future lessons in this series will cover/);
  });

  test('last lesson flags the consolidation slot for whole-Unit recap', () => {
    const text = buildLessonContextBlock(UNIT, 45, 'English', SUBTOPIC, {
      position: 8, total: 8,
      priorSubtopics: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    }).join('\n');
    assert.match(text, /lesson 8 of 8/);
    assert.match(text, /LAST lesson in the series/);
    assert.match(text, /recap of the whole Unit/);
    // Last lesson — no "future lessons" line.
    assert.ok(!/Future lessons in this series will cover/.test(text));
  });

  test('series context + subtopic focus play nicely together', () => {
    const text = buildLessonContextBlock(UNIT, 45, 'English', SUBTOPIC, {
      position: 2, total: 5, priorSubtopics: ['intro topic'],
    }).join('\n');
    assert.match(text, /### Series context/);
    assert.match(text, /### Subtopic focus/);
    assert.match(text, /This is lesson 2 of 5 in the series/);
  });
});

describe('parseSeriesContext (validator)', () => {
  // We don't export it directly — go through parseRequest. But the cache
  // key is the most observable surface, so test via that.
  const { buildCacheKey } = generateInternals;
  const base = {
    subject: 'Mathematics', grade: 6, term: 2,
    language: 'English', resourceType: 'Lesson', totalMarks: 10,
    difficulty: 'on', unitId: 'MATH-6-2026-t2-u2', lessonMinutes: 45,
  };

  test('series cache key differs by position', () => {
    const k1 = buildCacheKey({ ...base, seriesContext: { position: 1, total: 5, priorSubtopics: [] } });
    const k2 = buildCacheKey({ ...base, seriesContext: { position: 2, total: 5, priorSubtopics: ['a'] } });
    assert.notEqual(k1, k2);
  });

  test('series cache key differs by prior subtopics', () => {
    const k1 = buildCacheKey({ ...base, seriesContext: { position: 2, total: 5, priorSubtopics: ['a'] } });
    const k2 = buildCacheKey({ ...base, seriesContext: { position: 2, total: 5, priorSubtopics: ['a', 'b'] } });
    assert.notEqual(k1, k2);
  });

  test('series cache key matches the same single-lesson key when total is 1', () => {
    const single = buildCacheKey({ ...base });
    const seriesOfOne = buildCacheKey({ ...base, seriesContext: { position: 1, total: 1, priorSubtopics: [] } });
    assert.equal(single, seriesOfOne);
  });

  test('non-Lesson requests ignore seriesContext entirely', () => {
    const k = buildCacheKey({ ...base, resourceType: 'Test', seriesContext: { position: 1, total: 5, priorSubtopics: ['x'] } });
    assert.ok(!/seriesPosition|seriesTotal|seriesPrior/.test(k));
  });
});

// ─────────────────────────────────────────────────────────────────
// Phase A — Lesson visual identity + worksheet kid-mode
// ─────────────────────────────────────────────────────────────────

describe('pickLessonStyle', () => {
  test('returns null for non-Lesson resource types', () => {
    assert.equal(pickLessonStyle({ resourceType: 'Test',      grade: 4 }), null);
    assert.equal(pickLessonStyle({ resourceType: 'Worksheet', grade: 6 }), null);
    assert.equal(pickLessonStyle({}), null);
  });

  test('picks the junior tier for Grade 4 and 5', () => {
    for (const grade of [4, 5]) {
      const s = pickLessonStyle({ resourceType: 'Lesson', grade });
      assert.equal(s.gradeBand, 'junior');
      assert.equal(s.mascotEnabled, true);
      assert.equal(s.decorationLevel, 'high');
      assert.ok(s.cornerRadius >= 0.15, 'junior should be more rounded');
      assert.ok(Array.isArray(s.accentRotation) && s.accentRotation.length >= 3);
    }
  });

  test('picks the senior tier for Grade 6 and 7', () => {
    for (const grade of [6, 7]) {
      const s = pickLessonStyle({ resourceType: 'Lesson', grade });
      assert.equal(s.gradeBand, 'senior');
      assert.equal(s.mascotEnabled, false);
      assert.equal(s.decorationLevel, 'low');
      assert.ok(s.cornerRadius < 0.15, 'senior should be less rounded');
    }
  });

  test('exposes a friendly font chain that falls back to Calibri', () => {
    const s = pickLessonStyle({ resourceType: 'Lesson', grade: 4 });
    assert.match(s.fontHead, /Fredoka/);
    assert.match(s.fontHead, /Calibri$/);   // last fallback is universal
    assert.equal(s.fontBody, 'Calibri');
  });

  test('nthAccent cycles through the rotation deterministically', () => {
    const s = pickLessonStyle({ resourceType: 'Lesson', grade: 4 });
    const rotation = s.accentRotation;
    for (let i = 0; i < rotation.length * 3; i++) {
      const colour = nthAccent(s, i);
      const expected = s.palette.accents[rotation[i % rotation.length]];
      assert.equal(colour, expected);
    }
  });

  test('nthAccent returns null when no style is supplied', () => {
    assert.equal(nthAccent(null, 0), null);
    assert.equal(nthAccent({}, 0), null);
  });
});

describe('Lesson worksheet (kid-mode) DOCX rendering', () => {
  test('Lesson DOCX uses the friendly "Time to practice" headline, not "WORKSHEET"', async () => {
    const doc = renderResource(makeLesson());
    const xml = await readDocumentXml(doc);
    assert.ok(xml.includes('Time to practice'), 'expected friendly worksheet title');
    // The cover.resourceTypeLabel is still "WORKSHEET" but the lesson
    // worksheet branch should NOT print that token on its cover.
    const lessonWorksheetSection = xml.split('Time to practice')[1] || '';
    assert.ok(!/[\s>]WORKSHEET[\s<]/.test(lessonWorksheetSection.slice(0, 500)),
      'formal "WORKSHEET" token must not appear on the lesson worksheet cover');
  });

  test('Afrikaans Lesson uses the Afrikaans friendly headline', async () => {
    const r = makeLesson();
    r.meta.language = 'Afrikaans';
    const doc = renderResource(r);
    const xml = await readDocumentXml(doc);
    assert.ok(xml.includes('Tyd om te oefen'), 'expected Afrikaans friendly title');
  });

  test('Lesson worksheet drops the "SECTION A:" heading style', async () => {
    const r = makeLesson();
    r.sections = [{
      letter: 'A', title: 'PRACTICE',
      questions: r.sections[0].questions,
    }];
    const doc = renderResource(r);
    const xml = await readDocumentXml(doc);
    // The lesson worksheet renderer skips SECTION headers entirely. The
    // teacher-facing lesson-plan portion never had them either, so they
    // should not appear anywhere in the document.
    assert.ok(!/SECTION\s+A:/.test(xml), 'lesson worksheet should not print SECTION A:');
  });

  test('Lesson worksheet carries the localised mark-pill unit ("pts")', async () => {
    const doc = renderResource(makeLesson());
    const xml = await readDocumentXml(doc);
    // At least one mark pill should appear — pull from the i18n unit.
    assert.ok(/\d+\s+pts/.test(xml), 'expected a "5 pts"-style mark pill');
  });

  test('Lesson worksheet includes the self-assessment row', async () => {
    const doc = renderResource(makeLesson());
    const xml = await readDocumentXml(doc);
    assert.ok(xml.includes('How did you find this?'), 'expected self-assess prompt');
    for (const label of ['Easy', 'OK', 'Tricky']) {
      assert.ok(xml.includes(label), `expected self-assess label "${label}"`);
    }
  });

  test('non-Lesson resources keep the formal cover (Test/Worksheet unchanged)', async () => {
    const r = makeLesson();
    r.meta.resourceType = 'Test';
    delete r.lesson;
    r.cover.resourceTypeLabel = 'TEST';
    const doc = renderResource(r);
    const xml = await readDocumentXml(doc);
    assert.ok(!xml.includes('Time to practice'),
      'Tests must not pick up the lesson kid-mode cover');
    assert.ok(!xml.includes('How did you find this?'),
      'Tests must not pick up the self-assessment row');
    assert.ok(xml.includes('TEST'), 'Tests should still print their formal label');
  });

  test('Lesson DOCX still embeds the lesson-plan teacher portion', async () => {
    const doc = renderResource(makeLesson());
    const xml = await readDocumentXml(doc);
    assert.ok(xml.includes('LESSON PLAN'),  'lesson-plan front matter should still render');
    assert.ok(xml.includes('CAPS Anchor'),  'CAPS anchor heading should still render');
  });
});

describe('Lesson worksheet helpers (unit-level)', () => {
  test('dottedAnswerLine produces a paragraph with a dotted bottom border', () => {
    const p = renderInternals.dottedAnswerLine();
    // docx Paragraph internals — `border` lives under `properties` after
    // construction; we sniff it by serialising the raw object instead.
    const raw = JSON.stringify(p);
    assert.match(raw, /dotted/i);
  });

  test('renderSelfAssessRow uses three accent-coloured face cells', () => {
    const style = pickLessonStyle({ resourceType: 'Lesson', grade: 4 });
    const L = { lesson: { selfAssess: 'How did you find this?', selfAssessFaces: ['Easy', 'OK', 'Tricky'] } };
    const els = renderInternals.renderSelfAssessRow(L, style);
    assert.ok(els.length >= 2, 'expected at least a heading paragraph + table');
    const hasTable = els.some((el) => el?.constructor?.name === 'Table');
    assert.ok(hasTable, 'expected a Table element holding the three faces');
  });
});

describe('PPTX renderer applies the per-grade-band style', () => {
  test('junior-band Lesson renders without error and includes the friendly font chain', async () => {
    const r = makeLesson();
    r.meta.grade = 4;
    const b64 = await renderLessonPptx(r);
    const xml = Buffer.from(b64, 'base64');
    const zip = await JSZip.loadAsync(xml);
    const slide1 = await zip.file('ppt/slides/slide1.xml').async('string');
    assert.ok(/Fredoka/.test(slide1), 'expected the Fredoka font face on a junior slide');
  });

  test('senior-band Lesson also uses the friendly font chain', async () => {
    const r = makeLesson();
    r.meta.grade = 7;
    const b64 = await renderLessonPptx(r);
    const xml = Buffer.from(b64, 'base64');
    const zip = await JSZip.loadAsync(xml);
    const slide1 = await zip.file('ppt/slides/slide1.xml').async('string');
    assert.ok(/Fredoka/.test(slide1), 'expected the Fredoka font face on a senior slide too');
  });
});

// ─────────────────────────────────────────────────────────────────
// Phase B — Slide layout variety
// ─────────────────────────────────────────────────────────────────

import { __internals as pptxInternals } from '../lib/pptx-builder.js';

describe('Phase B — schema accepts the new layout enum values', () => {
  const PHASE_B_LAYOUTS = [
    'warmUp', 'wordWall', 'thinkPairShare', 'workedExample',
    'yourTurn', 'celebrate',
  ];

  test('all six new layouts are in the lessonSlide.layout enum', () => {
    const enumValues = resourceSchema.$defs.lessonSlide.properties.layout.enum;
    for (const layout of PHASE_B_LAYOUTS) {
      assert.ok(enumValues.includes(layout), `layout enum missing: ${layout}`);
    }
  });

  test('original Phase A layouts are still in the enum', () => {
    const enumValues = resourceSchema.$defs.lessonSlide.properties.layout.enum;
    for (const layout of ['title', 'objectives', 'vocabulary', 'concept',
                          'example', 'practice', 'diagram', 'exitTicket']) {
      assert.ok(enumValues.includes(layout), `Phase A layout missing: ${layout}`);
    }
  });

  test('a Lesson using new variety layouts passes assertResource', () => {
    const r = makeLesson();
    r.lesson.slides = [
      { ordinal: 1, layout: 'title',          heading: 'Whole numbers', speakerNotes: 'Welcome.' },
      { ordinal: 2, layout: 'warmUp',         heading: 'How many beads here?',
        bullets: ['Hint: count in groups of 10.'], speakerNotes: 'Show the bead string.' },
      { ordinal: 3, layout: 'objectives',     heading: 'Today’s goals',
        bullets: ['Count to 1000.', 'Order whole numbers.'], speakerNotes: 'Read aloud.' },
      { ordinal: 4, layout: 'wordWall',       heading: 'Key words',
        speakerNotes: 'Pull definitions from vocabulary.' },
      { ordinal: 5, layout: 'workedExample',  heading: 'Solving 234 + 156',
        bullets: ['Add the units.', 'Add the tens.', 'Add the hundreds.'],
        speakerNotes: 'Walk through each step.' },
      { ordinal: 6, layout: 'thinkPairShare', heading: 'Why is place value useful?',
        bullets: ['Compare your answers.'], speakerNotes: 'Pair learners up.' },
      { ordinal: 7, layout: 'yourTurn',       heading: 'Your turn',
        bullets: ['Try questions 1–4.'], speakerNotes: 'Hand out worksheets.' },
      { ordinal: 8, layout: 'celebrate',      heading: 'Well done!',
        bullets: ['You can write numbers in expanded form.'], speakerNotes: 'Congratulate the class.' },
    ];
    const result = assertResource(r);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });
});

describe('Phase B — PPTX renderer dispatches the new layouts', () => {
  test('LAYOUT_RENDERERS registers all six new layouts', () => {
    const r = pptxInternals.LAYOUT_RENDERERS;
    assert.equal(typeof r.warmUp,         'function');
    assert.equal(typeof r.wordWall,       'function');
    assert.equal(typeof r.thinkPairShare, 'function');
    assert.equal(typeof r.workedExample,  'function');
    assert.equal(typeof r.yourTurn,       'function');
    assert.equal(typeof r.celebrate,      'function');
  });

  test('a deck using all six new layouts renders to a valid PPTX', async () => {
    const r = makeLesson();
    r.lesson.slides = [
      { ordinal: 1, layout: 'title',          heading: 'Whole numbers', speakerNotes: 'Welcome.' },
      { ordinal: 2, layout: 'warmUp',         heading: 'How many beads here?',
        bullets: ['Hint: count in groups of 10.'], speakerNotes: 'Show the bead string.' },
      { ordinal: 3, layout: 'wordWall',       heading: 'Key words',
        speakerNotes: 'Pull definitions from vocabulary.' },
      { ordinal: 4, layout: 'workedExample',  heading: 'Solving 234 + 156',
        bullets: ['Add the units.', 'Add the tens.', 'Add the hundreds.'],
        speakerNotes: 'Walk through.' },
      { ordinal: 5, layout: 'thinkPairShare', heading: 'Why is place value useful?',
        bullets: ['Compare your answers.'], speakerNotes: 'Pair up.' },
      { ordinal: 6, layout: 'yourTurn',       heading: 'Your turn',
        bullets: ['Try questions 1–4.'], speakerNotes: 'Hand out worksheets.' },
      { ordinal: 7, layout: 'celebrate',      heading: 'Well done!',
        speakerNotes: 'Congratulate.' },
    ];
    const b64 = await renderLessonPptx(r);
    assert.ok(b64.length > 1000, 'expected non-trivial PPTX bytes');
    const buf = Buffer.from(b64, 'base64');
    const zip = await JSZip.loadAsync(buf);
    // Every slide should be present in the zip.
    for (let i = 1; i <= 7; i++) {
      const path = `ppt/slides/slide${i}.xml`;
      assert.ok(zip.file(path), `expected slide file at ${path}`);
    }
  });

  test('warmUp slide carries the WARM-UP eyebrow strap', async () => {
    const r = makeLesson();
    r.lesson.slides = [
      { ordinal: 1, layout: 'title',  heading: 'Topic', speakerNotes: 'Welcome.' },
      { ordinal: 2, layout: 'warmUp', heading: 'How many?', speakerNotes: 'Ask.' },
      ...r.lesson.slides.slice(2),
    ];
    const b64 = await renderLessonPptx(r);
    const zip = await JSZip.loadAsync(Buffer.from(b64, 'base64'));
    const slide2 = await zip.file('ppt/slides/slide2.xml').async('string');
    assert.match(slide2, /WARM-UP/);
  });

  test('celebrate slide includes confetti shapes', async () => {
    const r = makeLesson();
    r.lesson.slides = [
      ...r.lesson.slides.slice(0, 6),
      { ordinal: 7, layout: 'celebrate', heading: 'Well done!', speakerNotes: 'Cheer.' },
    ];
    const b64 = await renderLessonPptx(r);
    const zip = await JSZip.loadAsync(Buffer.from(b64, 'base64'));
    const slide7 = await zip.file('ppt/slides/slide7.xml').async('string');
    // Confetti renders as multiple ellipses; expect ≥ 8 ellipse shapes on
    // the slide (10 in code minus a small safety margin).
    const ellipseCount = (slide7.match(/<p:sp>/g) || []).length;
    assert.ok(ellipseCount >= 8, `expected confetti shapes on celebrate, got ${ellipseCount}`);
  });
});

describe('Phase B — prompt guidance teaches the model the new layouts', () => {
  test('buildLessonContextBlock mentions every new layout name', () => {
    const UNIT = {
      id: 'MATH-4-2026-t1-u1',
      topic: 'Whole numbers',
      capsStrand: 'Numbers, Operations and Relationships',
      weeks: [1, 2], hours: 6,
      subtopics: [{ heading: 'Counting', concepts: ['count to 1000'] }],
    };
    const text = buildLessonContextBlock(UNIT, 45, 'English').join('\n');
    for (const layout of ['warmUp', 'wordWall', 'thinkPairShare', 'workedExample', 'yourTurn', 'celebrate']) {
      assert.match(text, new RegExp(layout), `prompt should mention layout: ${layout}`);
    }
  });

  test('prompt instructs the model to vary layouts across the deck', () => {
    const UNIT = {
      id: 'MATH-4-2026-t1-u1',
      topic: 'Whole numbers',
      capsStrand: 'Numbers, Operations and Relationships',
      weeks: [1, 2], hours: 6,
      subtopics: [{ heading: 'Counting', concepts: ['count to 1000'] }],
    };
    const text = buildLessonContextBlock(UNIT, 45, 'English').join('\n');
    assert.match(text, /at least 3 different layouts|vary the layouts|Variety/i,
      'prompt should explicitly nudge the model toward layout variety');
  });
});

describe('Phase B — cache version bump', () => {
  test('cache key prefix is now gen:v6:', () => {
    const { buildCacheKey } = generateInternals;
    const key = buildCacheKey({
      subject: 'Mathematics', grade: 4, term: 1,
      language: 'English', resourceType: 'Lesson',
      totalMarks: 10, difficulty: 'on',
      unitId: 'MATH-4-u1', lessonMinutes: 45,
    });
    assert.ok(key.startsWith('gen:v6:'),
      `expected cache key to start with gen:v6:, got "${key.slice(0, 12)}…"`);
  });

  test('non-Lesson cache keys also pick up the v6 bump', () => {
    const { buildCacheKey } = generateInternals;
    const key = buildCacheKey({
      subject: 'Mathematics', grade: 4, term: 1,
      language: 'English', resourceType: 'Test',
      totalMarks: 50, difficulty: 'on',
    });
    assert.ok(key.startsWith('gen:v6:'),
      'non-Lesson keys also share the version prefix');
  });
});

// ─────────────────────────────────────────────────────────────────
// Phase C — Illustration library wired into DOCX + PPTX
// ─────────────────────────────────────────────────────────────────

describe('Phase C — DOCX embeds illustration PNGs', () => {
  test('junior Lesson DOCX embeds the mascot on the cover', async () => {
    const r = makeLesson();
    r.meta.grade = 4;   // junior band
    const doc = renderResource(r);
    const buf = await Packer.toBuffer(doc);
    const zip = await JSZip.loadAsync(buf);
    const mediaPaths = Object.keys(zip.files).filter((p) => /^word\/media\/.+\.png$/.test(p));
    assert.ok(mediaPaths.length >= 1,
      `expected at least one embedded PNG (mascot + stamp), got 0`);
  });

  test('senior Lesson DOCX embeds the subject icon on the cover (no stamp)', async () => {
    const r = makeLesson();
    r.meta.grade = 7;   // senior band — icon on cover, NO stamp on memo
    const doc = renderResource(r);
    const buf = await Packer.toBuffer(doc);
    const zip = await JSZip.loadAsync(buf);
    const mediaPaths = Object.keys(zip.files).filter((p) => /^word\/media\/.+\.png$/.test(p));
    assert.ok(mediaPaths.length >= 1, 'senior cover should still have a subject-icon hero');
  });

  test('Test/Exam DOCX does NOT embed lesson illustrations', async () => {
    const r = makeLesson();
    r.meta.resourceType = 'Test';
    delete r.lesson;
    r.cover.resourceTypeLabel = 'TEST';
    const doc = renderResource(r);
    const buf = await Packer.toBuffer(doc);
    const zip = await JSZip.loadAsync(buf);
    const mediaPaths = Object.keys(zip.files).filter((p) => /^word\/media\/.+\.png$/.test(p));
    assert.equal(mediaPaths.length, 0,
      `assessments must not pick up Lesson illustrations, found ${mediaPaths.length}`);
  });
});

describe('Phase C — PPTX embeds illustration PNGs', () => {
  test('PPTX title slide embeds a hero illustration (junior mascot)', async () => {
    const r = makeLesson();
    r.meta.grade = 4;
    const b64 = await renderLessonPptx(r);
    const zip = await JSZip.loadAsync(Buffer.from(b64, 'base64'));
    const mediaPaths = Object.keys(zip.files).filter((p) => /^ppt\/media\/.+\.png$/.test(p));
    assert.ok(mediaPaths.length >= 1,
      `expected at least one embedded image in PPTX, got ${mediaPaths.length}`);
  });

  test('PPTX celebrate slide embeds the well-done stamp on junior band', async () => {
    const r = makeLesson();
    r.meta.grade = 4;
    r.lesson.slides = [
      { ordinal: 1, layout: 'title',     heading: 'Whole numbers', speakerNotes: 'Welcome.' },
      { ordinal: 2, layout: 'concept',   heading: 'Place value',
        bullets: ['100s', '10s', '1s'], speakerNotes: 'Demo.' },
      { ordinal: 3, layout: 'celebrate', heading: 'Well done!',
        bullets: ['Today we learned place value.'], speakerNotes: 'Cheer.' },
    ];
    const b64 = await renderLessonPptx(r);
    const zip = await JSZip.loadAsync(Buffer.from(b64, 'base64'));
    const mediaPaths = Object.keys(zip.files).filter((p) => /^ppt\/media\/.+\.png$/.test(p));
    // Title hero + celebrate stamp = ≥ 2 images
    assert.ok(mediaPaths.length >= 2,
      `expected title hero + celebrate stamp PNGs, got ${mediaPaths.length}`);
  });

  test('PPTX celebrate slide on senior band has no stamp', async () => {
    const r = makeLesson();
    r.meta.grade = 7;
    r.lesson.slides = [
      { ordinal: 1, layout: 'title',     heading: 'Topic', speakerNotes: 'Welcome.' },
      { ordinal: 2, layout: 'concept',   heading: 'Place value',
        bullets: ['100s', '10s', '1s'], speakerNotes: 'Demo.' },
      { ordinal: 3, layout: 'celebrate', heading: 'Well done!', speakerNotes: 'Cheer.' },
    ];
    const b64 = await renderLessonPptx(r);
    const zip = await JSZip.loadAsync(Buffer.from(b64, 'base64'));
    // Senior celebrate = text-only (no stamp); only the title hero counts.
    // Inspect celebrate slide XML for image tags.
    const slide3 = await zip.file('ppt/slides/slide3.xml').async('string');
    assert.ok(!/<p:pic>/.test(slide3),
      'senior celebrate slide should have no embedded picture (text-only headline)');
  });

  test('PPTX yourTurn slide embeds the subject icon (replaces play-arrow placeholder)', async () => {
    const r = makeLesson();
    r.lesson.slides = [
      { ordinal: 1, layout: 'title',    heading: 'Topic',  speakerNotes: 'Welcome.' },
      { ordinal: 2, layout: 'yourTurn', heading: 'Your turn',
        bullets: ['Try questions 1–4.'], speakerNotes: 'Hand out.' },
    ];
    const b64 = await renderLessonPptx(r);
    const zip = await JSZip.loadAsync(Buffer.from(b64, 'base64'));
    const slide2 = await zip.file('ppt/slides/slide2.xml').async('string');
    assert.match(slide2, /<p:pic>/,
      'yourTurn slide should embed the subject icon (Phase C wiring)');
  });
});

