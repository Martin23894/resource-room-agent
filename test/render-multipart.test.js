// Multi-part question rendering: a flat leaf with inline (a)/(b)/(c)/(d)
// markers is split at render time into a vertical layout with per-part
// answer space. Regression guard for docs/teacher-feedback-2026-05.md §2.1
// ("Multi-part questions render as a vertical list with an answer space
// per part. Never run them inline.").

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Packer } from 'docx';
import JSZip from 'jszip';

import { __internals, renderResource } from '../lib/render.js';

const { splitMultipartStem } = __internals;

test('splitMultipartStem: classic 3-part stem splits with preamble', () => {
  const r = splitMultipartStem({
    stem: 'Rewrite each sentence in past tense. (a) The cat sleeps. (b) The dog runs. (c) The bird sings.',
  });
  assert.ok(r);
  assert.equal(r.preamble, 'Rewrite each sentence in past tense.');
  assert.equal(r.parts.length, 3);
  assert.deepEqual(r.parts.map((p) => p.label), ['a', 'b', 'c']);
  assert.equal(r.parts[0].text, 'The cat sleeps.');
});

test('splitMultipartStem: 2-part stem also splits', () => {
  const r = splitMultipartStem({
    stem: 'Match each pair. (a) Apple — Fruit. (b) Carrot — Vegetable.',
  });
  assert.ok(r);
  assert.equal(r.parts.length, 2);
});

test('splitMultipartStem: single (a) mention does not trigger split', () => {
  // A stem that mentions "(a)" once in passing — e.g. referring to an
  // earlier option — must not be mis-detected as multi-part.
  const r = splitMultipartStem({
    stem: 'Look at option (a) from the previous question and explain.',
  });
  assert.equal(r, null);
});

test('splitMultipartStem: MCQ leaf is skipped', () => {
  // MCQ options live in q.options; their (a)(b)(c)(d) labels must not
  // trigger the inline-multipart splitter even if they appear in the stem.
  const r = splitMultipartStem({
    type: 'MCQ',
    answerSpace: { kind: 'options' },
    stem: 'Which of (a), (b), or (c) is correct?',
  });
  assert.equal(r, null);
});

test('splitMultipartStem: non-sequential labels do not trigger', () => {
  // (a) followed by (c) without (b) is not a coherent sequence.
  const r = splitMultipartStem({
    stem: 'See (a) here and (c) there.',
  });
  assert.equal(r, null);
});

test('end-to-end: rendered DOCX of an inline-multipart leaf has stacked answer lines', async () => {
  const fixture = {
    meta: {
      schemaVersion: '1.0',
      subject: 'English Home Language', grade: 6, term: 1, language: 'English',
      resourceType: 'Test', totalMarks: 6, duration: { minutes: 30 }, difficulty: 'on',
      cognitiveFramework: { name: "Barrett's", levels: [
        { name: 'Literal', percent: 100, prescribedMarks: 6 },
      ]},
      topicScope: { coversTerms: [1], topics: ['Language structures'] },
    },
    cover: {
      resourceTypeLabel: 'TEST', subjectLine: 'English Home Language',
      gradeLine: 'Grade 6', termLine: 'Term 1',
      learnerInfoFields: [{ kind: 'name', label: 'Name' }],
      instructions: { heading: 'Instructions', items: ['Answer all questions.'] },
    },
    stimuli: [],
    sections: [{
      letter: 'A', title: 'TEST',
      questions: [{
        number: '1', type: 'ShortAnswer', topic: 'Language structures',
        // Inline multi-part stem — the failure mode the teacher review
        // flagged. The renderer must split into vertical layout.
        stem: 'Rewrite each sentence in past tense. (a) The cat sleeps. (b) The dog runs. (c) The bird sings.',
        marks: 6, cognitiveLevel: 'Literal',
        answerSpace: { kind: 'lines', lines: 1 },
      }],
    }],
    memo: { answers: [{
      questionNumber: '1', answer: '(a) slept (b) ran (c) sang', cognitiveLevel: 'Literal', marks: 6,
    }]},
  };
  const doc = renderResource(fixture);
  const buf = await Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(buf);
  const docXml = await zip.file('word/document.xml').async('string');
  // Each part label appears in its own paragraph — count "(a) ", "(b) ", "(c) "
  for (const lbl of ['(a)', '(b)', '(c)']) {
    assert.ok(docXml.includes(lbl), `expected '${lbl}' in rendered XML`);
  }
  // The blank-answer-line glyph (45+ underscores) appears at least once
  // per part. Check the underscore-line count is ≥ 3 (one per part minimum).
  const lineCount = (docXml.match(/_{40,}/g) || []).length;
  assert.ok(lineCount >= 3, `expected ≥3 answer lines (one per part), found ${lineCount}`);
});
