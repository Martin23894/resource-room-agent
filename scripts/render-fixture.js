// Render the G4 Maths Term 1 fixture with a bar-graph diagram attached,
// to prove the SVG → PNG → DOCX pipeline end-to-end.
//
// Usage: node scripts/render-fixture.js [out-path]
//        defaults to /tmp/g4-maths-with-diagram.docx

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Packer } from 'docx';

import fixture from '../schema/fixtures/g4-maths-test-t1.js';
import { renderResource } from '../lib/render.js';
import { renderDiagram } from '../lib/diagrams/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const outPath = process.argv[2] || '/tmp/g4-maths-with-diagram.docx';

// ── Spec for the bar-graph diagram ──
const barGraphSpec = {
  type: 'bar_graph',
  title: 'Favourite fruit in Grade 4',
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

// Sanity-check the renderer in isolation first — easier to debug than
// chasing a DOCX-level error when the SVG is malformed.
const svg = renderDiagram(barGraphSpec);
await fs.writeFile('/tmp/bar-graph-preview.svg', svg, 'utf8');
console.log(`✓ SVG rendered (${svg.length} bytes) → /tmp/bar-graph-preview.svg`);

// ── Build a resource that includes a data-handling section ──
const resource = {
  ...fixture,
  stimuli: [
    ...(fixture.stimuli || []),
    {
      id: 'bar-graph-fruit',
      kind: 'diagram',
      heading: 'BAR GRAPH · FAVOURITE FRUIT IN GRADE 4',
      spec: barGraphSpec,
      altText: 'Bar graph showing the number of Grade 4 learners who chose each fruit.',
    },
  ],
  sections: [
    ...fixture.sections,
    {
      letter: 'C',
      title: 'DATA HANDLING',
      instructions: 'Study the bar graph below, then answer the questions.',
      stimulusRefs: ['bar-graph-fruit'],
      questions: [
        {
          number: '9',
          type: 'Composite',
          topic: 'Data handling: bar graphs',
          stem: 'Use the bar graph to answer the questions below.',
          subQuestions: [
            { number: '9.1', type: 'ShortAnswer', topic: 'Data handling',
              stem: 'Which fruit was the MOST popular?',
              marks: 1, cognitiveLevel: 'Knowledge',
              answerSpace: { kind: 'lines', lines: 1 } },
            { number: '9.2', type: 'ShortAnswer', topic: 'Data handling',
              stem: 'How many learners chose mango?',
              marks: 1, cognitiveLevel: 'Knowledge',
              answerSpace: { kind: 'lines', lines: 1 } },
            { number: '9.3', type: 'Calculation', topic: 'Data handling',
              stem: 'How many MORE learners chose banana than orange?',
              marks: 2, cognitiveLevel: 'Routine Procedures',
              answerSpace: { kind: 'workingPlusAnswer' } },
            { number: '9.4', type: 'Calculation', topic: 'Data handling',
              stem: 'How many learners voted in TOTAL?',
              marks: 3, cognitiveLevel: 'Complex Procedures',
              answerSpace: { kind: 'workingPlusAnswer' } },
          ],
        },
      ],
    },
  ],
};

// ── Render the DOCX ──
const doc = renderResource(resource);
const buf = await Packer.toBuffer(doc);
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, buf);
console.log(`✓ DOCX rendered (${(buf.length / 1024).toFixed(1)} KB) → ${outPath}`);
console.log(`\n  Preview SVG: /tmp/bar-graph-preview.svg`);
console.log(`  Open the DOCX in Word, LibreOffice, or Google Docs to verify.`);
