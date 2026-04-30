// Food-chain renderer: (spec) → SVG string.
//
// Spec shape:
//   { type:      'food_chain',
//     title:     string?,                     // optional caption
//     organisms: [string, string, ...]        // 2..6 entries, left → right
//   }
//
// Visual: a horizontal sequence of named organism boxes connected by
// right-pointing arrows. Arrows point in the direction of energy flow
// (the convention CAPS teaches): "Grass → Grasshopper" means grass is
// eaten by the grasshopper. The renderer enforces this convention; the
// model just supplies the order from producer to apex predator.
//
// Per rule 5b, organism names ARE the labels — questions test knowledge
// of trophic roles ("which is a producer?") not the organism names.
// Don't ask "name the second organism" with this diagram, the names are
// visible. (A future variant may support anonymous A-B-C-D-E mode.)

const BRAND      = '#085041';
const INK        = '#1a1a1a';
const INK_SOFT   = '#4a4a4a';
const RULE       = '#c8c8c8';
const PAPER_WARM = '#fbf8f1';

const VB_W = 700;
const VB_H = 180;
const PAD_LEFT  = 20;
const PAD_RIGHT = 20;
const ARROW_W   = 32;          // gap between boxes (arrow length)
const BOX_H     = 64;
const TITLE_Y   = 30;
const BOX_Y     = 70;

export function renderFoodChain(spec) {
  validate(spec);
  const { title = '', organisms } = spec;
  const n = organisms.length;

  const totalArrowSpace = (n - 1) * ARROW_W;
  const usableWidth     = VB_W - PAD_LEFT - PAD_RIGHT - totalArrowSpace;
  const boxW            = usableWidth / n;

  // Font size scales down for longer names so they don't overflow the
  // box. 14px fits ~10 chars at boxW=120; below that we tighten.
  const longest = organisms.reduce((m, o) => Math.max(m, o.length), 0);
  const fontSize = longest <= 10 ? 14 : longest <= 14 ? 12 : longest <= 18 ? 11 : 10;

  const boxes  = [];
  const arrows = [];
  for (let i = 0; i < n; i++) {
    const x = PAD_LEFT + i * (boxW + ARROW_W);
    boxes.push(
      `<rect class="fc-box" x="${x.toFixed(1)}" y="${BOX_Y}" width="${boxW.toFixed(1)}" height="${BOX_H}" rx="4"/>`,
      `<text class="fc-name" x="${(x + boxW / 2).toFixed(1)}" y="${BOX_Y + BOX_H / 2 + 5}" text-anchor="middle" font-size="${fontSize}">${escape(organisms[i])}</text>`,
    );
    if (i < n - 1) {
      const ax1 = x + boxW + 2;
      const ax2 = x + boxW + ARROW_W - 4;
      const ay  = BOX_Y + BOX_H / 2;
      arrows.push(
        `<line class="fc-arrow" x1="${ax1.toFixed(1)}" y1="${ay}" x2="${ax2.toFixed(1)}" y2="${ay}" marker-end="url(#fc-head)"/>`,
      );
    }
  }

  const titleEl = title
    ? `<text class="fc-title" x="${VB_W / 2}" y="${TITLE_Y}" text-anchor="middle">${escape(title)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="xMidYMid meet">
  <defs>
    <marker id="fc-head" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="${INK}"/>
    </marker>
  </defs>
  <style>
    .fc-box   { fill: ${PAPER_WARM}; stroke: ${INK}; stroke-width: 1.0; }
    .fc-name  { font-family: 'Source Serif 4', Cambria, Georgia, serif; fill: ${INK}; font-weight: 600; }
    .fc-arrow { stroke: ${INK}; stroke-width: 1.5; }
    .fc-title { font-family: Inter, sans-serif; font-size: 13px; font-weight: 600; fill: ${BRAND}; }
  </style>
  ${titleEl}
  ${boxes.join('\n  ')}
  ${arrows.join('\n  ')}
</svg>`;
}

function validate(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('food_chain: spec must be an object');
  if (!Array.isArray(spec.organisms)) throw new Error('food_chain: organisms must be an array');
  const n = spec.organisms.length;
  if (n < 2 || n > 6) throw new Error('food_chain: organisms must have 2–6 entries');
  for (const o of spec.organisms) {
    if (typeof o !== 'string' || !o.trim()) throw new Error('food_chain: each organism must be a non-empty string');
    if (o.length > 30) throw new Error(`food_chain: organism name "${o}" too long (max 30 chars)`);
  }
}

function escape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
