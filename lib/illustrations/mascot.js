// Lesson mascot — Phase C v1.
//
// A friendly geometric "blob" character built from circles and rounded
// rectangles. Junior-band lessons (Gr 4–5) get the mascot on the
// worksheet cover and PPTX title slide; senior-band (Gr 6–7) skip it.
//
// This is deliberately a simple original design — it's a placeholder
// for a Phase C v2 commissioned mascot. The shape language matches the
// rounded geometry of the kid-mode chrome so it doesn't feel grafted on.

function svgWrap(inner, viewBox = '0 0 100 130') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${inner}</svg>`;
}

/**
 * Render the waving-mascot SVG.
 *
 *   { accent: '#F4B942' }  → blob coloured F4B942, raised arm waving
 *
 * The mascot is intentionally small in vertical content — it sits next
 * to a headline on a slide / cover, not centred on its own.
 */
export function mascotWavingSvg({ accent }) {
  const colour = accent || '#F4B942';
  return svgWrap(`
    <!-- Body — friendly egg shape with belly highlight -->
    <ellipse cx="50" cy="72" rx="34" ry="44" fill="${colour}"/>
    <ellipse cx="50" cy="84" rx="22" ry="22" fill="white" opacity="0.18"/>

    <!-- Eyes -->
    <circle cx="38" cy="58" r="5" fill="white"/>
    <circle cx="62" cy="58" r="5" fill="white"/>
    <circle cx="38" cy="58" r="2.4" fill="#1A1A18"/>
    <circle cx="62" cy="58" r="2.4" fill="#1A1A18"/>
    <circle cx="39" cy="56.5" r="0.9" fill="white"/>
    <circle cx="63" cy="56.5" r="0.9" fill="white"/>

    <!-- Cheeks (soft blush) -->
    <circle cx="28" cy="70" r="3.4" fill="#FB7185" opacity="0.55"/>
    <circle cx="72" cy="70" r="3.4" fill="#FB7185" opacity="0.55"/>

    <!-- Smile -->
    <path d="M40 76 Q50 87, 60 76" fill="none" stroke="#1A1A18" stroke-width="2.6" stroke-linecap="round"/>

    <!-- Standing arm (left, hanging) -->
    <ellipse cx="18" cy="78" rx="6" ry="14" fill="${colour}"/>

    <!-- Waving arm (right, raised) -->
    <g transform="rotate(28 80 50)">
      <ellipse cx="80" cy="50" rx="6" ry="16" fill="${colour}"/>
      <circle cx="80" cy="34" r="7" fill="${colour}"/>
    </g>

    <!-- Tiny "hello" sparkle dots near the wave -->
    <circle cx="92" cy="22" r="2" fill="${colour}" opacity="0.7"/>
    <circle cx="86" cy="14" r="1.6" fill="${colour}" opacity="0.5"/>
  `);
}
