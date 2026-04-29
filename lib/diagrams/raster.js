// SVG → PNG rasteriser for DOCX embedding.
//
// Word renders inline SVG only on Office 365+. Older Word installations
// (still common in SA schools) need a raster fallback. We rasterise once
// at render time and embed the PNG via docx ImageRun. The original SVG is
// kept for the browser preview path.
//
// resvg-js is a pure-JS port of resvg (no system libvips/cairo needed),
// which keeps the Railway image small. Output is a Buffer of PNG bytes.
//
// FONTS — we ship Inter (sans) and Source Serif 4 (serif) as TTFs in
// /fonts so the rasteriser is deterministic across hosts. Railway's slim
// Node container has no fonts installed, which causes resvg to silently
// skip text rendering when relying on system fonts. resvg-js for Node
// only loads TTF/OTF (not WOFF2), so we vendor the actual TTF files.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const FONT_DIR   = path.resolve(__dirname, '..', '..', 'fonts');

const FONT_FILES = [
  path.join(FONT_DIR, 'Inter-Regular.ttf'),
  path.join(FONT_DIR, 'Inter-SemiBold.ttf'),
  path.join(FONT_DIR, 'Inter-Bold.ttf'),
  path.join(FONT_DIR, 'Inter-Italic.ttf'),
  path.join(FONT_DIR, 'SourceSerif4-Regular.ttf'),
  path.join(FONT_DIR, 'SourceSerif4-Semibold.ttf'),
  path.join(FONT_DIR, 'SourceSerif4-Bold.ttf'),
  path.join(FONT_DIR, 'SourceSerif4-It.ttf'),
];

export function rasterSvgToPng(svg, { widthPx = 1400 } = {}) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: widthPx },
    background: 'rgba(255,255,255,0)',
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,    // deterministic — only use the fonts we ship
      defaultFontFamily: 'Inter',
      sansSerifFamily: 'Inter',
      serifFamily: 'Source Serif 4',
    },
  });
  return resvg.render().asPng();
}
