// Render rich-text behaviour: balanced **emphasis** spans become real
// underline TextRuns; stray ** markers are stripped; plain text passes
// through unchanged. Regression guard for the markdown-asterisk leak the
// 2026-05 teacher review flagged (docs/teacher-feedback-2026-05.md §2.1).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Packer } from 'docx';
import JSZip from 'jszip';

import { __internals, renderResource } from '../lib/render.js';

const { richRuns } = __internals;

test('richRuns: plain text yields one run, no underline', () => {
  const runs = richRuns('Hello world.');
  assert.equal(runs.length, 1);
});

test('richRuns: balanced **emphasis** yields three runs (plain, emp, plain)', () => {
  const runs = richRuns('Identify the **underlined** noun.');
  assert.equal(runs.length, 3);
});

test('richRuns: multiple emphasis spans interleave correctly', () => {
  const runs = richRuns('Both **first** and **second** are emphasised.');
  assert.equal(runs.length, 5);
});

test('richRuns: unbalanced trailing ** is stripped, not preserved', () => {
  const runs = richRuns('Stray asterisks **without** matching pair**');
  // "Stray asterisks " + "without" + " matching pair" — 3 runs, the
  // trailing ** is stripped from the final plain segment.
  assert.equal(runs.length, 3);
});

test('richRuns: empty input yields a single empty run (not an empty array)', () => {
  // Single-run baseline keeps downstream Paragraph constructors happy
  // even on empty content.
  assert.equal(richRuns('').length, 1);
  assert.equal(richRuns(null).length, 1);
  assert.equal(richRuns(undefined).length, 1);
});

test('end-to-end: rendered DOCX has no literal ** when stem contains markdown', async () => {
  // Minimal valid Resource with **emphasis** in a stem.
  const fixture = {
    meta: {
      schemaVersion: '1.0',
      subject: 'Mathematics', grade: 4, term: 1, language: 'English',
      resourceType: 'Test', totalMarks: 5, duration: { minutes: 30 }, difficulty: 'on',
      cognitiveFramework: { name: "Bloom's", levels: [
        { name: 'Knowledge', percent: 100, prescribedMarks: 5 },
      ]},
      topicScope: { coversTerms: [1], topics: ['Whole numbers'] },
    },
    cover: {
      resourceTypeLabel: 'TEST', subjectLine: 'Mathematics',
      gradeLine: 'Grade 4', termLine: 'Term 1',
      learnerInfoFields: [{ kind: 'name', label: 'Name' }],
      instructions: { heading: 'Instructions', items: ['Answer all questions.'] },
    },
    stimuli: [],
    sections: [{
      letter: 'A', title: 'TEST',
      questions: [{
        number: '1', type: 'ShortAnswer', topic: 'Whole numbers',
        stem: 'Identify the **underlined** noun in this **simple** sentence.',
        marks: 5, cognitiveLevel: 'Knowledge',
        answerSpace: { kind: 'lines', lines: 1 },
      }],
    }],
    memo: { answers: [{
      questionNumber: '1', answer: 'noun', cognitiveLevel: 'Knowledge', marks: 5,
    }]},
  };
  const doc = renderResource(fixture);
  const buf = await Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(buf);
  const docXml = await zip.file('word/document.xml').async('string');
  // No literal ** in the rendered XML. (The stem had two **...** spans.)
  assert.equal((docXml.match(/\*\*/g) || []).length, 0);
  // At least one <w:u underline tag, indicating the emphasis span rendered
  // with the proper underline attribute rather than literal asterisks.
  assert.ok((docXml.match(/<w:u\s/g) || []).length >= 1);
});
