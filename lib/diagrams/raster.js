// SVG → PNG rasteriser for DOCX embedding.
//
// Word renders inline SVG only on Office 365+. Older Word installations
// (still common in SA schools) need a raster fallback. We rasterise once
// at render time and embed the PNG via docx ImageRun. The original SVG is
// kept for the browser preview path.
//
// resvg-js is a pure-JS port of resvg (no system libvips/cairo needed),
// which keeps the Railway image small. Output is a Buffer of PNG bytes.

import { Resvg } from '@resvg/resvg-js';

export function rasterSvgToPng(svg, { widthPx = 1400 } = {}) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: widthPx },
    background: 'rgba(255,255,255,0)',
    font: { loadSystemFonts: true, defaultFontFamily: 'Source Serif 4' },
  });
  return resvg.render().asPng();
}
