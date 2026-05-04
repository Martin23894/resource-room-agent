// Unit tests for the CAPS-pacing prompt builders. Pure functions, no
// network or generation dependencies.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatSubtopics,
  formatPacingUnit,
  formatFormalAssessmentStructure,
  buildCapsReferenceBlock,
  buildAssessmentStructureBlock,
} from '../lib/atp-prompt.js';

const SAMPLE_UNIT = {
  topic: 'Whole numbers: addition and subtraction',
  capsStrand: 'Numbers, Operations and Relationships',
  subStrand: 'Whole Numbers',
  isRevision: false,
  isAssessmentSlot: false,
  weeks: [4, 5, 6],
  hours: 18,
  subtopics: [
    {
      heading: 'Calculation techniques',
      concepts: [
        'Use any two techniques to perform and check written and mental calculations',
        '— Estimation',
        '— Building up and breaking down numbers',
      ],
      children: [],
    },
  ],
  prerequisites: [
    'Counting up to 800',
    'Recognising place value of three-digit numbers',
  ],
  notes: [
    'Note: Ensure that the strategies used do not compromise conceptual understanding',
  ],
};

const SAMPLE_REVISION_UNIT = {
  topic: 'Revision of Grade 3 work',
  capsStrand: 'Numbers, Operations and Relationships',
  isRevision: true,
  isAssessmentSlot: false,
  subtopics: [],
  prerequisites: ['Grade 3 number range up to 800'],
  notes: [],
};

const SAMPLE_ASSESSMENT_SLOT_UNIT = {
  topic: 'FORMAL ASSESSMENT TASK',
  isRevision: false,
  isAssessmentSlot: true,
  subtopics: [],
  prerequisites: [],
  notes: [],
};

const SAMPLE_LANGUAGES_FA = {
  label: 'FORMAL ASSESSMENT TASK 2: WRITING',
  type: 'Test',
  totalMarks: 50,
  weightingPercent: null,
  sections: [
    { label: 'Listening and Speaking', marks: 10, capsStrand: 'Listening and Speaking', notes: null },
    { label: 'Reading and Viewing', marks: 15, capsStrand: 'Reading and Viewing', notes: null },
    { label: 'Writing and Presenting', marks: 15, capsStrand: 'Writing and Presenting', notes: null },
    { label: 'Language Structures and Conventions', marks: 10, capsStrand: 'Language Structures and Conventions', notes: null },
  ],
  conditions: 'Completed in class within 90 minutes',
};

describe('formatSubtopics', () => {
  test('flattens a flat tree with bullet markers preserved', () => {
    const lines = formatSubtopics(SAMPLE_UNIT.subtopics);
    assert.ok(lines.some((l) => l.includes('Calculation techniques')));
    assert.ok(lines.some((l) => l.includes('— Estimation')));
  });

  test('returns [] for missing/empty input', () => {
    assert.deepEqual(formatSubtopics(undefined), []);
    assert.deepEqual(formatSubtopics([]), []);
  });

  test('indents nested children deeper than their parent', () => {
    const tree = [
      { heading: 'Outer', concepts: ['outer-bullet'], children: [
        { heading: 'Inner', concepts: ['inner-bullet'], children: [] },
      ] },
    ];
    const lines = formatSubtopics(tree);
    const outerIdx = lines.findIndex((l) => l.includes('Outer'));
    const innerIdx = lines.findIndex((l) => l.includes('Inner'));
    assert.ok(outerIdx >= 0 && innerIdx >= 0);
    assert.ok(lines[innerIdx].startsWith('  '),
      'nested heading should be indented with 2+ spaces');
  });
});

describe('formatPacingUnit', () => {
  test('renders topic, strand, concepts, prerequisites, notes', () => {
    const out = formatPacingUnit(SAMPLE_UNIT);
    assert.match(out, /### Whole numbers: addition and subtraction/);
    assert.match(out, /CAPS strand: Numbers, Operations and Relationships \/ Whole Numbers/);
    assert.match(out, /Concepts and skills:/);
    assert.match(out, /— Estimation/);
    assert.match(out, /Prior knowledge \(do not re-teach/);
    assert.match(out, /Counting up to 800/);
    assert.match(out, /CAPS notes:/);
  });

  test('flags REVISION units in the heading', () => {
    const out = formatPacingUnit(SAMPLE_REVISION_UNIT);
    assert.match(out, /### Revision of Grade 3 work \[REVISION\]/);
  });

  test('flags FORMAL ASSESSMENT SLOT units', () => {
    const out = formatPacingUnit(SAMPLE_ASSESSMENT_SLOT_UNIT);
    assert.match(out, /\[FORMAL ASSESSMENT SLOT\]/);
  });

  test('omits empty sections (no spurious "Concepts and skills:" header)', () => {
    const minimal = {
      topic: 'Bare unit',
      isRevision: false,
      isAssessmentSlot: false,
      subtopics: [],
      prerequisites: [],
      notes: [],
    };
    const out = formatPacingUnit(minimal);
    assert.equal(out, '### Bare unit');
  });
});

describe('formatFormalAssessmentStructure', () => {
  test('returns null when no assessments are provided', () => {
    assert.equal(formatFormalAssessmentStructure([], 'Test', 50), null);
    assert.equal(formatFormalAssessmentStructure(undefined, 'Test', 50), null);
  });

  test('returns null when no assessment has section splits', () => {
    const noSections = [{ label: 'X', sections: [], totalMarks: 50 }];
    assert.equal(formatFormalAssessmentStructure(noSections, 'Test', 50), null);
  });

  test('renders the section split for a Languages Test', () => {
    const out = formatFormalAssessmentStructure([SAMPLE_LANGUAGES_FA], 'Test', 50);
    assert.ok(out, 'expected a non-null output');
    assert.match(out, /CAPS Formal Assessment "FORMAL ASSESSMENT TASK 2: WRITING"/);
    assert.match(out, /total of 50 marks/);
    assert.match(out, /Listening and Speaking.*10 marks/);
    assert.match(out, /Writing and Presenting.*15 marks/);
    assert.match(out, /Conditions: Completed in class within 90 minutes/);
  });

  test('returns null when no assessment is within the mark-tolerance band', () => {
    // The 2026-05 matcher rewrite (lib/atp-prompt.js) disqualifies any
    // assessment whose totalMarks is more than 40% off from the request,
    // because the previous fallback-to-first-assessment behaviour was
    // emitting a 20-mark Oral structure as the canonical shape for a
    // 60-mark Test — misleading the model. Correct behaviour: when
    // nothing qualifies, return null and let the prompt skip the
    // structure block rather than over-prescribe.
    const oral = {
      label: 'Oral',
      totalMarks: 20,
      type: 'Oral',
      sections: [{ label: 'Read Aloud', marks: 20, capsStrand: 'Listening and Speaking' }],
    };
    // 60-mark Test vs 20-mark Oral: ratio = 0.667 > 0.4 → disqualified.
    const out = formatFormalAssessmentStructure([oral], 'Test', 60);
    assert.equal(out, null);
  });

  test('prefers comprehensive Examination shape over narrower Test when both fit', () => {
    // Reproduces the wife's English HL Gr6 T2 scenario from
    // docs/teacher-feedback-2026-05.md: TWO 50-mark formal assessments
    // exist (a 3-section "Test: Response to Texts" and a 4-section
    // "Examination: June Controlled Test"). The wife wanted the 4-section
    // structure (20+10+5+15) for her Term 2 Test paper. Pre-fix the
    // matcher picked the first-listed candidate (Task 3); post-fix it
    // prefers Examination type + more sections.
    const responseToTexts = {
      label: 'Task 3: Response to Texts',
      type: 'Test',
      totalMarks: 50,
      sections: [
        { label: 'Literary text', marks: 20, capsStrand: 'Reading and Viewing' },
        { label: 'Visual text', marks: 10, capsStrand: 'Reading and Viewing' },
        { label: 'Language structures', marks: 20, capsStrand: 'Language Structures and Conventions' },
      ],
    };
    const juneControlledTest = {
      label: 'Task 5: June Controlled Test',
      type: 'Examination',
      totalMarks: 50,
      sections: [
        { label: 'Literary text', marks: 20, capsStrand: 'Reading and Viewing' },
        { label: 'Visual text', marks: 10, capsStrand: 'Reading and Viewing' },
        { label: 'Summary writing', marks: 5, capsStrand: 'Writing and Presenting' },
        { label: 'Language structures', marks: 15, capsStrand: 'Language Structures and Conventions' },
      ],
    };
    const out = formatFormalAssessmentStructure(
      [responseToTexts, juneControlledTest],
      'Test', 50,
    );
    assert.match(out, /June Controlled Test/);
    assert.match(out, /Summary writing.*5 marks/);
    assert.match(out, /Language structures.*15 marks/);
  });
});

describe('buildCapsReferenceBlock', () => {
  test('returns [] for empty input (graceful fallback)', () => {
    assert.deepEqual(buildCapsReferenceBlock([]), []);
    assert.deepEqual(buildCapsReferenceBlock(undefined), []);
  });

  test('emits header + intro + formatted units when input is non-empty', () => {
    const lines = buildCapsReferenceBlock([SAMPLE_UNIT]);
    assert.ok(lines.length >= 4);
    assert.match(lines[0], /^## CAPS reference/);
    // Lines: header, intro, '', joined-units, '' — units live at index 3.
    assert.match(lines[3], /Whole numbers: addition and subtraction/);
  });

  test('filters out FORMAL ASSESSMENT SLOT placeholder rows', () => {
    // A list that's ONLY assessment-slot rows should produce no block.
    const lines = buildCapsReferenceBlock([SAMPLE_ASSESSMENT_SLOT_UNIT]);
    assert.deepEqual(lines, []);
  });

  test('keeps revision units (they carry prerequisites worth showing)', () => {
    const lines = buildCapsReferenceBlock([SAMPLE_REVISION_UNIT]);
    assert.ok(lines.length >= 3);
    assert.match(lines.join('\n'), /\[REVISION\]/);
  });
});

describe('buildAssessmentStructureBlock', () => {
  test('returns [] when no structure is available', () => {
    assert.deepEqual(buildAssessmentStructureBlock([], 'Test', 50), []);
    assert.deepEqual(buildAssessmentStructureBlock(undefined, 'Test', 50), []);
  });

  test('emits the block when a Languages assessment matches', () => {
    const lines = buildAssessmentStructureBlock([SAMPLE_LANGUAGES_FA], 'Test', 50);
    assert.ok(lines.length >= 3);
    assert.match(lines[0], /^## CAPS assessment structure/);
    assert.match(lines.join('\n'), /Listening and Speaking.*10 marks/);
    assert.match(lines.join('\n'), /MUST follow this split/);
  });
});
