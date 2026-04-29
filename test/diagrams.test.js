// Snapshot-style tests for the diagram renderer + rasteriser.
//
// We don't pixel-compare; we just check that the renderer produces valid
// SVG containing the expected structural elements, and that the rasteriser
// turns it into a non-trivial PNG. Visual regressions are caught in code
// review of the SVG output, not by exact-byte match (fonts and floats vary).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Packer } from 'docx';
import JSZip from 'jszip';

import { renderDiagram, listDiagramTypes } from '../lib/diagrams/index.js';
import { renderBarGraph } from '../lib/diagrams/bar_graph.js';
import { rasterSvgToPng } from '../lib/diagrams/raster.js';
import { assertResource } from '../schema/resource.schema.js';
import { renderResource } from '../lib/render.js';

const sampleSpec = {
  type: 'bar_graph',
  title: 'Favourite fruit',
  x_label: 'Type of fruit',
  y_label: 'Number of learners',
  bars: [
    { label: 'Apple',  value: 8  },
    { label: 'Banana', value: 11 },
    { label: 'Mango',  value: 6  },
    { label: 'Orange', value: 4  },
    { label: 'Pear',   value: 9  },
  ],
};

test('listDiagramTypes returns the registered renderers', () => {
  assert.deepEqual(listDiagramTypes(), ['bar_graph']);
});

test('renderDiagram dispatches by spec.type', () => {
  const a = renderBarGraph(sampleSpec);
  const b = renderDiagram(sampleSpec);
  assert.equal(a, b);
});

test('renderDiagram throws on unknown type', () => {
  assert.throws(() => renderDiagram({ type: 'pie_of_lies', bars: [] }),
                /unknown type/);
});

test('renderBarGraph produces well-formed SVG with all bars', () => {
  const svg = renderBarGraph(sampleSpec);
  assert.match(svg, /^<svg [^>]*viewBox/);
  assert.match(svg, /<\/svg>$/);
  // 5 bars → 5 <rect class="bg-bar">
  const barCount = (svg.match(/class="bg-bar"/g) || []).length;
  assert.equal(barCount, 5);
  // axis labels appear
  assert.match(svg, /Type of fruit/);
  assert.match(svg, /Number of learners/);
  // each category label appears
  for (const b of sampleSpec.bars) assert.match(svg, new RegExp(b.label));
});

test('renderBarGraph escapes HTML-unsafe characters in labels', () => {
  const svg = renderBarGraph({
    ...sampleSpec,
    x_label: 'Apples & Oranges',
    bars: [{ label: '<bad>', value: 1 }, { label: 'safe', value: 2 }],
  });
  assert.match(svg, /Apples &amp; Oranges/);
  assert.match(svg, /&lt;bad&gt;/);
  assert.doesNotMatch(svg, /<bad>/);
});

test('renderBarGraph rejects invalid specs', () => {
  assert.throws(() => renderBarGraph(null),                     /spec must be an object/);
  assert.throws(() => renderBarGraph({ bars: [] }),             /2.10 entries/);
  assert.throws(() => renderBarGraph({ bars: [{ label: 'x', value: 1 }] }), /2.10 entries/);
  assert.throws(() => renderBarGraph({ bars: [{ label: '', value: 1 }, { label: 'b', value: 2 }] }), /non-empty label/);
  assert.throws(() => renderBarGraph({ bars: [{ label: 'a', value: -1 }, { label: 'b', value: 2 }] }), /non-negative/);
});

test('rasterSvgToPng returns a non-trivial PNG buffer', () => {
  const svg = renderBarGraph(sampleSpec);
  const png = rasterSvgToPng(svg, { widthPx: 800 });
  // PNG signature
  assert.equal(png[0], 0x89);
  assert.equal(png[1], 0x50);
  assert.equal(png[2], 0x4e);
  assert.equal(png[3], 0x47);
  // Should be > 1KB for any realistic chart
  assert.ok(png.length > 1000, `PNG too small: ${png.length} bytes`);
});

// ── Phase 2: end-to-end with a Resource containing a diagram stimulus ──
test('renderResource embeds the rendered diagram in the DOCX', async () => {
  const resource = {
    meta: {
      schemaVersion: '1.0',
      subject: 'Mathematics', grade: 4, term: 1, language: 'English',
      resourceType: 'Worksheet',
      totalMarks: 4,
      duration: { minutes: 30 },
      difficulty: 'on',
      cognitiveFramework: { name: "Bloom's", levels: [
        { name: 'Knowledge',          percent: 50, prescribedMarks: 2 },
        { name: 'Routine Procedures', percent: 50, prescribedMarks: 2 },
      ] },
      topicScope: { coversTerms: [1], topics: ['Data handling: bar graphs'] },
    },
    cover: {
      resourceTypeLabel: 'WORKSHEET', subjectLine: 'Mathematics',
      gradeLine: 'Grade 4', termLine: 'Term 1',
      learnerInfoFields: [{ kind: 'name', label: 'Name' }, { kind: 'date', label: 'Date' }],
      instructions: { heading: 'Instructions', items: ['Answer all questions.'] },
    },
    stimuli: [{
      id: 'bar-graph-fruit',
      kind: 'diagram',
      heading: 'BAR GRAPH · FAVOURITE FRUIT',
      altText: 'Bar graph showing learners voting for fruit.',
      spec: sampleSpec,
    }],
    sections: [{
      letter: null, title: 'QUESTIONS',
      instructions: 'Use the bar graph to answer.',
      stimulusRefs: ['bar-graph-fruit'],
      questions: [
        { number: '1', type: 'ShortAnswer', topic: 'Data handling: bar graphs',
          stem: 'Which fruit was the most popular?',
          marks: 2, cognitiveLevel: 'Knowledge',
          answerSpace: { kind: 'lines', lines: 1 } },
        { number: '2', type: 'Calculation', topic: 'Data handling: bar graphs',
          stem: 'How many learners voted in total?',
          marks: 2, cognitiveLevel: 'Routine Procedures',
          answerSpace: { kind: 'workingPlusAnswer' } },
      ],
    }],
    memo: { answers: [
      { questionNumber: '1', answer: 'Banana', cognitiveLevel: 'Knowledge', marks: 2 },
      { questionNumber: '2', answer: '38',     cognitiveLevel: 'Routine Procedures', marks: 2 },
    ] },
  };

  // Structural validation passes
  assertResource(resource);

  // Renders to a DOCX buffer with an embedded image
  const doc = renderResource(resource);
  const buf = await Packer.toBuffer(doc);
  assert.ok(buf.length > 5000, `DOCX too small: ${buf.length} bytes`);

  // Inspect the zip contents directly — the PNG is compressed inside the
  // zip so a raw-buffer signature scan would not see it.
  const zip = await JSZip.loadAsync(buf);
  const mediaPaths = Object.keys(zip.files).filter((p) => /^word\/media\/.+\.png$/.test(p));
  assert.ok(mediaPaths.length >= 1, `DOCX has no embedded PNG (paths: ${Object.keys(zip.files).join(', ')})`);
});

test('renderResource falls back gracefully on a malformed spec', async () => {
  const resource = {
    meta: {
      schemaVersion: '1.0',
      subject: 'Mathematics', grade: 4, term: 1, language: 'English',
      resourceType: 'Worksheet', totalMarks: 1, duration: { minutes: 30 },
      difficulty: 'on',
      cognitiveFramework: { name: "Bloom's", levels: [{ name: 'Knowledge', percent: 100, prescribedMarks: 1 }] },
      topicScope: { coversTerms: [1], topics: ['Data handling: bar graphs'] },
    },
    cover: {
      resourceTypeLabel: 'WORKSHEET', subjectLine: 'Mathematics',
      gradeLine: 'Grade 4', termLine: 'Term 1',
      learnerInfoFields: [{ kind: 'name', label: 'Name' }],
      instructions: { heading: 'Instructions', items: ['Answer all questions.'] },
    },
    stimuli: [{
      id: 'broken',
      kind: 'diagram',
      heading: 'BROKEN DIAGRAM',
      altText: 'Description used as fallback when render fails.',
      description: 'A bar graph that cannot be drawn.',
      spec: { type: 'bar_graph', bars: [{ label: 'only one', value: 1 }] }, // <2 bars → renderer throws
    }],
    sections: [{
      letter: null, title: 'QUESTIONS',
      stimulusRefs: ['broken'],
      questions: [
        { number: '1', type: 'ShortAnswer', topic: 'Data handling: bar graphs',
          stem: 'Test fallback.', marks: 1, cognitiveLevel: 'Knowledge',
          answerSpace: { kind: 'lines', lines: 1 } },
      ],
    }],
    memo: { answers: [
      { questionNumber: '1', answer: '?', cognitiveLevel: 'Knowledge', marks: 1 },
    ] },
  };

  // Should still render (with a fallback message); no throw.
  const doc = renderResource(resource);
  const buf = await Packer.toBuffer(doc);
  assert.ok(buf.length > 1000);
});
