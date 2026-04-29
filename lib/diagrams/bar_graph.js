// Bar graph renderer: (spec) → SVG string.
//
// Spec shape:
//   { title:     string,
//     x_label:   string,
//     y_label:   string,
//     bars:      [{ label: string, value: number }, ...]   // 2..10 bars
//     y_max:     number?    optional ceiling; auto if absent
//     y_step:    number?    gridline step; auto if absent
//   }
//
// Visual style matches mockups/diagrams/* — restrained CAPS-textbook look,
// brand-green bars, serif value labels, sans-serif axis ticks.

const BRAND      = '#085041';
const INK        = '#1a1a1a';
const INK_SOFT   = '#4a4a4a';
const RULE       = '#c8c8c8';

const VB_W = 700;
const VB_H = 320;
const PAD_LEFT   = 80;
const PAD_RIGHT  = 40;
const PAD_TOP    = 40;
const PAD_BOTTOM = 50;

export function renderBarGraph(spec) {
  validate(spec);
  const { x_label = '', y_label = '', bars } = spec;

  const yMax  = spec.y_max  ?? niceCeil(Math.max(...bars.map(b => b.value)));
  const yStep = spec.y_step ?? niceStep(yMax);

  const plotW = VB_W - PAD_LEFT - PAD_RIGHT;
  const plotH = VB_H - PAD_TOP - PAD_BOTTOM;
  const yToPx = v => (VB_H - PAD_BOTTOM) - (v / yMax) * plotH;

  const n = bars.length;
  const slot = plotW / n;
  const barW = Math.min(60, slot * 0.55);

  // ── gridlines + y-axis tick labels ──
  const gridLines = [];
  const yTicks    = [];
  for (let v = 0; v <= yMax + 1e-9; v += yStep) {
    const y = yToPx(v);
    gridLines.push(
      `<line class="bg-grid" x1="${PAD_LEFT}" y1="${y.toFixed(1)}" x2="${VB_W - PAD_RIGHT}" y2="${y.toFixed(1)}"/>`
    );
    yTicks.push(
      `<text class="bg-tick" x="${PAD_LEFT - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end">${formatTick(v)}</text>`
    );
  }

  // ── bars + value labels + category labels ──
  const barEls = [];
  bars.forEach((b, i) => {
    const cx = PAD_LEFT + slot * i + slot / 2;
    const x  = cx - barW / 2;
    const y  = yToPx(b.value);
    const h  = (VB_H - PAD_BOTTOM) - y;
    barEls.push(
      `<rect class="bg-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}"/>`,
      `<text class="bg-value" x="${cx.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle">${escape(String(b.value))}</text>`,
      `<text class="bg-cat"   x="${cx.toFixed(1)}" y="${(VB_H - PAD_BOTTOM + 17).toFixed(1)}" text-anchor="middle">${escape(b.label)}</text>`,
    );
  });

  // ── axes + axis labels ──
  const axes = [
    `<line class="bg-axis" x1="${PAD_LEFT}" y1="${PAD_TOP}" x2="${PAD_LEFT}" y2="${VB_H - PAD_BOTTOM}"/>`,
    `<line class="bg-axis" x1="${PAD_LEFT}" y1="${VB_H - PAD_BOTTOM}" x2="${VB_W - PAD_RIGHT}" y2="${VB_H - PAD_BOTTOM}"/>`,
  ];
  const axisLabels = [
    `<text class="bg-axislab" transform="translate(28,${(VB_H/2).toFixed(0)}) rotate(-90)" text-anchor="middle">${escape(y_label)}</text>`,
    `<text class="bg-axislab" x="${(VB_W/2).toFixed(0)}" y="${VB_H - 10}" text-anchor="middle">${escape(x_label)}</text>`,
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="xMidYMid meet">
  <style>
    .bg-axis    { stroke: ${INK};      stroke-width: 0.7; fill: none; }
    .bg-grid    { stroke: ${RULE};     stroke-width: 0.3; stroke-dasharray: 2 2; }
    .bg-tick    { font-family: Inter, sans-serif; font-size: 11px; fill: ${INK_SOFT}; }
    .bg-bar     { fill: ${BRAND}; fill-opacity: 0.85; }
    .bg-cat     { font-family: Inter, sans-serif; font-size: 12px; fill: ${INK}; }
    .bg-axislab { font-family: Inter, sans-serif; font-size: 12px; fill: ${INK_SOFT}; font-style: italic; }
    .bg-value   { font-family: 'Source Serif 4', Cambria, Georgia, serif; font-size: 12px; font-weight: 600; fill: ${INK}; }
  </style>
  ${gridLines.join('\n  ')}
  ${axes.join('\n  ')}
  ${yTicks.join('\n  ')}
  ${barEls.join('\n  ')}
  ${axisLabels.join('\n  ')}
</svg>`;
}

function validate(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('bar_graph: spec must be an object');
  if (!Array.isArray(spec.bars) || spec.bars.length < 2 || spec.bars.length > 10) {
    throw new Error('bar_graph: bars must be an array of 2–10 entries');
  }
  for (const b of spec.bars) {
    if (typeof b.label !== 'string' || !b.label.trim()) throw new Error('bar_graph: each bar needs a non-empty label');
    if (typeof b.value !== 'number' || !Number.isFinite(b.value) || b.value < 0) {
      throw new Error('bar_graph: each bar value must be a finite non-negative number');
    }
  }
}

function niceCeil(maxValue) {
  if (maxValue <= 0) return 1;
  const mag  = Math.pow(10, Math.floor(Math.log10(maxValue)));
  const norm = maxValue / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

function niceStep(yMax) {
  // Aim for ~5–6 gridline steps.
  const target = yMax / 5;
  const mag    = Math.pow(10, Math.floor(Math.log10(target)));
  const norm   = target / mag;
  const nice   = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return nice * mag;
}

function formatTick(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function escape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
