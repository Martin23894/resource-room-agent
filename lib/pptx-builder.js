// PowerPoint renderer for a Lesson Resource.
//
// Pure function over a validated Resource — same input as lib/render.js's
// DOCX renderer. Walks `resource.lesson.slides[]` in ordinal order and
// emits one slide per entry, applying a layout-specific template.
//
// The visual language is deliberately warm and kid-facing (Phase A of the
// Lesson playful-redesign). It uses lib/palette.js to pick a per-grade-
// band style:
//
//   • Junior (Gr 4–5) — brighter accent rotation, more rounded corners,
//     friendlier display font, small subject motif moments
//   • Senior (Gr 6–7) — same warm palette, cleaner geometry, less
//     aggressive corner rounding
//
// Diagram slides reuse the existing SVG → PNG raster path so a bar graph
// taught on a slide is rendered identically to the same stimulus on the
// worksheet.
//
// pptxgenjs is pure JS (no native deps), which keeps the Railway image
// small. Output is a base64 string — the API endpoint streams it back to
// the browser as a downloadable .pptx.

import pptxgen from 'pptxgenjs';

import { renderDiagram } from './diagrams/index.js';
import { rasterSvgToPng } from './diagrams/raster.js';
import { pickLessonStyle, nthAccent } from './palette.js';

// ─────────────────────────────────────────────────────────────────
// FONT CHAIN
// ─────────────────────────────────────────────────────────────────
// pptxgenjs writes fontFace into the slide XML; the PowerPoint viewer
// resolves the font at view-time from the local machine. We can't bundle
// Fredoka into the .pptx safely (pptxgenjs has weak font-embedding), so
// we declare a fallback chain — Fredoka first for warmth, Nunito as a
// fallback (very common on macOS / Office 365), Calibri as the universal
// floor (ships with every PowerPoint installation).
const FONT_HEAD = 'Fredoka, Nunito, Calibri';
const FONT_BODY = 'Calibri';

// Standard widescreen layout — 13.33 × 7.5 inches.
const SLIDE_W = 13.33;
const SLIDE_H = 7.5;

// ─────────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────────

/** Top accent bar (rounded on junior band) + footer line. Applied to
 *  every slide so the deck has a consistent visual frame regardless of
 *  which layout the model chose. */
function applyChrome(slide, resource, style) {
  const palette = style.palette;
  const isJunior = style.gradeBand === 'junior';

  // Top accent bar — slightly thicker on junior, with rounded ends.
  slide.addShape(isJunior ? 'roundRect' : 'rect', {
    x: 0, y: 0, w: SLIDE_W, h: isJunior ? 0.42 : 0.32,
    fill: { color: palette.green },
    line: { color: palette.green },
    rectRadius: isJunior ? 0.12 : 0,
  });

  // Footer
  const footer = `${resource.cover.subjectLine}  ·  ${resource.cover.gradeLine}  ${resource.cover.termLine}`;
  slide.addText(footer, {
    x: 0.5, y: SLIDE_H - 0.45, w: SLIDE_W - 1.0, h: 0.35,
    fontFace: FONT_BODY, fontSize: 10, color: palette.grey, align: 'left',
  });
  slide.addText('The Resource Room', {
    x: SLIDE_W - 3.0, y: SLIDE_H - 0.45, w: 2.5, h: 0.35,
    fontFace: FONT_BODY, fontSize: 10, color: palette.grey, align: 'right',
  });
}

function bulletItems(items) {
  return (items || []).map((text) => ({
    text: String(text || ''),
    options: { bullet: { type: 'bullet' } },
  }));
}

// ─────────────────────────────────────────────────────────────────
// LAYOUT RENDERERS
// Each takes (slide, slideData, resource, style). Layout-specific knobs
// (image dimensions, accent rotation) are localised here.
// ─────────────────────────────────────────────────────────────────

function renderTitleSlide(slide, s, resource, style) {
  const palette = style.palette;
  const heroAccent = nthAccent(style, 0);

  // Big tinted background for warmth.
  slide.background = { color: palette.bgTint };

  // Soft "hero card" rounded rectangle behind the title — gives the slide
  // a focal point instead of just floating text on a tint.
  slide.addShape('roundRect', {
    x: 1.2, y: 1.6, w: SLIDE_W - 2.4, h: 4.4,
    fill: { color: 'FFFFFF' },
    line: { color: heroAccent, width: 2 },
    rectRadius: style.cornerRadius,
    shadow: { type: 'outer', color: '999999', opacity: 0.15, blur: 12, offset: 4, angle: 90 },
  });

  // Brand strap-line at top.
  slide.addText('THE RESOURCE ROOM', {
    x: 0.5, y: 0.7, w: SLIDE_W - 1.0, h: 0.4,
    fontFace: FONT_BODY, fontSize: 12, color: palette.green, bold: true,
    charSpacing: 6, align: 'center',
  });

  // Lesson title — big and friendly, in the hero card.
  slide.addText(s.heading || resource.cover.subjectLine, {
    x: 1.5, y: 2.1, w: SLIDE_W - 3.0, h: 1.6,
    fontFace: FONT_HEAD, fontSize: 52, color: palette.ink, bold: true,
    align: 'center', valign: 'middle',
  });

  // Unit topic underneath as the secondary line.
  if (resource.lesson?.capsAnchor?.unitTopic) {
    slide.addText(resource.lesson.capsAnchor.unitTopic, {
      x: 1.5, y: 3.7, w: SLIDE_W - 3.0, h: 0.7,
      fontFace: FONT_BODY, fontSize: 22, color: palette.inkSoft,
      align: 'center', italic: true,
    });
  }

  // Accent strip under the title.
  slide.addShape('roundRect', {
    x: SLIDE_W / 2 - 1.0, y: 4.5, w: 2.0, h: 0.12,
    fill: { color: heroAccent }, line: { color: heroAccent },
    rectRadius: 0.06,
  });

  // Subtitle: grade · term · minutes.
  const subtitle = `${resource.cover.gradeLine}  ·  ${resource.cover.termLine}` +
    (resource.lesson?.lessonMinutes ? `  ·  ${resource.lesson.lessonMinutes} minutes` : '');
  slide.addText(subtitle, {
    x: 1.5, y: 4.8, w: SLIDE_W - 3.0, h: 0.5,
    fontFace: FONT_BODY, fontSize: 16, color: palette.green, bold: true, align: 'center',
  });

  if (Array.isArray(s.bullets) && s.bullets.length) {
    slide.addText(bulletItems(s.bullets), {
      x: 2.0, y: 5.4, w: SLIDE_W - 4.0, h: 0.5,
      fontFace: FONT_BODY, fontSize: 14, color: palette.inkSoft, align: 'left',
    });
  }
}

function renderHeadingBar(slide, heading, style) {
  slide.addText(heading, {
    x: 0.5, y: 0.6, w: SLIDE_W - 1.0, h: 0.7,
    fontFace: FONT_HEAD, fontSize: 30, color: style.palette.green, bold: true,
    align: 'left', valign: 'middle',
  });
  // Underline accent — rounded on junior.
  slide.addShape('roundRect', {
    x: 0.5, y: 1.35, w: 1.5, h: 0.06,
    fill: { color: style.palette.greenBar },
    line: { color: style.palette.greenBar },
    rectRadius: style.gradeBand === 'junior' ? 0.03 : 0,
  });
}

function renderBulletSlide(slide, s, _resource, style) {
  renderHeadingBar(slide, s.heading || '', style);
  const bullets = Array.isArray(s.bullets) ? s.bullets : [];
  if (bullets.length === 0) {
    slide.addText('(No bullets supplied)', {
      x: 0.7, y: 2.0, w: SLIDE_W - 1.4, h: 0.5,
      fontFace: FONT_BODY, fontSize: 16, color: style.palette.grey, italic: true,
    });
    return;
  }
  // Auto-shrink font when many bullets.
  const fontSize = bullets.length <= 4 ? 24 : bullets.length <= 6 ? 20 : 18;
  slide.addText(bulletItems(bullets), {
    x: 0.7, y: 2.0, w: SLIDE_W - 1.4, h: SLIDE_H - 3.0,
    fontFace: FONT_BODY, fontSize, color: style.palette.ink,
    paraSpaceAfter: 6, align: 'left', valign: 'top',
  });
}

function renderObjectivesSlide(slide, s, _resource, style) {
  // "What we'll learn today" — each objective in its own coloured check-card.
  // Replaces the bullet list with something a Grade 4 actually reads.
  renderHeadingBar(slide, s.heading || "Today's goals", style);

  const items = Array.isArray(s.bullets) && s.bullets.length
    ? s.bullets
    : [];
  if (items.length === 0) {
    slide.addText('(No objectives supplied)', {
      x: 0.7, y: 2.0, w: SLIDE_W - 1.4, h: 0.5,
      fontFace: FONT_BODY, fontSize: 16, color: style.palette.grey, italic: true,
    });
    return;
  }

  const startY = 1.9;
  const rowH = Math.min(0.95, (SLIDE_H - 2.6) / items.length);
  const padY = 0.1;

  items.forEach((text, i) => {
    const accent = nthAccent(style, i);
    const y = startY + i * (rowH + padY);

    // Accent-coloured check badge (small rounded square with ✓)
    slide.addShape('roundRect', {
      x: 0.7, y, w: rowH * 0.85, h: rowH * 0.85,
      fill: { color: accent }, line: { color: accent },
      rectRadius: style.cornerRadius * 0.6,
    });
    slide.addText('✓', {
      x: 0.7, y, w: rowH * 0.85, h: rowH * 0.85,
      fontFace: FONT_HEAD, fontSize: 28, color: 'FFFFFF', bold: true,
      align: 'center', valign: 'middle',
    });

    // Tinted card holding the objective text
    const cardX = 0.7 + rowH * 0.85 + 0.2;
    slide.addShape('roundRect', {
      x: cardX, y, w: SLIDE_W - cardX - 0.7, h: rowH * 0.85,
      fill: { color: 'F8F4EE' }, line: { color: 'EAE3D3', width: 0.5 },
      rectRadius: style.cornerRadius * 0.6,
    });
    slide.addText(String(text || ''), {
      x: cardX + 0.2, y, w: SLIDE_W - cardX - 1.1, h: rowH * 0.85,
      fontFace: FONT_BODY, fontSize: items.length <= 4 ? 20 : 18, color: style.palette.ink,
      align: 'left', valign: 'middle',
    });
  });
}

function renderVocabularySlide(slide, s, resource, style) {
  renderHeadingBar(slide, s.heading || 'Key words', style);

  const vocab = Array.isArray(resource.lesson?.vocabulary) ? resource.lesson.vocabulary : [];

  // If the model put bullets here AND there's no structured vocabulary,
  // fall back to the regular bullet renderer.
  if (vocab.length === 0) {
    if (Array.isArray(s.bullets) && s.bullets.length > 0) {
      return renderBulletSlide(slide, s, resource, style);
    }
    return;
  }

  // 2-column grid of term cards. Each card: accent-coloured top band with
  // the term, white body with the definition.
  const cols = 2;
  const rows = Math.ceil(vocab.length / cols);
  const gridX = 0.7;
  const gridY = 1.9;
  const gridW = SLIDE_W - 2 * gridX;
  const gridH = SLIDE_H - gridY - 0.9;
  const cellPadX = 0.15;
  const cellPadY = 0.15;
  const cellW = (gridW - cellPadX * (cols - 1)) / cols;
  const cellH = (gridH - cellPadY * (rows - 1)) / rows;
  const bandH = Math.min(0.55, cellH * 0.4);

  vocab.forEach((v, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = gridX + col * (cellW + cellPadX);
    const y = gridY + row * (cellH + cellPadY);
    const accent = nthAccent(style, i);

    // Card body
    slide.addShape('roundRect', {
      x, y, w: cellW, h: cellH,
      fill: { color: 'FFFFFF' }, line: { color: 'DDDDDD', width: 0.5 },
      rectRadius: style.cornerRadius * 0.5,
    });
    // Coloured term band on top
    slide.addShape('roundRect', {
      x, y, w: cellW, h: bandH,
      fill: { color: accent }, line: { color: accent },
      rectRadius: style.cornerRadius * 0.5,
    });
    slide.addText(String(v.term || ''), {
      x: x + 0.15, y, w: cellW - 0.3, h: bandH,
      fontFace: FONT_HEAD, fontSize: 18, bold: true, color: 'FFFFFF',
      align: 'left', valign: 'middle',
    });
    slide.addText(String(v.definition || ''), {
      x: x + 0.15, y: y + bandH + 0.08, w: cellW - 0.3, h: cellH - bandH - 0.16,
      fontFace: FONT_BODY, fontSize: 14, color: style.palette.ink,
      align: 'left', valign: 'top',
    });
  });
}

function renderDiagramSlide(slide, s, resource, style) {
  renderHeadingBar(slide, s.heading || '', style);

  const stim = (resource.stimuli || []).find((x) => x.id === s.stimulusRef);
  if (!stim) {
    slide.addText('(Diagram stimulus not found)', {
      x: 0.7, y: 2.5, w: SLIDE_W - 1.4, h: 0.6,
      fontFace: FONT_BODY, fontSize: 16, color: style.palette.grey, italic: true,
    });
    return;
  }

  if (stim.kind === 'diagram' && stim.spec) {
    try {
      const svg = renderDiagram(stim.spec);
      const png = rasterSvgToPng(svg, { widthPx: 1600 });
      const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
      const vb = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
      const aspect = vb ? Number(vb[2]) / Number(vb[1]) : 0.46;
      const imgW = SLIDE_W - 3.0;
      const imgH = Math.min(SLIDE_H - 3.0, imgW * aspect);
      const x = (SLIDE_W - imgW) / 2;
      const y = 1.8;
      slide.addImage({ data: dataUrl, x, y, w: imgW, h: imgH });

      if (stim.altText) {
        slide.addText(stim.altText, {
          x: 0.7, y: y + imgH + 0.2, w: SLIDE_W - 1.4, h: 0.6,
          fontFace: FONT_BODY, fontSize: 12, color: style.palette.grey, italic: true, align: 'center',
        });
      }
      return;
    } catch {
      // fall through to text fallback
    }
  }

  if (stim.kind === 'dataSet' && stim.table) {
    const headers = stim.table.headers || [];
    const rows = stim.table.rows || [];
    const tableRows = [
      headers.map((h) => ({
        text: h,
        options: { bold: true, color: 'FFFFFF', fill: { color: style.palette.green } },
      })),
      ...rows.map((r) => r.map((c) => ({ text: String(c || '') }))),
    ];
    slide.addTable(tableRows, {
      x: 0.7, y: 2.0, w: SLIDE_W - 1.4,
      fontFace: FONT_BODY, fontSize: 14,
      border: { type: 'solid', pt: 1, color: style.palette.grey },
    });
    return;
  }

  const fallback = stim.body || stim.description || stim.altText || '(no content)';
  slide.addText(fallback, {
    x: 0.7, y: 2.0, w: SLIDE_W - 1.4, h: SLIDE_H - 3.0,
    fontFace: FONT_BODY, fontSize: 18, color: style.palette.ink, align: 'left', valign: 'top',
  });
}

const LAYOUT_RENDERERS = {
  title:        renderTitleSlide,
  objectives:   renderObjectivesSlide,
  vocabulary:   renderVocabularySlide,
  concept:      renderBulletSlide,
  example:      renderBulletSlide,
  practice:     renderBulletSlide,
  diagram:      renderDiagramSlide,
  exitTicket:   renderBulletSlide,
};

// ─────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────

/**
 * Render a Lesson Resource to a base64-encoded .pptx string.
 * Throws if the resource is not a Lesson or has no slides.
 */
export async function renderLessonPptx(resource) {
  if (resource?.meta?.resourceType !== 'Lesson') {
    throw new Error('renderLessonPptx: resource is not a Lesson');
  }
  const slides = resource.lesson?.slides || [];
  if (slides.length === 0) {
    throw new Error('renderLessonPptx: lesson.slides is empty');
  }

  // Pick the per-grade-band visual style. Falls back to a junior style
  // if grade is missing — never null for a Lesson resource.
  const style = pickLessonStyle({
    resourceType: 'Lesson',
    grade: resource.meta?.grade,
  }) || pickLessonStyle({ resourceType: 'Lesson', grade: 4 });

  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';
  pres.author = 'The Resource Room';
  pres.company = 'The Resource Room';
  pres.title = `${resource.cover.subjectLine} — ${resource.lesson?.capsAnchor?.unitTopic || ''}`.trim();
  pres.subject = `${resource.cover.gradeLine} ${resource.cover.termLine} — Lesson`;

  // Sort slides by ordinal so a model that emitted them out of order still
  // produces a coherent deck.
  const ordered = [...slides].sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0));

  // Sonnet 4.6 reliably skips layout:"title" — when no slide declares it,
  // we treat the first slide (lowest ordinal) AS the title slide regardless
  // of its declared layout.
  const hasExplicitTitle = ordered.some((s) => s.layout === 'title');
  const inferredTitleIdx = hasExplicitTitle ? -1 : 0;

  ordered.forEach((s, i) => {
    const slide = pres.addSlide();
    applyChrome(slide, resource, style);

    const effectiveLayout = i === inferredTitleIdx ? 'title' : s.layout;
    const renderer = LAYOUT_RENDERERS[effectiveLayout] || renderBulletSlide;
    try {
      renderer(slide, s, resource, style);
    } catch (err) {
      slide.addText(`(Slide could not render: ${err.message})`, {
        x: 0.7, y: 3.2, w: SLIDE_W - 1.4, h: 0.6,
        fontFace: FONT_BODY, fontSize: 16, color: style.palette.grey, italic: true,
      });
    }

    if (s.speakerNotes) slide.addNotes(s.speakerNotes);
  });

  const out = await pres.write({ outputType: 'base64' });
  return typeof out === 'string' ? out : Buffer.from(out).toString('base64');
}

// Exposed for tests.
export const __internals = {
  renderTitleSlide, renderBulletSlide, renderObjectivesSlide,
  renderVocabularySlide, renderDiagramSlide,
  applyChrome, bulletItems,
  SLIDE_W, SLIDE_H, FONT_HEAD, FONT_BODY,
};
