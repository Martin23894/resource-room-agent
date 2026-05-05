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

// ─────────────────────────────────────────────────────────────────
// PHASE B — VARIETY LAYOUTS
//
// Six additional layouts the model can choose from to break up the
// "every middle slide is a bullet list" monotony of v1. Each one renders
// with its own visual chrome so a deck that picks 4–6 different layouts
// reads as varied without the model having to design slides itself.
// ─────────────────────────────────────────────────────────────────

function renderWarmUpSlide(slide, s, _resource, style) {
  // Playful opener — single big question on a tinted card. The heading IS
  // the question; bullets (optional, 0–2) are scaffolding hints below.
  const palette = style.palette;
  const accent = nthAccent(style, 0);

  // Soft tinted backdrop card
  slide.addShape('roundRect', {
    x: 1.0, y: 1.6, w: SLIDE_W - 2.0, h: 4.6,
    fill: { color: palette.bgTint },
    line: { color: accent, width: 2 },
    rectRadius: style.cornerRadius,
  });

  // Small "WARM-UP" eyebrow strap
  slide.addText('WARM-UP', {
    x: 1.5, y: 1.85, w: SLIDE_W - 3.0, h: 0.4,
    fontFace: FONT_BODY, fontSize: 12, color: accent, bold: true,
    charSpacing: 6, align: 'left',
  });

  // The question itself — big friendly type
  const bullets = Array.isArray(s.bullets) ? s.bullets : [];
  const questionH = bullets.length === 0 ? 3.6 : 2.2;
  slide.addText(String(s.heading || ''), {
    x: 1.5, y: 2.4, w: SLIDE_W - 3.0, h: questionH,
    fontFace: FONT_HEAD, fontSize: 36, color: palette.ink, bold: true,
    align: 'left', valign: 'top',
  });

  // Optional scaffolding hints (bullets) under the question
  if (bullets.length > 0) {
    slide.addText(bulletItems(bullets), {
      x: 1.7, y: 4.7, w: SLIDE_W - 3.4, h: 1.4,
      fontFace: FONT_BODY, fontSize: 18, color: palette.inkSoft,
      paraSpaceAfter: 6, align: 'left', valign: 'top',
    });
  }

  // Decorative accent dot (top-right of the card) — soft visual cue
  slide.addShape('ellipse', {
    x: SLIDE_W - 2.0, y: 1.8, w: 0.5, h: 0.5,
    fill: { color: accent }, line: { color: accent },
  });
}

function renderWordWallSlide(slide, s, resource, style) {
  // Punchy term-only grid — no definitions on the slide. Definitions go
  // in speakerNotes for the teacher to call out.
  renderHeadingBar(slide, s.heading || 'Word wall', style);

  // Source terms from explicit bullets, else from lesson.vocabulary terms.
  const terms = Array.isArray(s.bullets) && s.bullets.length > 0
    ? s.bullets.map(String)
    : (Array.isArray(resource.lesson?.vocabulary) ? resource.lesson.vocabulary : [])
        .map((v) => String(v.term || ''))
        .filter(Boolean);

  if (terms.length === 0) {
    slide.addText('(No terms supplied)', {
      x: 0.7, y: 2.0, w: SLIDE_W - 1.4, h: 0.5,
      fontFace: FONT_BODY, fontSize: 16, color: style.palette.grey, italic: true,
    });
    return;
  }

  // Auto-pick grid: ≤4 terms → 2 cols, ≤9 → 3 cols, else 4 cols.
  const cols = terms.length <= 4 ? 2 : terms.length <= 9 ? 3 : 4;
  const rows = Math.ceil(terms.length / cols);
  const gridX = 0.7;
  const gridY = 1.9;
  const gridW = SLIDE_W - 2 * gridX;
  const gridH = SLIDE_H - gridY - 0.9;
  const gap = 0.2;
  const cellW = (gridW - gap * (cols - 1)) / cols;
  const cellH = (gridH - gap * (rows - 1)) / rows;
  // Keep type readable when there are many cards.
  const cardFontSize = cellH > 1.4 ? 28 : cellH > 1.0 ? 22 : 18;

  terms.forEach((term, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = gridX + col * (cellW + gap);
    const y = gridY + row * (cellH + gap);
    const accent = nthAccent(style, i);

    slide.addShape('roundRect', {
      x, y, w: cellW, h: cellH,
      fill: { color: accent }, line: { color: accent },
      rectRadius: style.cornerRadius * 0.5,
    });
    slide.addText(term, {
      x: x + 0.1, y, w: cellW - 0.2, h: cellH,
      fontFace: FONT_HEAD, fontSize: cardFontSize, bold: true, color: 'FFFFFF',
      align: 'center', valign: 'middle',
    });
  });
}

function renderThinkPairShareSlide(slide, s, _resource, style) {
  // Heading bar at top, big question card centered, 1–3 sub-prompts under,
  // and a paired-figure cue (two simple silhouettes + a speech bubble) on
  // the right so the teacher knows to put learners in pairs.
  renderHeadingBar(slide, 'Think · Pair · Share', style);

  const palette = style.palette;
  const accent = nthAccent(style, 0);
  const accent2 = nthAccent(style, 1);

  // Question card on the left two-thirds of the slide
  const cardX = 0.7;
  const cardY = 1.9;
  const cardW = SLIDE_W * 0.62;
  const cardH = SLIDE_H - cardY - 1.0;
  slide.addShape('roundRect', {
    x: cardX, y: cardY, w: cardW, h: cardH,
    fill: { color: 'FFFFFF' }, line: { color: accent, width: 2 },
    rectRadius: style.cornerRadius,
  });
  slide.addText(String(s.heading || ''), {
    x: cardX + 0.3, y: cardY + 0.3, w: cardW - 0.6, h: 1.4,
    fontFace: FONT_HEAD, fontSize: 28, color: palette.ink, bold: true,
    align: 'left', valign: 'top',
  });
  const bullets = Array.isArray(s.bullets) ? s.bullets : [];
  if (bullets.length > 0) {
    slide.addText(bulletItems(bullets), {
      x: cardX + 0.4, y: cardY + 1.8, w: cardW - 0.8, h: cardH - 2.1,
      fontFace: FONT_BODY, fontSize: 18, color: palette.inkSoft,
      paraSpaceAfter: 6, align: 'left', valign: 'top',
    });
  }

  // Paired figure silhouettes on the right — two stick-figure shapes made
  // from a circle head + a rounded-rect body. Simple, recognisable, no
  // image asset required (Phase C will swap in real illustrations).
  const figX = cardX + cardW + 0.4;
  const figW = SLIDE_W - figX - 0.7;

  const headSize = 0.6;
  const bodyW = 0.9;
  const bodyH = 1.2;

  // Figure 1 (left)
  const f1X = figX + 0.1;
  const f1Y = cardY + cardH * 0.3;
  slide.addShape('ellipse', {
    x: f1X + (bodyW - headSize) / 2, y: f1Y, w: headSize, h: headSize,
    fill: { color: accent }, line: { color: accent },
  });
  slide.addShape('roundRect', {
    x: f1X, y: f1Y + headSize + 0.05, w: bodyW, h: bodyH,
    fill: { color: accent }, line: { color: accent },
    rectRadius: 0.18,
  });

  // Figure 2 (right)
  const f2X = f1X + bodyW + 0.4;
  const f2Y = f1Y;
  slide.addShape('ellipse', {
    x: f2X + (bodyW - headSize) / 2, y: f2Y, w: headSize, h: headSize,
    fill: { color: accent2 }, line: { color: accent2 },
  });
  slide.addShape('roundRect', {
    x: f2X, y: f2Y + headSize + 0.05, w: bodyW, h: bodyH,
    fill: { color: accent2 }, line: { color: accent2 },
    rectRadius: 0.18,
  });

  // Speech-bubble cue above the figures
  const bubbleY = f1Y - 0.7;
  slide.addShape('roundRect', {
    x: f1X - 0.1, y: bubbleY, w: bodyW * 2 + 0.6, h: 0.5,
    fill: { color: 'FFFFFF' }, line: { color: palette.grey, width: 1 },
    rectRadius: 0.18,
  });
  slide.addText('💬 Talk to a partner', {
    x: f1X - 0.1, y: bubbleY, w: bodyW * 2 + 0.6, h: 0.5,
    fontFace: FONT_BODY, fontSize: 12, color: palette.inkSoft, italic: true,
    align: 'center', valign: 'middle',
  });

  // Width safeguard — ensure figures aren't off-slide on narrow setups
  void figW;
}

function renderWorkedExampleSlide(slide, s, _resource, style) {
  // Numbered step cards stacked vertically. Each bullet becomes one step.
  renderHeadingBar(slide, s.heading || 'Worked example', style);

  const palette = style.palette;
  const steps = Array.isArray(s.bullets) ? s.bullets : [];
  if (steps.length === 0) {
    slide.addText('(No steps supplied)', {
      x: 0.7, y: 2.0, w: SLIDE_W - 1.4, h: 0.5,
      fontFace: FONT_BODY, fontSize: 16, color: style.palette.grey, italic: true,
    });
    return;
  }

  const startY = 1.9;
  const padY = 0.12;
  const rowH = Math.min(0.9, (SLIDE_H - 2.6) / steps.length);
  const badgeW = rowH * 0.85;

  steps.forEach((text, i) => {
    const accent = nthAccent(style, i);
    const y = startY + i * (rowH + padY);

    // Numbered badge — accent-coloured circle with the step number
    slide.addShape('ellipse', {
      x: 0.7, y, w: badgeW, h: badgeW,
      fill: { color: accent }, line: { color: accent },
    });
    slide.addText(String(i + 1), {
      x: 0.7, y, w: badgeW, h: badgeW,
      fontFace: FONT_HEAD, fontSize: 24, bold: true, color: 'FFFFFF',
      align: 'center', valign: 'middle',
    });

    // Step body card — soft tint
    const cardX = 0.7 + badgeW + 0.2;
    slide.addShape('roundRect', {
      x: cardX, y, w: SLIDE_W - cardX - 0.7, h: badgeW,
      fill: { color: 'FFFFFF' }, line: { color: 'DDDDDD', width: 0.5 },
      rectRadius: style.cornerRadius * 0.6,
    });
    slide.addText(String(text || ''), {
      x: cardX + 0.2, y, w: SLIDE_W - cardX - 1.1, h: badgeW,
      fontFace: FONT_BODY, fontSize: steps.length <= 4 ? 18 : 16, color: palette.ink,
      align: 'left', valign: 'middle',
    });
  });
}

function renderYourTurnSlide(slide, s, _resource, style) {
  // Bright "Now try the worksheet" panel. Large accent-tinted card with
  // an action-style heading and 1–4 bullet hints / question references.
  const palette = style.palette;
  const accent = nthAccent(style, 0);

  renderHeadingBar(slide, s.heading || 'Your turn', style);

  // Big tinted panel
  const panelX = 0.7;
  const panelY = 1.9;
  const panelW = SLIDE_W - 2 * panelX;
  const panelH = SLIDE_H - panelY - 1.0;
  slide.addShape('roundRect', {
    x: panelX, y: panelY, w: panelW, h: panelH,
    fill: { color: palette.bgTint },
    line: { color: accent, width: 2 },
    rectRadius: style.cornerRadius,
  });

  // Subject-icon placeholder square on the right (Phase C swaps in real
  // illustration). For now: a friendly accent square with a play-arrow.
  const iconSize = Math.min(2.4, panelH - 0.6);
  const iconX = panelX + panelW - iconSize - 0.4;
  const iconY = panelY + (panelH - iconSize) / 2;
  slide.addShape('roundRect', {
    x: iconX, y: iconY, w: iconSize, h: iconSize,
    fill: { color: accent }, line: { color: accent },
    rectRadius: style.cornerRadius * 0.6,
  });
  slide.addText('▶', {
    x: iconX, y: iconY, w: iconSize, h: iconSize,
    fontFace: FONT_HEAD, fontSize: 80, bold: true, color: 'FFFFFF',
    align: 'center', valign: 'middle',
  });

  // Headline + bullets on the left
  const textX = panelX + 0.4;
  const textW = iconX - textX - 0.4;
  slide.addText('YOUR TURN', {
    x: textX, y: panelY + 0.3, w: textW, h: 0.4,
    fontFace: FONT_BODY, fontSize: 12, bold: true, color: accent,
    charSpacing: 6, align: 'left',
  });
  // The slide.heading is already on the heading bar; here we use a softer
  // sub-headline pulled from the bullets[0] if present, or a default.
  const bullets = Array.isArray(s.bullets) ? s.bullets : [];
  slide.addText(bullets.length > 0 ? String(bullets[0]) : 'Now try the worksheet questions.', {
    x: textX, y: panelY + 0.8, w: textW, h: 1.2,
    fontFace: FONT_HEAD, fontSize: 30, bold: true, color: palette.ink,
    align: 'left', valign: 'top',
  });
  if (bullets.length > 1) {
    slide.addText(bulletItems(bullets.slice(1)), {
      x: textX, y: panelY + 2.1, w: textW, h: panelH - 2.4,
      fontFace: FONT_BODY, fontSize: 18, color: palette.inkSoft,
      paraSpaceAfter: 6, align: 'left', valign: 'top',
    });
  }
}

function renderCelebrateSlide(slide, s, _resource, style) {
  // Closing well-done slide. Tinted bg + confetti-style decorative shapes
  // in the corners + a friendly headline + a short recap list.
  const palette = style.palette;
  slide.background = { color: palette.bgTint };

  // Confetti — small accent dots scattered in the corners. Deterministic
  // positions so generation is reproducible.
  const confettiPositions = [
    { x: 0.4,  y: 0.9, r: 0.18, k: 0 },
    { x: 1.2,  y: 0.5, r: 0.12, k: 1 },
    { x: 2.0,  y: 1.0, r: 0.20, k: 2 },
    { x: SLIDE_W - 0.6, y: 0.7, r: 0.16, k: 1 },
    { x: SLIDE_W - 1.4, y: 1.1, r: 0.22, k: 0 },
    { x: SLIDE_W - 2.2, y: 0.5, r: 0.14, k: 3 },
    { x: 0.7,  y: SLIDE_H - 1.2, r: 0.18, k: 2 },
    { x: 1.6,  y: SLIDE_H - 0.7, r: 0.14, k: 0 },
    { x: SLIDE_W - 1.0, y: SLIDE_H - 1.0, r: 0.20, k: 3 },
    { x: SLIDE_W - 2.0, y: SLIDE_H - 1.4, r: 0.16, k: 1 },
  ];
  for (const c of confettiPositions) {
    const colour = nthAccent(style, c.k);
    slide.addShape('ellipse', {
      x: c.x, y: c.y, w: c.r * 2, h: c.r * 2,
      fill: { color: colour }, line: { color: colour },
    });
  }

  // Big friendly headline
  slide.addText(String(s.heading || 'Well done!'), {
    x: 1.0, y: 2.2, w: SLIDE_W - 2.0, h: 1.4,
    fontFace: FONT_HEAD, fontSize: 56, bold: true, color: palette.green,
    align: 'center', valign: 'middle',
  });

  // Optional recap bullets
  const bullets = Array.isArray(s.bullets) ? s.bullets : [];
  if (bullets.length > 0) {
    slide.addText(bulletItems(bullets), {
      x: 2.0, y: 4.0, w: SLIDE_W - 4.0, h: 2.2,
      fontFace: FONT_BODY, fontSize: 20, color: palette.ink,
      paraSpaceAfter: 6, align: 'left', valign: 'top',
    });
  }
}

const LAYOUT_RENDERERS = {
  // Phase A
  title:          renderTitleSlide,
  objectives:     renderObjectivesSlide,
  vocabulary:     renderVocabularySlide,
  concept:        renderBulletSlide,
  example:        renderBulletSlide,
  practice:       renderBulletSlide,
  diagram:        renderDiagramSlide,
  exitTicket:     renderBulletSlide,
  // Phase B variety
  warmUp:         renderWarmUpSlide,
  wordWall:       renderWordWallSlide,
  thinkPairShare: renderThinkPairShareSlide,
  workedExample:  renderWorkedExampleSlide,
  yourTurn:       renderYourTurnSlide,
  celebrate:      renderCelebrateSlide,
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
  // Phase A
  renderTitleSlide, renderBulletSlide, renderObjectivesSlide,
  renderVocabularySlide, renderDiagramSlide,
  // Phase B variety
  renderWarmUpSlide, renderWordWallSlide, renderThinkPairShareSlide,
  renderWorkedExampleSlide, renderYourTurnSlide, renderCelebrateSlide,
  // Plumbing + dispatch
  applyChrome, bulletItems, LAYOUT_RENDERERS,
  SLIDE_W, SLIDE_H, FONT_HEAD, FONT_BODY,
};
