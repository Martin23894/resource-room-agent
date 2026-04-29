// Snapshot-style tests for the diagram renderer + rasteriser.
//
// We don't pixel-compare; we just check that the renderer produces valid
// SVG containing the expected structural elements, and that the rasteriser
// turns it into a non-trivial PNG. Visual regressions are caught in code
// review of the SVG output, not by exact-byte match (fonts and floats vary).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderDiagram, listDiagramTypes } from '../lib/diagrams/index.js';
import { renderBarGraph } from '../lib/diagrams/bar_graph.js';
import { rasterSvgToPng } from '../lib/diagrams/raster.js';

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
