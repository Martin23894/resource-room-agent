// Number-line renderer: (spec) → SVG string.
//
// Spec shape:
//   { type:        'number_line',
//     range:       [start, end],          // e.g. [0, 100]
//     step:        number,                // major tick spacing (must divide the range cleanly)
//     minor_step:  number?,               // optional finer tick spacing
//     marks:       [{ value, label? }, …] // 0..10 marks plotted on the line
//     title:       string?                // optional title above the line
//   }
//
// Marks with a `label` (typically a single letter A/B/C…) test recall —
// the learner names the value at the marked spot. Marks without a label
// just dot the line with the value shown — used for "place 35 on the
// number line" or "show 1/2 between 0 and 1" prompts.
//
// Rule 5b in the prompt forbids labels that reveal the answer (e.g. a
// mark at 35 with label "35"). The renderer does not enforce this — the
// prompt does — but the schema warns about it.

const BRAND      = '#085041';
const INK        = '#1a1a1a';
const INK_SOFT   = '#4a4a4a';
const RULE       = '#c8c8c8';

const VB_W = 700;
const VB_H = 130;
const PAD_LEFT  = 60;
const PAD_RIGHT = 60;
const Y_AXIS    = 80;             // baseline of the number line
const TICK_MAJ  = 7;              // major tick half-height
const TICK_MIN  = 4;              // minor tick half-height

export function renderNumberLine(spec) {
  validate(spec);
  const [start, end] = spec.range;
  const step      = spec.step;
  const minorStep = spec.minor_step;
  const marks     = spec.marks || [];
  const title     = spec.title || '';

  const plotW = VB_W - PAD_LEFT - PAD_RIGHT;
  const xToPx = v => PAD_LEFT + ((v - start) / (end - start)) * plotW;

  // ── major ticks + axis labels ──
  const majorTicks  = [];
  const majorLabels = [];
  for (let v = start; v <= end + 1e-9; v += step) {
    const x = xToPx(v);
    majorTicks.push(`<line class="nl-tick-major" x1="${x.toFixed(1)}" y1="${Y_AXIS - TICK_MAJ}" x2="${x.toFixed(1)}" y2="${Y_AXIS + TICK_MAJ}"/>`);
    majorLabels.push(`<text class="nl-tick-label" x="${x.toFixed(1)}" y="${Y_AXIS + TICK_MAJ + 14}" text-anchor="middle">${formatTick(v)}</text>`);
  }

  // ── minor ticks (optional) ──
  const minorTicks = [];
  if (minorStep && minorStep > 0 && minorStep < step) {
    for (let v = start; v <= end + 1e-9; v += minorStep) {
      // Skip positions already covered by a major tick
      const onMajor = Math.abs(((v - start) / step) - Math.round((v - start) / step)) < 1e-9;
      if (onMajor) continue;
      const x = xToPx(v);
      minorTicks.push(`<line class="nl-tick-minor" x1="${x.toFixed(1)}" y1="${Y_AXIS - TICK_MIN}" x2="${x.toFixed(1)}" y2="${Y_AXIS + TICK_MIN}"/>`);
    }
  }

  // ── marks (highlighted dots) + their letter labels ──
  const markEls = [];
  marks.forEach((m) => {
    const x = xToPx(m.value);
    markEls.push(`<circle class="nl-mark" cx="${x.toFixed(1)}" cy="${Y_AXIS}" r="4.5"/>`);
    if (m.label) {
      markEls.push(`<text class="nl-mark-label" x="${x.toFixed(1)}" y="${Y_AXIS - 14}" text-anchor="middle">${escape(m.label)}</text>`);
    }
  });

  // ── axis line + arrow heads on both ends ──
  const axisLine = `<line class="nl-axis" x1="${PAD_LEFT - 10}" y1="${Y_AXIS}" x2="${VB_W - PAD_RIGHT + 10}" y2="${Y_AXIS}" marker-start="url(#nl-arrow-l)" marker-end="url(#nl-arrow-r)"/>`;

  const titleEl = title
    ? `<text class="nl-title" x="${VB_W / 2}" y="26" text-anchor="middle">${escape(title)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="xMidYMid meet">
  <defs>
    <marker id="nl-arrow-l" markerWidth="10" markerHeight="10" refX="2" refY="5" orient="auto">
      <path d="M10,0 L0,5 L10,10 z" fill="${INK}"/>
    </marker>
    <marker id="nl-arrow-r" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="${INK}"/>
    </marker>
  </defs>
  <style>
    .nl-axis        { stroke: ${INK};    stroke-width: 1.0; }
    .nl-tick-major  { stroke: ${INK};    stroke-width: 0.9; }
    .nl-tick-minor  { stroke: ${RULE};   stroke-width: 0.6; }
    .nl-tick-label  { font-family: Inter, sans-serif; font-size: 11px; fill: ${INK_SOFT}; }
    .nl-mark        { fill: ${BRAND}; }
    .nl-mark-label  { font-family: Inter, sans-serif; font-size: 14px; font-weight: 700; fill: ${BRAND}; }
    .nl-title       { font-family: Inter, sans-serif; font-size: 12px; font-weight: 600; fill: ${INK}; }
  </style>
  ${titleEl}
  ${minorTicks.join('\n  ')}
  ${majorTicks.join('\n  ')}
  ${axisLine}
  ${majorLabels.join('\n  ')}
  ${markEls.join('\n  ')}
</svg>`;
}

function validate(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('number_line: spec must be an object');
  if (!Array.isArray(spec.range) || spec.range.length !== 2) {
    throw new Error('number_line: range must be [start, end]');
  }
  const [start, end] = spec.range;
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error('number_line: range values must be finite numbers');
  }
  if (start >= end) throw new Error('number_line: range start must be less than end');
  if (typeof spec.step !== 'number' || spec.step <= 0) throw new Error('number_line: step must be > 0');
  const span = end - start;
  if (spec.step > span) throw new Error('number_line: step is larger than the range');
  // Cap tick count so the line stays legible
  const tickCount = Math.floor(span / spec.step) + 1;
  if (tickCount > 25) throw new Error(`number_line: too many ticks (${tickCount}); reduce range or increase step`);
  if (spec.minor_step !== undefined) {
    if (typeof spec.minor_step !== 'number' || spec.minor_step <= 0) {
      throw new Error('number_line: minor_step must be > 0 when provided');
    }
    if (spec.minor_step >= spec.step) throw new Error('number_line: minor_step must be smaller than step');
  }
  if (spec.marks !== undefined) {
    if (!Array.isArray(spec.marks)) throw new Error('number_line: marks must be an array');
    if (spec.marks.length > 10) throw new Error('number_line: at most 10 marks');
    for (const m of spec.marks) {
      if (typeof m.value !== 'number' || !Number.isFinite(m.value)) throw new Error('number_line: each mark needs a finite value');
      if (m.value < start || m.value > end) throw new Error(`number_line: mark value ${m.value} is outside the range`);
      if (m.label !== undefined && (typeof m.label !== 'string' || m.label.length > 8)) {
        throw new Error('number_line: mark label must be a string of ≤ 8 characters');
      }
    }
  }
}

function formatTick(v) {
  // Use a thin space for thousands separators so 1 000 renders correctly
  // in CAPS papers (SA convention) without confusing resvg's text layout.
  if (Number.isInteger(v) && Math.abs(v) >= 1000) {
    return Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace(/^/, v < 0 ? '-' : '');
  }
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
}

function escape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
