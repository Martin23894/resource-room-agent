// Food-chain renderer: (spec) → SVG string.
//
// Spec shape:
//   { type:      'food_chain',
//     title:     string?,                     // optional caption
//     organisms: [string, string, ...]        // 2..6 entries, left → right
//   }
//
// When an organism name matches a hand-coded silhouette in
// lib/diagrams/silhouettes.js, the silhouette is drawn above the name.
// Names without a matching silhouette fall back to text-only boxes — the
// renderer never breaks on missing assets.

import { lookupSilhouette } from './silhouettes.js';
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
const VB_H = 230;
const PAD_LEFT  = 20;
const PAD_RIGHT = 20;
const ARROW_W   = 32;          // gap between boxes (arrow length)
const BOX_H     = 130;         // tall enough for silhouette + name
const TITLE_Y   = 30;
const BOX_Y     = 60;
const SIL_AREA  = 80;          // top portion of the box reserved for the silhouette

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
    const silhouette = lookupSilhouette(organisms[i]);
    // Drop shadow first so it sits behind the box.
    boxes.push(
      `<rect class="fc-shadow" x="${(x + 1.5).toFixed(1)}" y="${BOX_Y + 2}" width="${boxW.toFixed(1)}" height="${BOX_H}" rx="6"/>`,
      `<rect class="fc-box"    x="${x.toFixed(1)}"        y="${BOX_Y}"     width="${boxW.toFixed(1)}" height="${BOX_H}" rx="6"/>`,
    );
    if (silhouette) {
      // Place silhouette in the top portion of the box. The silhouette
      // viewBox is 100x60; we scale it into a square area for visibility.
      const silSize = Math.min(SIL_AREA - 14, boxW - 16);
      const silX = x + (boxW - silSize) / 2;
      const silY = BOX_Y + 10;
      boxes.push(
        `<svg class="fc-sil" x="${silX.toFixed(1)}" y="${silY}" width="${silSize}" height="${silSize * 0.6}" viewBox="0 0 100 60" fill="currentColor">${silhouette}</svg>`,
      );
    }
    // Name sits below the silhouette (or centred if no silhouette).
    const nameY = silhouette
      ? BOX_Y + SIL_AREA + 22
      : BOX_Y + BOX_H / 2 + 5;
    boxes.push(
      `<text class="fc-name" x="${(x + boxW / 2).toFixed(1)}" y="${nameY.toFixed(1)}" text-anchor="middle" font-size="${fontSize}">${escape(organisms[i])}</text>`,
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
    .fc-shadow { fill: rgba(0,0,0,0.10); }
    .fc-box    { fill: ${PAPER_WARM}; stroke: ${RULE}; stroke-width: 0.8; }
    .fc-sil    { color: ${BRAND}; }
    .fc-name   { font-family: 'Source Serif 4', Cambria, Georgia, serif; fill: ${INK}; font-weight: 600; }
    .fc-arrow  { stroke: ${INK_SOFT}; stroke-width: 1.5; }
    .fc-title  { font-family: Inter, sans-serif; font-size: 13px; font-weight: 600; fill: ${BRAND}; }
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
