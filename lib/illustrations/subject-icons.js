// Per-subject illustration SVGs — Phase C v1.
//
// Each icon is a hand-rolled SVG (100×100 viewBox) built from simple
// primitives (rect, circle, path) so we own the art end-to-end and don't
// drag in third-party licensing. Designs are deliberately simple — they
// read at any size, share a single accent colour, and pair well with the
// rounded geometry of the Lesson kid-mode chrome.
//
// Phase C v2 (later, post-validation) is when we'd commission a polished
// custom mascot + a coordinated subject-icon set. For now, these are
// good enough to drop the icon-shaped placeholder in the PPTX yourTurn
// slide and the worksheet cover hero.

function svgWrap(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`;
}

function calculatorIcon(color) {
  return svgWrap(`
    <rect x="20" y="14" width="60" height="72" rx="8" fill="${color}"/>
    <rect x="28" y="22" width="44" height="14" rx="3" fill="white"/>
    <text x="68" y="33" text-anchor="end" font-family="Inter" font-size="11" font-weight="bold" fill="${color}">123</text>
    <circle cx="34" cy="50" r="4" fill="white"/>
    <circle cx="50" cy="50" r="4" fill="white"/>
    <circle cx="66" cy="50" r="4" fill="white"/>
    <circle cx="34" cy="64" r="4" fill="white"/>
    <circle cx="50" cy="64" r="4" fill="white"/>
    <circle cx="66" cy="64" r="4" fill="white"/>
    <rect x="30" y="74" width="40" height="6" rx="3" fill="white"/>
  `);
}

function bookIcon(color) {
  return svgWrap(`
    <path d="M50 28 Q34 22, 18 24 L18 78 Q34 76, 50 80 Q66 76, 82 78 L82 24 Q66 22, 50 28 Z" fill="${color}"/>
    <line x1="50" y1="28" x2="50" y2="80" stroke="white" stroke-width="2.5"/>
    <line x1="26" y1="38" x2="44" y2="36" stroke="white" stroke-width="2" stroke-linecap="round"/>
    <line x1="26" y1="46" x2="44" y2="44" stroke="white" stroke-width="2" stroke-linecap="round"/>
    <line x1="26" y1="54" x2="40" y2="52" stroke="white" stroke-width="2" stroke-linecap="round"/>
    <line x1="56" y1="36" x2="74" y2="38" stroke="white" stroke-width="2" stroke-linecap="round"/>
    <line x1="56" y1="44" x2="74" y2="46" stroke="white" stroke-width="2" stroke-linecap="round"/>
    <line x1="56" y1="52" x2="70" y2="54" stroke="white" stroke-width="2" stroke-linecap="round"/>
  `);
}

function flaskIcon(color) {
  return svgWrap(`
    <rect x="36" y="14" width="28" height="6" rx="2" fill="${color}"/>
    <path d="M40 20 L40 44 L24 78 Q22 86, 32 86 L68 86 Q78 86, 76 78 L60 44 L60 20 Z" fill="${color}"/>
    <circle cx="40" cy="68" r="4" fill="white"/>
    <circle cx="56" cy="74" r="3" fill="white"/>
    <circle cx="48" cy="78" r="2.5" fill="white"/>
    <line x1="40" y1="20" x2="60" y2="20" stroke="white" stroke-width="1.5"/>
  `);
}

function globeIcon(color) {
  return svgWrap(`
    <circle cx="50" cy="50" r="34" fill="${color}"/>
    <ellipse cx="50" cy="50" rx="34" ry="15" fill="none" stroke="white" stroke-width="2"/>
    <ellipse cx="50" cy="50" rx="15" ry="34" fill="none" stroke="white" stroke-width="2"/>
    <line x1="16" y1="50" x2="84" y2="50" stroke="white" stroke-width="2"/>
    <line x1="50" y1="16" x2="50" y2="84" stroke="white" stroke-width="2"/>
  `);
}

function scrollIcon(color) {
  return svgWrap(`
    <rect x="20" y="22" width="60" height="6" rx="3" fill="${color}"/>
    <rect x="20" y="26" width="60" height="48" fill="${color}"/>
    <rect x="20" y="72" width="60" height="6" rx="3" fill="${color}"/>
    <line x1="30" y1="40" x2="70" y2="40" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="30" y1="50" x2="70" y2="50" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="30" y1="60" x2="58" y2="60" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
  `);
}

function heartIcon(color) {
  return svgWrap(`
    <path d="M50 82 L26 58 Q16 48, 26 36 Q36 26, 50 42 Q64 26, 74 36 Q84 48, 74 58 Z" fill="${color}"/>
  `);
}

function compassIcon(color) {
  return svgWrap(`
    <circle cx="50" cy="50" r="34" fill="${color}"/>
    <path d="M50 20 L56 50 L80 50 L56 56 L50 80 L44 56 L20 50 L44 50 Z" fill="white"/>
    <circle cx="50" cy="50" r="5" fill="${color}"/>
  `);
}

function coinsIcon(color) {
  return svgWrap(`
    <ellipse cx="50" cy="76" rx="28" ry="8" fill="${color}"/>
    <rect x="22" y="62" width="56" height="14" fill="${color}"/>
    <ellipse cx="50" cy="62" rx="28" ry="8" fill="${color}" stroke="white" stroke-width="1.5"/>
    <ellipse cx="50" cy="48" rx="24" ry="7" fill="${color}" stroke="white" stroke-width="1.5"/>
    <ellipse cx="50" cy="36" rx="20" ry="6" fill="${color}" stroke="white" stroke-width="1.5"/>
    <text x="50" y="52" text-anchor="middle" font-family="Inter" font-size="10" font-weight="bold" fill="white">R</text>
  `);
}

function gearIcon(color) {
  // Eight-tooth gear: a circle with eight square teeth around it.
  const teeth = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const tx = 50 + Math.cos(angle) * 36 - 5;
    const ty = 50 + Math.sin(angle) * 36 - 5;
    const rotDeg = (i * 45) % 360;
    teeth.push(
      `<rect x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" width="10" height="10" fill="${color}" transform="rotate(${rotDeg} ${(tx + 5).toFixed(2)} ${(ty + 5).toFixed(2)})"/>`,
    );
  }
  return svgWrap(`
    ${teeth.join('\n')}
    <circle cx="50" cy="50" r="28" fill="${color}"/>
    <circle cx="50" cy="50" r="14" fill="white"/>
    <circle cx="50" cy="50" r="6" fill="${color}"/>
  `);
}

function pencilIcon(color) {
  // Default fallback — a friendly pencil.
  return svgWrap(`
    <path d="M22 78 L34 90 L82 42 L70 30 Z" fill="${color}"/>
    <path d="M82 42 L92 32 L80 20 L70 30 Z" fill="${color}"/>
    <path d="M68 32 L70 30 L82 42 L80 44 Z" fill="white"/>
    <path d="M22 78 L18 92 L34 90 Z" fill="white" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>
  `);
}

// Subject → icon function. Keys match canonical English subject names from
// data/atp.json. Sub-strings are checked too so e.g. "Social Sciences —
// History" finds the History icon and "Life Skills — Creative Arts" finds
// the heart-style icon. Fallback is the pencil.
const ICON_MAP = [
  { match: /Mathematics/i,                 fn: calculatorIcon, name: 'calculator' },
  { match: /Natural Sciences|Technology/i, fn: flaskIcon,      name: 'flask' },
  { match: /History/i,                     fn: scrollIcon,     name: 'scroll' },
  { match: /Geography/i,                   fn: globeIcon,      name: 'globe' },
  { match: /Home Language|Additional Language|English|Afrikaans/i, fn: bookIcon, name: 'book' },
  { match: /Life Skills|Life Orientation/i, fn: heartIcon,     name: 'heart' },
  { match: /Economic|Management/i,         fn: coinsIcon,      name: 'coins' },
];

/** Return { svg, name } for a subject. Falls back to the pencil for
 *  subjects not yet mapped. The picker is purely a function of the
 *  subject string — same input → same output. */
export function pickSubjectIcon(subject, color) {
  const s = String(subject || '');
  for (const entry of ICON_MAP) {
    if (entry.match.test(s)) return { svg: entry.fn(color), name: entry.name };
  }
  return { svg: pencilIcon(color), name: 'pencil' };
}

// Re-exported for tests so they can assert icon-name determinism.
export const __internals = {
  calculatorIcon, bookIcon, flaskIcon, globeIcon, scrollIcon, heartIcon,
  compassIcon, coinsIcon, gearIcon, pencilIcon,
  ICON_MAP,
};
