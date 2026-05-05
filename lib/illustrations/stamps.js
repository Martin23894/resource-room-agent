// "Well done!" stamp art — Phase C v1.
//
// Renders a celebratory stamp SVG to drop on the PPTX celebrate slide
// and the DOCX memo header (junior band only — senior keeps the cleaner
// memo layout). The stamp is built from circles + simple paths; localised
// per language.

const MAIN_LINES = {
  English:   { primary: 'WELL DONE!',    secondary: 'You did it' },
  Afrikaans: { primary: 'MOOI GEDOEN!',  secondary: 'Jy het dit' },
};

function svgWrap(inner, viewBox = '0 0 200 200') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${inner}</svg>`;
}

/**
 * Render a "Well done!" stamp SVG for the given language and accent.
 *
 *   { language: 'English',   accent: '#F4B942' }  → "WELL DONE!" / "You did it"
 *   { language: 'Afrikaans', accent: '#A8E6CF' }  → "MOOI GEDOEN!" / "Jy het dit"
 */
export function wellDoneStampSvg({ language, accent }) {
  const colour = accent || '#F4B942';
  const lines = MAIN_LINES[language] || MAIN_LINES.English;

  // Decorative starbursts — small "+" shapes around the inner ring.
  const burstAngles = [-110, -55, -20, 20, 55, 110, 200, 250];
  const bursts = burstAngles.map((deg) => {
    const rad = (deg * Math.PI) / 180;
    const cx = 100 + Math.cos(rad) * 86;
    const cy = 100 + Math.sin(rad) * 86;
    return `
      <line x1="${(cx - 4).toFixed(2)}" y1="${cy.toFixed(2)}" x2="${(cx + 4).toFixed(2)}" y2="${cy.toFixed(2)}" stroke="${colour}" stroke-width="2" stroke-linecap="round"/>
      <line x1="${cx.toFixed(2)}" y1="${(cy - 4).toFixed(2)}" x2="${cx.toFixed(2)}" y2="${(cy + 4).toFixed(2)}" stroke="${colour}" stroke-width="2" stroke-linecap="round"/>
    `;
  }).join('');

  return svgWrap(`
    ${bursts}
    <!-- Outer dotted ring -->
    <circle cx="100" cy="100" r="78" fill="none" stroke="${colour}" stroke-width="3" stroke-dasharray="6 5"/>
    <!-- Inner solid disc -->
    <circle cx="100" cy="100" r="64" fill="${colour}"/>
    <!-- Inner border ring -->
    <circle cx="100" cy="100" r="58" fill="none" stroke="white" stroke-width="2"/>
    <!-- Primary line (large) -->
    <text x="100" y="98" text-anchor="middle"
          font-family="Inter" font-size="22" font-weight="bold" fill="white"
          letter-spacing="1">${lines.primary}</text>
    <!-- Secondary line (small) -->
    <text x="100" y="122" text-anchor="middle"
          font-family="Inter" font-size="14" fill="white"
          opacity="0.95">${lines.secondary}</text>
  `);
}
