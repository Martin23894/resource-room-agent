// Unit tests for the pure helpers in scripts/extract-atp-pacing.js.
// The CLI / Claude-API path is not exercised here (it requires
// ANTHROPIC_API_KEY and a live PDF dump); the GitHub Actions workflow is
// the integration smoke-test for that.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseFilename,
  extractJson,
  repairJson,
  mergePacingDoc,
  stableSerialise,
  CANONICAL_SUBJECTS,
} from '../scripts/extract-atp-pacing.js';

// The 34 PDFs currently in the repo. If a PDF is added/renamed, update here.
const ALL_PDFS = [
  '1.010 ATP 2023-24 Gr 4 Afrikaans FAL final.pdf',
  '1.010 ATP 2023-24 Gr 4 Soc Sci final.pdf',
  '1.010 ATP 2023-24 Gr 7 Afrikaans FAL final.pdf',
  '1.020 ATP 2023-24 Gr 4 Afrikaans HL final.pdf',
  '1.020 ATP 2023-24 Gr 5 Soc Sci final.pdf',
  '1.020 ATP 2023-24 Gr 7 Afrikaans HL final.pdf',
  '1.030 ATP 2023-24 Gr 6 Soc Sci final.pdf',
  '1.030 ATP 2023-24 Gr 7 English FAL final.pdf',
  '1.040 ATP 2023-24 Gr 4 English FAL final.pdf',
  '1.040 ATP 2023-24 Gr 7 English HL final.pdf',
  '1.050 ATP 2023-24 Gr 4 Eng HL final.pdf',
  '1.100 ATP 2023-24 Gr 7 Soc Sci final.pdf',
  '1.130 ATP 2023-24 Gr 4 Life Ski final.pdf',
  '1.140 ATP 2023-24 Gr 5 Life Ski final.pdf',
  '1.150 ATP 2023-24 Gr 6 Life Ski final.pdf',
  '1.180 ATP 2023-24 Gr 6 Maths final.pdf',
  '1.190 ATP 2023-24 Gr 7 Maths final.pdf',
  '1.220 ATP 2023-24 Gr 7 LO final.pdf',
  '1.250 ATP 2023-24 Gr 5 Afrikaans FAL final.pdf',
  '1.260 ATP 2023-24 Gr 5 Afrikaans HL final.pdf',
  '1.270 ATP 2023-24 Gr 5 English FAL final.pdf',
  '1.280 ATP 2023-24 Gr 5 English HL final.pdf',
  '1.480 ATP 2023-24 Gr 6 Afrikaans FAL final.pdf',
  '1.490 ATP 2023-24 Gr 6 Afrikaans HL final.pdf',
  '1.500 ATP 2023-24 Gr 6 English FAL final.pdf',
  '1.510 ATP 2023-24 Gr 6 English HL final.pdf',
  '1.610 ATP 2023-24 Gr 7 EMS final.pdf',
  '1.640 ATP 2023-24 Gr 7 Techn final.pdf',
  '2026_ATP_Mathematics_Grade 4.pdf',
  '2026_ATP_Mathematics_Grade 5.pdf',
  '2026_ATP_NS & Tech_Grade 4.pdf',
  '2026_ATP_NS & Tech_Grade 5.pdf',
  '2026_ATP_NS & Tech_Grade 6.pdf',
  '2026_ATP_NS_Grade 7.pdf',
];

describe('parseFilename', () => {
  test('parses every shipped ATP PDF filename', () => {
    for (const f of ALL_PDFS) {
      const m = parseFilename(f);
      assert.ok(m.year, `year missing for ${f}`);
      assert.ok(m.grade >= 4 && m.grade <= 7, `grade out of range for ${f}: ${m.grade}`);
      assert.ok(m.subjects.length > 0, `no subjects for ${f}`);
      for (const s of m.subjects) {
        assert.ok(CANONICAL_SUBJECTS.has(s), `non-canonical subject "${s}" for ${f}`);
      }
    }
  });

  test('Soc Sci filename emits both History and Geography', () => {
    const m = parseFilename('1.010 ATP 2023-24 Gr 4 Soc Sci final.pdf');
    assert.deepEqual(m.subjects.sort(), [
      'Social Sciences — Geography',
      'Social Sciences — History',
    ]);
  });

  test('Life Ski filename emits all three Life Skills sub-subjects', () => {
    const m = parseFilename('1.130 ATP 2023-24 Gr 4 Life Ski final.pdf');
    assert.equal(m.subjects.length, 3);
    assert.ok(m.subjects.includes('Life Skills — Personal and Social Wellbeing'));
    assert.ok(m.subjects.includes('Life Skills — Physical Education'));
    assert.ok(m.subjects.includes('Life Skills — Creative Arts'));
  });

  test('2026 NS Grade 7 (no "& Tech") parses as Natural Sciences', () => {
    const m = parseFilename('2026_ATP_NS_Grade 7.pdf');
    assert.equal(m.year, '2026');
    assert.equal(m.grade, 7);
    assert.deepEqual(m.subjects, ['Natural Sciences']);
  });

  test('2026 NS & Tech still wins over bare NS', () => {
    const m = parseFilename('2026_ATP_NS & Tech_Grade 5.pdf');
    assert.deepEqual(m.subjects, ['Natural Sciences and Technology']);
  });
});

describe('extractJson', () => {
  test('parses bare JSON', () => {
    const j = extractJson('{"pacingDocs":[]}');
    assert.deepEqual(j, { pacingDocs: [] });
  });

  test('strips ```json fences if model adds them', () => {
    const j = extractJson('```json\n{"pacingDocs":[{"a":1}]}\n```');
    assert.deepEqual(j, { pacingDocs: [{ a: 1 }] });
  });

  test('tolerates leading/trailing prose', () => {
    const j = extractJson('Sure, here is the JSON:\n{"x":42}\nLet me know if anything else.');
    assert.deepEqual(j, { x: 42 });
  });

  test('throws on no JSON', () => {
    assert.throws(() => extractJson('no json here'), /No JSON object found/);
  });

  test('recovers from literal newline inside a string value', () => {
    // Claude sometimes preserves a verbatim PDF excerpt with a real
    // newline mid-string instead of escaping it as \n.
    const broken = '{"label":"line one\nline two","ok":true}';
    const j = extractJson(broken);
    assert.equal(j.label, 'line one\nline two');
    assert.equal(j.ok, true);
  });

  test('recovers from missing comma between adjacent objects', () => {
    const broken = '{"items":[{"a":1} {"b":2}]}';
    const j = extractJson(broken);
    assert.deepEqual(j, { items: [{ a: 1 }, { b: 2 }] });
  });

  test('recovers from trailing comma before ]', () => {
    const broken = '{"items":[1,2,3,]}';
    const j = extractJson(broken);
    assert.deepEqual(j, { items: [1, 2, 3] });
  });

  test('recovers from a tab inside a string value', () => {
    const broken = '{"label":"col1\tcol2"}';
    const j = extractJson(broken);
    assert.equal(j.label, 'col1\tcol2');
  });
});

describe('repairJson', () => {
  test('leaves valid JSON untouched', () => {
    const valid = '{"a":1,"b":[2,3],"c":"hello"}';
    assert.equal(repairJson(valid), valid);
  });

  test('does not insert commas inside strings', () => {
    // The "} {" pattern appears inside the string value but must NOT be
    // touched; only structural occurrences outside quotes get a comma.
    const s = '{"label":"} {","ok":true}';
    const repaired = repairJson(s);
    assert.deepEqual(JSON.parse(repaired), { label: '} {', ok: true });
  });
});

describe('mergePacingDoc', () => {
  function makeDoc(overrides = {}) {
    return {
      subject: 'Mathematics',
      grade: 4,
      year: '2026',
      phase: 'intermediate',
      language: 'English',
      source: { pdf: 'x.pdf', totalPages: 8, publishedBy: 'DBE', documentTitle: 'X' },
      capsStrands: [],
      terms: { 1: { term: 1, units: [], formalAssessment: [], totalWeeks: null, totalHours: null, termNotes: [] } },
      yearOverview: null,
      notes: [],
      ...overrides,
    };
  }

  test('merges into empty corpus', () => {
    const corpus = { subjects: {} };
    const r = mergePacingDoc(corpus, makeDoc(), { force: false });
    assert.equal(r.skipped, false);
    assert.ok(corpus.subjects.Mathematics['4']['2026']);
  });

  test('skips on existing entry without --force', () => {
    const corpus = { subjects: {} };
    mergePacingDoc(corpus, makeDoc(), { force: false });
    const r = mergePacingDoc(corpus, makeDoc({ phase: 'CHANGED' }), { force: false });
    assert.equal(r.skipped, true);
    assert.equal(corpus.subjects.Mathematics['4']['2026'].phase, 'intermediate');
  });

  test('overwrites on --force', () => {
    const corpus = { subjects: {} };
    mergePacingDoc(corpus, makeDoc(), { force: false });
    const r = mergePacingDoc(corpus, makeDoc({ phase: 'CHANGED' }), { force: true });
    assert.equal(r.skipped, false);
    assert.equal(corpus.subjects.Mathematics['4']['2026'].phase, 'CHANGED');
  });

  test('keeps 2026 and 2023-24 side-by-side', () => {
    const corpus = { subjects: {} };
    mergePacingDoc(corpus, makeDoc({ year: '2026' }), { force: false });
    mergePacingDoc(corpus, makeDoc({ year: '2023-24' }), { force: false });
    assert.ok(corpus.subjects.Mathematics['4']['2026']);
    assert.ok(corpus.subjects.Mathematics['4']['2023-24']);
  });
});

describe('stableSerialise', () => {
  test('subjects sorted alphabetically; grades numerically', () => {
    const corpus = {
      $schemaVersion: '1.0.0',
      extractedAt: null,
      extractor: { model: null, promptVersion: 1 },
      subjects: {
        'Mathematics': { '7': { '2026': { x: 1 } }, '4': { '2026': { x: 2 } } },
        'Afrikaans Home Language': { '5': { '2023-24': { x: 3 } } },
      },
    };
    const s = stableSerialise(corpus);
    const idxAfr = s.indexOf('Afrikaans');
    const idxMath = s.indexOf('Mathematics');
    assert.ok(idxAfr < idxMath, 'Afrikaans should come before Mathematics');
    const idxG4 = s.indexOf('"4"');
    const idxG7 = s.indexOf('"7"');
    assert.ok(idxG4 < idxG7, 'Grade 4 should serialise before Grade 7');
    assert.ok(s.endsWith('\n'), 'output should end with newline');
  });
});
