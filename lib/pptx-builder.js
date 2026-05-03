// PowerPoint renderer for a Lesson Resource.
//
// Pure function over a validated Resource — same input as lib/render.js's
// DOCX renderer. Walks `resource.lesson.slides[]` in ordinal order and
// emits one slide per entry, applying a layout-specific template.
//
// The visual language tracks the DOCX renderer: green accent (#085041) on
// title bars + headings, Inter-style sans body, Source Serif for titles.
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

// ── Style constants. Mirror lib/render.js so DOCX and PPTX feel like
// pages of the same product, not two unrelated artifacts.
const FONT_BODY  = 'Calibri';        // Office-default; ships with PowerPoint
const FONT_TITLE = 'Calibri';        // we also ship Inter via the rasteriser,
                                     // but pptx text uses fonts on the
                                     // viewer machine — Calibri is universal.
const COLOR_GREEN     = '085041';
const COLOR_GREEN_BAR = '0F6E56';
const COLOR_INK       = '1A1A18';
const COLOR_INK_SOFT  = '3D3D3A';
const COLOR_GREY      = '999999';
const COLOR_BG_TINT   = 'E1F5EE';

// Standard widescreen layout — 13.33 × 7.5 inches.
const SLIDE_W = 13.33;
const SLIDE_H = 7.5;

// ─────────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────────

/** Top accent bar + footer line. Applied to every slide so the deck has
 *  a consistent visual frame regardless of which layout the model chose. */
function applyChrome(slide, resource) {
  // Top accent bar
  slide.addShape('rect', {
    x: 0, y: 0, w: SLIDE_W, h: 0.35,
    fill: { color: COLOR_GREEN }, line: { color: COLOR_GREEN },
  });
  // Footer
  const footer = `${resource.cover.subjectLine}  ·  ${resource.cover.gradeLine}  ${resource.cover.termLine}`;
  slide.addText(footer, {
    x: 0.5, y: SLIDE_H - 0.45, w: SLIDE_W - 1.0, h: 0.35,
    fontFace: FONT_BODY, fontSize: 10, color: COLOR_GREY, align: 'left',
  });
  slide.addText('The Resource Room', {
    x: SLIDE_W - 3.0, y: SLIDE_H - 0.45, w: 2.5, h: 0.35,
    fontFace: FONT_BODY, fontSize: 10, color: COLOR_GREY, align: 'right',
  });
}

function bulletItems(items) {
  // pptxgenjs accepts an array of objects each with their own bullet flag.
  return (items || []).map((text) => ({
    text: String(text || ''),
    options: { bullet: { type: 'bullet' } },
  }));
}

// ─────────────────────────────────────────────────────────────────
// LAYOUT RENDERERS
// Each function takes (slide, slideData, resource) and adds shapes
// to that slide. Layout-specific knobs (image dimensions, fonts) are
// localised here so one tweak doesn't ripple across the rest.
// ─────────────────────────────────────────────────────────────────

function renderTitleSlide(slide, s, resource) {
  // Big tinted background for impact.
  slide.background = { color: COLOR_BG_TINT };
  slide.addText('THE RESOURCE ROOM', {
    x: 0.5, y: 1.2, w: SLIDE_W - 1.0, h: 0.5,
    fontFace: FONT_BODY, fontSize: 14, color: COLOR_GREEN, bold: true,
    charSpacing: 6, align: 'center',
  });
  slide.addText(s.heading || resource.cover.subjectLine, {
    x: 0.5, y: 2.0, w: SLIDE_W - 1.0, h: 1.6,
    fontFace: FONT_TITLE, fontSize: 48, color: COLOR_INK, bold: true,
    align: 'center', valign: 'middle',
  });
  if (resource.lesson?.capsAnchor?.unitTopic) {
    slide.addText(resource.lesson.capsAnchor.unitTopic, {
      x: 0.5, y: 3.8, w: SLIDE_W - 1.0, h: 0.8,
      fontFace: FONT_BODY, fontSize: 22, color: COLOR_INK_SOFT,
      align: 'center', italic: true,
    });
  }
  const subtitle = `${resource.cover.gradeLine}  ·  ${resource.cover.termLine}` +
    (resource.lesson?.lessonMinutes ? `  ·  ${resource.lesson.lessonMinutes} minutes` : '');
  slide.addText(subtitle, {
    x: 0.5, y: 4.8, w: SLIDE_W - 1.0, h: 0.5,
    fontFace: FONT_BODY, fontSize: 16, color: COLOR_GREEN, bold: true, align: 'center',
  });
  if (Array.isArray(s.bullets) && s.bullets.length) {
    slide.addText(bulletItems(s.bullets), {
      x: 1.5, y: 5.4, w: SLIDE_W - 3.0, h: 1.4,
      fontFace: FONT_BODY, fontSize: 14, color: COLOR_INK_SOFT, align: 'left',
    });
  }
}

function renderHeadingBar(slide, heading) {
  slide.addText(heading, {
    x: 0.5, y: 0.6, w: SLIDE_W - 1.0, h: 0.7,
    fontFace: FONT_TITLE, fontSize: 30, color: COLOR_GREEN, bold: true,
    align: 'left', valign: 'middle',
  });
  // Underline accent
  slide.addShape('rect', {
    x: 0.5, y: 1.35, w: 1.5, h: 0.05,
    fill: { color: COLOR_GREEN_BAR }, line: { color: COLOR_GREEN_BAR },
  });
}

function renderBulletSlide(slide, s) {
  renderHeadingBar(slide, s.heading || '');
  const bullets = Array.isArray(s.bullets) ? s.bullets : [];
  if (bullets.length === 0) {
    slide.addText('(No bullets supplied)', {
      x: 0.7, y: 2.0, w: SLIDE_W - 1.4, h: 0.5,
      fontFace: FONT_BODY, fontSize: 16, color: COLOR_GREY, italic: true,
    });
    return;
  }
  // Auto-shrink font when many bullets.
  const fontSize = bullets.length <= 4 ? 24 : bullets.length <= 6 ? 20 : 18;
  slide.addText(bulletItems(bullets), {
    x: 0.7, y: 2.0, w: SLIDE_W - 1.4, h: SLIDE_H - 3.0,
    fontFace: FONT_BODY, fontSize, color: COLOR_INK,
    paraSpaceAfter: 6, align: 'left', valign: 'top',
  });
}

function renderVocabularySlide(slide, s, resource) {
  renderHeadingBar(slide, s.heading || 'Key Vocabulary');
  // If the model put bullets here, render them; otherwise pull from
  // resource.lesson.vocabulary as a "Term — Definition" list.
  if (Array.isArray(s.bullets) && s.bullets.length > 0) {
    return renderBulletSlide(slide, s);
  }
  const vocab = resource.lesson?.vocabulary || [];
  if (vocab.length === 0) return;
  const items = vocab.map((v) => ({
    text: [
      { text: v.term, options: { bold: true, color: COLOR_GREEN } },
      { text: ` — ${v.definition}`, options: { color: COLOR_INK } },
    ],
    options: { bullet: { type: 'bullet' } },
  }));
  slide.addText(items, {
    x: 0.7, y: 2.0, w: SLIDE_W - 1.4, h: SLIDE_H - 3.0,
    fontFace: FONT_BODY, fontSize: 22, paraSpaceAfter: 8, align: 'left', valign: 'top',
  });
}

function renderDiagramSlide(slide, s, resource) {
  renderHeadingBar(slide, s.heading || '');

  const stim = (resource.stimuli || []).find((x) => x.id === s.stimulusRef);
  if (!stim) {
    slide.addText('(Diagram stimulus not found)', {
      x: 0.7, y: 2.5, w: SLIDE_W - 1.4, h: 0.6,
      fontFace: FONT_BODY, fontSize: 16, color: COLOR_GREY, italic: true,
    });
    return;
  }

  // Try to rasterise. If the stimulus is a renderable diagram, embed PNG.
  // Otherwise fall back to the verbal description.
  if (stim.kind === 'diagram' && stim.spec) {
    try {
      const svg = renderDiagram(stim.spec);
      const png = rasterSvgToPng(svg, { widthPx: 1600 });
      const dataUrl = `data:image/png;base64,${png.toString('base64')}`;

      // Derive aspect from the SVG viewBox so each diagram type keeps
      // its proper shape rather than being squashed.
      const vb = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
      const aspect = vb ? Number(vb[2]) / Number(vb[1]) : 0.46;
      const imgW = SLIDE_W - 3.0;             // leave 1.5" margin each side
      const imgH = Math.min(SLIDE_H - 3.0, imgW * aspect);
      const x = (SLIDE_W - imgW) / 2;
      const y = 1.8;
      slide.addImage({ data: dataUrl, x, y, w: imgW, h: imgH });

      if (stim.altText) {
        slide.addText(stim.altText, {
          x: 0.7, y: y + imgH + 0.2, w: SLIDE_W - 1.4, h: 0.6,
          fontFace: FONT_BODY, fontSize: 12, color: COLOR_GREY, italic: true, align: 'center',
        });
      }
      return;
    } catch {
      // fall through to text fallback
    }
  }

  // dataSet → simple table; passage / scenario / visualText → boxed text
  if (stim.kind === 'dataSet' && stim.table) {
    const headers = stim.table.headers || [];
    const rows = stim.table.rows || [];
    const tableRows = [
      headers.map((h) => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: COLOR_GREEN } } })),
      ...rows.map((r) => r.map((c) => ({ text: String(c || '') }))),
    ];
    slide.addTable(tableRows, {
      x: 0.7, y: 2.0, w: SLIDE_W - 1.4,
      fontFace: FONT_BODY, fontSize: 14, border: { type: 'solid', pt: 1, color: COLOR_GREY },
    });
    return;
  }

  const fallback = stim.body || stim.description || stim.altText || '(no content)';
  slide.addText(fallback, {
    x: 0.7, y: 2.0, w: SLIDE_W - 1.4, h: SLIDE_H - 3.0,
    fontFace: FONT_BODY, fontSize: 18, color: COLOR_INK, align: 'left', valign: 'top',
  });
}

const LAYOUT_RENDERERS = {
  title:        renderTitleSlide,
  objectives:   renderBulletSlide,
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

  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';
  pres.author = 'The Resource Room';
  pres.company = 'The Resource Room';
  pres.title = `${resource.cover.subjectLine} — ${resource.lesson?.capsAnchor?.unitTopic || ''}`.trim();
  pres.subject = `${resource.cover.gradeLine} ${resource.cover.termLine} — Lesson`;

  // Sort slides by ordinal so a model that emitted them out of order still
  // produces a coherent deck.
  const ordered = [...slides].sort((a, b) => (a.ordinal || 0) - (b.ordinal || 0));

  for (const s of ordered) {
    const slide = pres.addSlide();
    applyChrome(slide, resource);

    const renderer = LAYOUT_RENDERERS[s.layout] || renderBulletSlide;
    try {
      renderer(slide, s, resource);
    } catch (err) {
      // One failed slide must not blow up the deck — emit a placeholder
      // so the teacher can spot it and we keep the rest of the lesson.
      slide.addText(`(Slide could not render: ${err.message})`, {
        x: 0.7, y: 3.2, w: SLIDE_W - 1.4, h: 0.6,
        fontFace: FONT_BODY, fontSize: 16, color: COLOR_GREY, italic: true,
      });
    }

    if (s.speakerNotes) slide.addNotes(s.speakerNotes);
  }

  // pres.write returns either a string (when outputType='base64') or a
  // Buffer/Blob otherwise; coerce to string for transport in the JSON
  // response payload.
  const out = await pres.write({ outputType: 'base64' });
  return typeof out === 'string' ? out : Buffer.from(out).toString('base64');
}

// Exposed for tests.
export const __internals = {
  renderTitleSlide, renderBulletSlide, renderVocabularySlide, renderDiagramSlide,
  applyChrome, bulletItems,
  SLIDE_W, SLIDE_H, COLOR_GREEN,
};
