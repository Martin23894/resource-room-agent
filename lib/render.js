// Schema-first DOCX renderer (Day 3 — question paper only).
//
// Pure function over a validated Resource. No markdown parsing, no regex
// repair — every paragraph, table, and label maps 1:1 from the schema:
//
//   resource.cover     → cover page (title block + learner info + instructions)
//   resource.stimuli   → passages / visual texts / data sets / scenarios
//                        (each rendered once, before the first section that
//                        references it via stimulusRefs)
//   resource.sections  → numbered question groups with computed totals
//   leaf.answerSpace   → the writing space the learner uses (lines, working+
//                        answer block, MCQ options, table, inline blank)
//
// Section totals and paper totals are computed from leaf.marks here, not
// stored. Memo + cog table + extension are Day 4 — this renderer emits
// the question paper a learner receives.
//
// Style constants mirror lib/docx-builder.js so the v2 visual matches v1.

import {
  Document, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  AlignmentType, BorderStyle, HeightRule, WidthType,
  ShadingType, Header, Footer, PageBreak, TabStopType,
} from 'docx';

import { i18n } from './i18n.js';
import { renderDiagram } from './diagrams/index.js';
import { rasterSvgToPng } from './diagrams/raster.js';
import { pickLessonStyle, nthAccent } from './palette.js';
import { pickHero, pickStamp, illustrationToPng } from './illustrations/index.js';

// ── style constants (kept identical to lib/docx-builder.js) ──
const FONT = 'Arial';
const GREEN = '085041';
const GREY = '999999';
const BLANK_LINE = '_______________________________________________';

const bdr = { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' };
const cellBorders = { top: bdr, bottom: bdr, left: bdr, right: bdr };
const nilBdr = { style: BorderStyle.NIL, size: 0, color: 'FFFFFF' };
const noBorders = { top: nilBdr, bottom: nilBdr, left: nilBdr, right: nilBdr };

// ─────────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────────
function txt(text, opts = {}) {
  return new TextRun({
    text: String(text),
    font: FONT,
    size: opts.size || 22,
    bold: !!opts.bold,
    italics: !!opts.italics,
    color: opts.color || '000000',
    underline: opts.underline || undefined,
  });
}

// Convert a string that may contain **emphasis** into an array of TextRuns,
// rendering balanced **...** spans as underlined text and stripping any
// stray (unbalanced) ** markers. The teacher review (docs/teacher-feedback-
// 2026-05.md §2.1) flagged that Sonnet emits markdown-style emphasis like
// "Identify the **underlined** noun", which the renderer was passing
// through verbatim — leaving literal asterisks visible to learners. The
// pedagogical intent is "underline this word", so we map to a real
// underline TextRun. Idempotent on plain text.
function richRuns(text, baseOpts = {}) {
  if (text == null) return [txt('', baseOpts)];
  const s = String(text);
  if (!s) return [txt('', baseOpts)];
  // Split on balanced **content** spans. The capture group preserves the
  // emphasised text; surrounding plain-text segments occupy the even slots.
  const parts = s.split(/\*\*([^*\n]+)\*\*/g);
  const runs = [];
  for (let i = 0; i < parts.length; i++) {
    let part = parts[i];
    if (i % 2 === 0) {
      // Plain segment — drop any surviving unbalanced ** markers so they
      // don't leak through as literal asterisks.
      part = part.replace(/\*\*/g, '');
      if (part) runs.push(txt(part, baseOpts));
    } else {
      runs.push(txt(part, { ...baseOpts, underline: { type: 'single', color: '000000' } }));
    }
  }
  return runs.length ? runs : [txt('', baseOpts)];
}

function para(content, opts = {}) {
  // String content runs through richRuns so any **emphasis** becomes a real
  // underlined TextRun rather than literal asterisks. Callers passing a
  // pre-built TextRun[] keep full control.
  const children = typeof content === 'string' ? richRuns(content, opts) : content;
  return new Paragraph({
    children,
    spacing: { before: opts.spaceBefore || 0, after: opts.spaceAfter ?? 60 },
    alignment: opts.align || AlignmentType.LEFT,
    indent: opts.indent,
    tabStops: opts.tabStops,
    border: opts.border,
  });
}

function blank(spaceAfter = 60) {
  return para('', { spaceAfter });
}

function sectionHead(text) {
  return para(text, { bold: true, size: 26, color: GREEN, spaceBefore: 300, spaceAfter: 120 });
}

function stimulusHead(text) {
  return para(text, { bold: true, size: 22, color: GREEN, spaceBefore: 200, spaceAfter: 80 });
}

// Right-aligned mark bracket sitting on its own paragraph after a stem.
function markBracket(marks) {
  return para(`[${marks}]`, { bold: true, align: AlignmentType.RIGHT, spaceAfter: 60 });
}

// ─────────────────────────────────────────────────────────────────
// COVER PAGE
// ─────────────────────────────────────────────────────────────────
function renderCover(resource) {
  const { meta, cover } = resource;
  const els = [];

  els.push(para('THE RESOURCE ROOM', {
    bold: true, size: 28, color: GREEN, align: AlignmentType.CENTER, spaceAfter: 60,
  }));
  els.push(para(cover.resourceTypeLabel, {
    bold: true, size: 36, align: AlignmentType.CENTER, spaceAfter: 60,
  }));
  els.push(para(cover.subjectLine, {
    bold: true, size: 28, align: AlignmentType.CENTER, spaceAfter: 160,
  }));

  // Grade | Term row
  els.push(new Table({
    width: { size: 9026, type: WidthType.DXA }, columnWidths: [4513, 4513],
    rows: [new TableRow({ children: [
      new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA },
        children: [new Paragraph({ children: [txt(cover.gradeLine, { size: 24, bold: true })] })] }),
      new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA },
        children: [new Paragraph({ children: [txt(cover.termLine, { size: 24, bold: true })], alignment: AlignmentType.RIGHT })] }),
    ]})],
  }));
  els.push(blank(80));

  // Learner info table — pair fields in two columns by declaration order.
  const fields = cover.learnerInfoFields || [];
  for (let i = 0; i < fields.length; i += 2) {
    const left = fields[i];
    const right = fields[i + 1];
    const cellLeft = new TableCell({
      borders: noBorders, width: { size: 4513, type: WidthType.DXA },
      children: [new Paragraph({ children: [txt(fieldDisplay(left, meta), { size: 22 })] })],
    });
    const cellRight = right
      ? new TableCell({
          borders: noBorders, width: { size: 4513, type: WidthType.DXA },
          children: [new Paragraph({ children: [txt(fieldDisplay(right, meta), { size: 22 })], alignment: AlignmentType.RIGHT })],
        })
      : new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('')] })] });

    els.push(new Table({
      width: { size: 9026, type: WidthType.DXA }, columnWidths: [4513, 4513],
      rows: [new TableRow({ children: [cellLeft, cellRight] })],
    }));
  }
  els.push(blank(120));

  // Instructions block
  els.push(para(`${cover.instructions.heading}:`, { bold: true, size: 22, spaceAfter: 60 }));
  for (const item of cover.instructions.items) {
    els.push(new Paragraph({
      children: [txt(`•  ${item}`, { size: 22 })],
      indent: { left: 360 },
      spacing: { after: 40 },
    }));
  }

  return els;
}

// Render a learner-info field as "Label: <value-or-blank>". The model can
// supply the value inside the label string (e.g. "Time: 60 minutes") or leave
// it bare ("Time"); we strip any existing colon-suffix and re-derive value
// fields (time, total) from meta so output is consistent across both shapes.
function fieldDisplay(field, meta) {
  const baseLabel = String(field.label || '').replace(/\s*:\s*.*$/, '').trim() || labelFor(field.kind, meta);
  switch (field.kind) {
    case 'time': {
      const mins = meta.duration?.minutes;
      const unit = meta.language === 'Afrikaans' ? 'minute' : 'minutes';
      return mins ? `${baseLabel}: ${mins} ${unit}` : `${baseLabel}: __________`;
    }
    case 'total': {
      const wordMarks = meta.language === 'Afrikaans' ? 'punte' : 'marks';
      return `${baseLabel}: ${meta.totalMarks} ${wordMarks}`;
    }
    case 'comments':
      return `${baseLabel}: __________________________________________________`;
    default:
      return `${baseLabel}: _______________________`;
  }
}

// Fallback label if the field has no label string at all.
function labelFor(kind, meta) {
  const af = meta.language === 'Afrikaans';
  switch (kind) {
    case 'name':     return af ? 'Naam' : 'Name';
    case 'surname':  return af ? 'Van' : 'Surname';
    case 'date':     return af ? 'Datum' : 'Date';
    case 'examiner': return af ? 'Eksaminator' : 'Examiner';
    case 'time':     return af ? 'Tyd' : 'Time';
    case 'total':    return af ? 'Totaal' : 'Total';
    case 'code':     return af ? 'Kode' : 'Code';
    case 'comments': return af ? 'Opmerkings' : 'Comments';
    default:         return '';
  }
}

// ─────────────────────────────────────────────────────────────────
// STIMULI
// ─────────────────────────────────────────────────────────────────
function renderStimulus(stimulus) {
  const els = [];
  const heading = stimulus.heading || defaultStimulusHeading(stimulus);
  if (heading) els.push(stimulusHead(heading));

  switch (stimulus.kind) {
    case 'passage':
    case 'scenario': {
      const body = stimulus.body || '';
      for (const line of body.split('\n')) {
        const tr = line.trim();
        if (!tr) { els.push(blank(40)); continue; }
        els.push(para(tr, { spaceAfter: 60 }));
      }
      if (stimulus.wordCount) {
        els.push(para(`(${stimulus.wordCount} words)`, {
          italics: true, color: GREY, align: AlignmentType.RIGHT, spaceAfter: 80,
        }));
      }
      break;
    }
    case 'diagram': {
      // If a renderable spec is present, rasterise → embed as an image.
      // Otherwise fall back to the verbal-description block (legacy behaviour).
      if (stimulus.spec) {
        try {
          const svg = renderDiagram(stimulus.spec);
          const png = rasterSvgToPng(svg, { widthPx: 1400 });
          // Derive embed height from the SVG's own viewBox so each diagram
          // type keeps its own aspect ratio (bar_graph 700x320, number_line
          // 700x130, etc.). Hard-coding one ratio squashes/stretches anything
          // that doesn't match.
          const vb = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
          const aspect = vb ? Number(vb[2]) / Number(vb[1]) : 0.46;   // fallback ≈ bar_graph
          const embedWidth = 520;
          els.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({ data: png, transformation: { width: embedWidth, height: embedWidth * aspect } })],
            spacing: { after: 120 },
          }));
          break;
        } catch (err) {
          // Fall through to text-only block on render failure — the paper
          // still ships even if a diagram can't be drawn.
          els.push(para(`[Diagram could not be rendered: ${err.message}]`, { italics: true, color: GREY }));
        }
      }
      // fall through to verbal description
    }
    case 'visualText': {
      const body = stimulus.description || stimulus.altText || '';
      els.push(new Table({
        width: { size: 9026, type: WidthType.DXA },
        rows: [new TableRow({ children: [new TableCell({
          borders: cellBorders,
          margins: { top: 120, bottom: 120, left: 200, right: 200 },
          children: [new Paragraph({ children: [txt('[Visual text — described below]', { italics: true, color: GREY, size: 20 })] }),
                     new Paragraph({ children: [txt(body, { size: 22 })] })],
        })] })],
      }));
      els.push(blank(80));
      break;
    }
    case 'dataSet': {
      // A dataSet stimulus must carry actual data — either a structured
      // table or a verbal description. If neither is present, surface the
      // gap to the teacher rather than rendering just an orphan heading.
      if (stimulus.table) els.push(renderTable(stimulus.table.headers, stimulus.table.rows));
      else if (stimulus.description) els.push(para(stimulus.description));
      else els.push(para(`[Data missing for stimulus '${stimulus.id}' — please regenerate]`, {
        italics: true, color: GREY,
      }));
      break;
    }
    default:
      if (stimulus.body) els.push(para(stimulus.body));
      else if (stimulus.description) els.push(para(stimulus.description));
  }
  els.push(blank(80));
  return els;
}

function defaultStimulusHeading(s) {
  switch (s.kind) {
    case 'passage':    return 'PASSAGE';
    case 'visualText': return 'VISUAL TEXT';
    case 'dataSet':    return 'DATA';
    case 'diagram':    return 'DIAGRAM';
    case 'scenario':   return 'SCENARIO';
    default:           return null;
  }
}

function renderTable(headers, rows) {
  // Defensive: a header-only table renders as a single green bar with no
  // body — exactly the "black bar where a table should be" failure the
  // 2026-05 teacher review (docs/teacher-feedback-2026-05.md §2.1) flagged.
  // If there are no data rows, surface the gap to the teacher instead of
  // silently rendering a headers-only stub.
  const safeHeaders = Array.isArray(headers) && headers.length > 0
    ? headers
    : ['Column 1'];
  const safeRows = Array.isArray(rows) && rows.length > 0
    ? rows
    : [Array.from({ length: safeHeaders.length }, (_, i) =>
        i === 0 ? '[Table data missing — please regenerate]' : ''
      )];
  const headerRow = new TableRow({
    children: safeHeaders.map((h) => new TableCell({
      children: [new Paragraph({ children: [txt(h, { size: 18, bold: true, color: 'FFFFFF' })] })],
      shading: { fill: GREEN, type: ShadingType.SOLID },
      borders: cellBorders,
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
    })),
  });
  const dataRows = safeRows.map((r) => new TableRow({
    // User-content cells flow through richRuns so any **emphasis** Sonnet
    // emitted renders properly, not as literal asterisks.
    children: r.map((c) => new TableCell({
      children: [new Paragraph({ children: richRuns(String(c), { size: 18 }) })],
      borders: cellBorders,
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
    })),
  }));
  return new Table({ rows: [headerRow, ...dataRows], width: { size: 9026, type: WidthType.DXA } });
}

// ─────────────────────────────────────────────────────────────────
// SECTIONS + QUESTIONS
// ─────────────────────────────────────────────────────────────────
function renderSection(section, L) {
  const els = [];
  const sectionMarks = sumLeafMarks(section.questions);
  // Defensive: Claude occasionally bakes "SECTION A:" prefix and/or
  // "(N marks)" suffix into section.title. Strip them so we don't render
  // duplicates like "SECTION A: SECTION A: MULTIPLE CHOICE  (15 marks)".
  const cleanTitle = String(section.title || '')
    .replace(/^\s*(?:SECTION|AFDELING)\s+[A-Z]\s*:\s*/i, '')   // EN + AF prefix
    .replace(/\s*\(\s*\d+\s*[a-zA-Z]+\s*\)\s*$/, '')           // trailing (N marks)
    .trim();
  const heading = section.letter
    ? `SECTION ${section.letter}: ${cleanTitle}  (${sectionMarks} ${L.marksWord})`
    : `${cleanTitle}  (${sectionMarks} ${L.marksWord})`;
  els.push(sectionHead(heading));

  if (section.instructions) {
    els.push(para(section.instructions, { italics: true, spaceAfter: 120 }));
  }

  for (const q of section.questions) {
    els.push(...renderQuestion(q, { depth: 0 }));
  }

  return els;
}

function renderQuestion(q, { depth }) {
  const els = [];
  const isComposite = Array.isArray(q.subQuestions);
  const indentLeft = 0;

  // Defensive: Sonnet sometimes flattens multi-part questions like
  //   "Rewrite the sentences. (a) The cat... (b) The dog... (c) The bird..."
  // into a single leaf's stem instead of using a Composite. The 2026-05
  // teacher review (docs/teacher-feedback-2026-05.md §2.1) explicitly
  // flags this — multi-part questions must stack vertically with an
  // answer space per part. If we detect this pattern on a non-MCQ leaf,
  // split the stem into preamble + per-part lines at render time.
  const multipart = !isComposite ? splitMultipartStem(q) : null;

  // Number + stem on a single paragraph; mark bracket on the next line for leaves.
  // q.stem flows through richRuns so any **emphasis** Sonnet emitted (e.g.
  // "Identify the **underlined** noun") renders as a real underline TextRun
  // instead of literal asterisks — see docs/teacher-feedback-2026-05.md §2.1.
  const headerStem = multipart ? multipart.preamble : (q.stem || '');
  const stemRun = [
    txt(q.number, { bold: true }),
    new TextRun({ text: '\t', font: FONT }),
    ...richRuns(headerStem),
  ];
  els.push(new Paragraph({
    children: stemRun,
    tabStops: [{ type: TabStopType.LEFT, position: 900 }],
    indent: { left: 900, hanging: 900 },
    spacing: { before: depth === 0 ? 200 : 120, after: 60 },
  }));

  if (isComposite) {
    for (const sub of q.subQuestions) {
      els.push(...renderQuestion(sub, { depth: depth + 1 }));
    }
    return els;
  }

  // Multi-part split: each (a)/(b)/(c) gets its own paragraph + answer line.
  // Per-part marks aren't on the schema; the leaf's total mark stays in the
  // bracket below. answerSpace.lines is interpreted as lines-per-part.
  if (multipart) {
    const linesPerPart = Math.max(1, q.answerSpace?.lines || 2);
    for (const part of multipart.parts) {
      els.push(new Paragraph({
        children: [txt(`(${part.label}) `, { bold: true }), ...richRuns(part.text)],
        indent: { left: 900 },
        spacing: { before: 80, after: 40 },
      }));
      for (let i = 0; i < linesPerPart; i++) {
        els.push(new Paragraph({
          children: [txt(BLANK_LINE)],
          indent: { left: 900 },
          spacing: { after: 40 },
        }));
      }
    }
    els.push(markBracket(q.marks));
    return els;
  }

  // Leaf — render the answer space in the same indent as the stem body.
  els.push(...renderAnswerSpace(q));
  els.push(markBracket(q.marks));

  return els;
}

// Detect a single leaf whose stem flattens multiple parts inline:
//   "Rewrite each sentence. (a) The cat... (b) The dog... (c) The bird..."
// Returns { preamble, parts: [{label, text}, ...] } when the pattern is
// present, otherwise null. We require ≥2 part markers so a stem that
// merely mentions "(a)" once in passing isn't mis-detected. MCQ leaves
// are skipped — their (a)/(b)/(c)/(d) live in the structured options
// array, not the stem.
const MULTIPART_PART_RE = /(?:^|\s|[.;:])\(([a-d])\)\s+/gi;

function splitMultipartStem(q) {
  if (!q || q.type === 'MCQ') return null;
  if (q.answerSpace && q.answerSpace.kind === 'options') return null;
  const stem = String(q.stem || '');
  if (!stem) return null;

  const matches = [];
  for (const m of stem.matchAll(MULTIPART_PART_RE)) {
    matches.push({ label: m[1].toLowerCase(), index: m.index, length: m[0].length });
  }
  if (matches.length < 2) return null;

  // Verify the labels form a sensible sequence starting from 'a'.
  const expectedLabels = ['a', 'b', 'c', 'd'];
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].label !== expectedLabels[i]) return null;
  }

  const firstIdx = matches[0].index;
  const preamble = stem.slice(0, firstIdx).trim();
  const parts = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : stem.length;
    const text = stem.slice(start, end).trim();
    if (!text) return null; // empty part → don't split
    parts.push({ label: matches[i].label, text });
  }
  return { preamble, parts };
}

function renderAnswerSpace(q) {
  const els = [];
  const space = q.answerSpace || { kind: 'lines', lines: 2 };

  switch (space.kind) {
    case 'options': {
      for (const opt of q.options || []) {
        els.push(new Paragraph({
          children: [
            txt(`${opt.label.toUpperCase()}.  `, { bold: true }),
            ...richRuns(opt.text),
          ],
          indent: { left: 1200 },
          spacing: { after: 40 },
        }));
      }
      break;
    }
    case 'workingPlusAnswer': {
      els.push(new Paragraph({
        children: [txt('Working: ', { bold: true, size: 20 }), txt(BLANK_LINE, { size: 20 })],
        indent: { left: 900 }, spacing: { after: 20 },
      }));
      els.push(new Paragraph({
        children: [txt(BLANK_LINE, { size: 20 })],
        indent: { left: 900 }, spacing: { after: 20 },
      }));
      els.push(new Paragraph({
        children: [txt('Answer: ', { bold: true, size: 20 }), txt(BLANK_LINE, { size: 20 })],
        indent: { left: 900 }, spacing: { after: 60 },
      }));
      break;
    }
    case 'lines': {
      const n = Math.max(1, space.lines || 2);
      for (let i = 0; i < n; i++) {
        els.push(new Paragraph({
          children: [txt(BLANK_LINE)],
          indent: { left: 900 },
          spacing: { after: 60 },
        }));
      }
      break;
    }
    case 'inlineBlank':
    case 'none':
      // The blank lives inside the stem text already.
      break;
    case 'table': {
      // An answerSpace.kind of "table" is meant to give the learner a grid
      // to write into. Sonnet sometimes declares the shape without column
      // headers — in that case fall back to a generic 2-column grid rather
      // than skipping silently (which leaves the question with no answer
      // area at all).
      const headers = space.columns?.headers && space.columns.headers.length > 0
        ? space.columns.headers
        : ['Answer'];
      const rows = Math.max(1, space.rows || 4);
      const blankRow = headers.map(() => '');
      const allRows = Array.from({ length: rows }, () => blankRow);
      els.push(renderTable(headers, allRows));
      break;
    }
  }
  return els;
}

// ─────────────────────────────────────────────────────────────────
// DERIVATIONS
// ─────────────────────────────────────────────────────────────────
function sumLeafMarks(questions) {
  let n = 0;
  const walk = (q) => {
    if (Array.isArray(q.subQuestions)) q.subQuestions.forEach(walk);
    else n += q.marks || 0;
  };
  questions.forEach(walk);
  return n;
}

// ─────────────────────────────────────────────────────────────────
// MEMO + COG ANALYSIS + RUBRIC + EXTENSION (teacher portion)
// All four are derived from the same Resource — no model involvement
// in the cog table or section totals; phantom rows are structurally
// impossible because the cog table iterates memo.answers grouped by
// cognitiveLevel, and the schema validator already guarantees memo
// answers cover exactly the leaf questions.
// ─────────────────────────────────────────────────────────────────

const COG_LEVEL_TRANSLATIONS = {
  Afrikaans: {
    Knowledge: 'Kennis',
    'Routine Procedures': 'Roetine Prosedures',
    'Complex Procedures': 'Komplekse Prosedures',
    'Problem Solving': 'Probleemoplossing',
    'Low Order': 'Lae Orde',
    'Middle Order': 'Middel Orde',
    'High Order': 'Hoë Orde',
    Literal: 'Letterlik',
    Reorganisation: 'Herorganisasie',
    Inferential: 'Inferensieel',
    'Evaluation and Appreciation': 'Evaluering en Waardering',
  },
};

function localiseCogLevel(name, language) {
  if (language === 'Afrikaans') return COG_LEVEL_TRANSLATIONS.Afrikaans[name] || name;
  return name;
}

function memoLabels(L) {
  return L.memo;
}

function cogTableLabels(L, frameworkName) {
  const isBarretts = frameworkName === "Barrett's";
  return {
    heading: L.cogTable.heading(frameworkName),
    cols: isBarretts ? L.cogTable.barrettCols : L.cogTable.cols,
  };
}

function renderMemoAnswers(resource, L) {
  const lang = resource.meta.language;
  const labels = memoLabels(L);
  const headers = [labels.no, labels.answer, labels.guidance, labels.cogLevel, labels.mark];
  const rows = (resource.memo?.answers || []).map((a) => [
    a.questionNumber,
    a.answer,
    a.markingGuidance || '',
    localiseCogLevel(a.cognitiveLevel, lang),
    String(a.marks),
  ]);

  const colWidths = [800, 3500, 2800, 1400, 600];
  const headerRow = new TableRow({
    children: headers.map((h, i) => new TableCell({
      width: { size: colWidths[i], type: WidthType.DXA },
      children: [new Paragraph({ children: [txt(h, { size: 18, bold: true, color: 'FFFFFF' })] })],
      shading: { fill: GREEN, type: ShadingType.SOLID },
      borders: cellBorders,
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
    })),
  });
  const dataRows = rows.map((r) => new TableRow({
    children: r.map((c, i) => new TableCell({
      width: { size: colWidths[i], type: WidthType.DXA },
      // User-content cells (answer, markingGuidance) flow through richRuns
      // so any **emphasis** Sonnet emitted renders as a real underline
      // rather than literal asterisks. Headers + system text use plain txt().
      children: c.split('\n').map((line) => new Paragraph({ children: richRuns(line, { size: 18 }) })),
      borders: cellBorders,
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
    })),
  }));
  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 9100, type: WidthType.DXA },
    columnWidths: colWidths,
  });
}

function renderCogAnalysis(resource, L) {
  const lang = resource.meta.language;
  const framework = resource.meta.cognitiveFramework;
  const tally = tallyByLevel(resource);
  const totalMarks = resource.meta.totalMarks;
  const labels = cogTableLabels(L, framework.name);

  const headers = [labels.cols.level, labels.cols.pct, labels.cols.prescribed, labels.cols.actual, labels.cols.actualPct];
  const dataRows = framework.levels.map((lvl) => {
    const actual = tally[lvl.name] || 0;
    const actualPct = totalMarks > 0 ? Math.round((actual / totalMarks) * 100) : 0;
    return [
      localiseCogLevel(lvl.name, lang),
      `${lvl.percent}%`,
      String(lvl.prescribedMarks),
      String(actual),
      `${actualPct}%`,
    ];
  });
  const totalActual = framework.levels.reduce((a, l) => a + (tally[l.name] || 0), 0);
  const totalLabel = lang === 'Afrikaans' ? 'TOTAAL' : 'TOTAL';
  const totalRow = [totalLabel, '100%', String(totalMarks), String(totalActual), '100%'];

  const colWidths = [3000, 1500, 1700, 1500, 1400];
  const headerRow = new TableRow({
    children: headers.map((h, i) => new TableCell({
      width: { size: colWidths[i], type: WidthType.DXA },
      children: [new Paragraph({ children: [txt(h, { size: 18, bold: true, color: 'FFFFFF' })] })],
      shading: { fill: GREEN, type: ShadingType.SOLID },
      borders: cellBorders,
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
    })),
  });
  const trs = dataRows.map((r) => new TableRow({
    children: r.map((c, i) => new TableCell({
      width: { size: colWidths[i], type: WidthType.DXA },
      children: [new Paragraph({ children: [txt(c, { size: 18 })] })],
      borders: cellBorders,
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
    })),
  }));
  const totalTr = new TableRow({
    children: totalRow.map((c, i) => new TableCell({
      width: { size: colWidths[i], type: WidthType.DXA },
      children: [new Paragraph({ children: [txt(c, { size: 18, bold: true })] })],
      shading: { fill: 'EEEEEE', type: ShadingType.SOLID },
      borders: cellBorders,
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
    })),
  });

  return new Table({
    rows: [headerRow, ...trs, totalTr],
    width: { size: 9100, type: WidthType.DXA },
    columnWidths: colWidths,
  });
}

function tallyByLevel(resource) {
  const tally = {};
  for (const a of resource.memo?.answers || []) {
    tally[a.cognitiveLevel] = (tally[a.cognitiveLevel] || 0) + (a.marks || 0);
  }
  return tally;
}

const RUBRIC_LABELS = {
  English:   { title: 'MARKING RUBRIC',   level: 'Level',  descriptor: 'Descriptor',  marks: 'Marks' },
  Afrikaans: { title: 'NASIENRUBRIEK',    level: 'Vlak',   descriptor: 'Beskrywer',   marks: 'Punte' },
};

const EXTENSION_LABELS = {
  English:   'EXTENSION ACTIVITY',
  Afrikaans: 'UITBREIDINGSAKTIWITEIT',
};

function renderRubric(rubric, lang) {
  const labels = RUBRIC_LABELS[lang] || RUBRIC_LABELS.English;
  const els = [];
  els.push(sectionHead(rubric.title || labels.title));

  for (const criterion of rubric.criteria || []) {
    els.push(para(criterion.name, { bold: true, size: 22, spaceBefore: 120, spaceAfter: 60 }));
    const headers = [labels.level, labels.descriptor, labels.marks];
    const rows = (criterion.descriptors || []).map((d) => [d.level, d.descriptor, String(d.marks)]);
    els.push(renderTable(headers, rows));
    els.push(blank(80));
  }
  return els;
}

function renderExtension(extension, lang) {
  const els = [];
  els.push(sectionHead(extension.title || EXTENSION_LABELS[lang] || EXTENSION_LABELS.English));
  els.push(para(extension.activity || '', { spaceAfter: 80 }));
  if (extension.instructions) {
    els.push(para(extension.instructions, { italics: true, color: GREY, spaceAfter: 80 }));
  }
  return els;
}

function buildMemoContent(resource, L) {
  const els = [];
  const lang = resource.meta.language;

  // Heading
  const memoTitle = lang === 'Afrikaans' ? 'MEMORANDUM' : 'MEMORANDUM';
  els.push(para(memoTitle, {
    bold: true, size: 32, color: GREEN, align: AlignmentType.CENTER,
    spaceBefore: 0, spaceAfter: 80,
  }));
  const subtitle = lang === 'Afrikaans'
    ? `${resource.cover.subjectLine} — ${resource.cover.gradeLine} ${resource.cover.termLine}`
    : `${resource.cover.subjectLine} — ${resource.cover.gradeLine} ${resource.cover.termLine}`;
  els.push(para(subtitle, { italics: true, align: AlignmentType.CENTER, spaceAfter: 240 }));

  // Junior-band Lesson memos get a "Well done!" stamp under the subtitle —
  // a small celebration cue for the teacher (and learner if marking is
  // shared in class). Senior band keeps the cleaner formal memo layout.
  const lessonStyle = pickLessonStyle({
    resourceType: resource.meta?.resourceType, grade: resource.meta?.grade,
  });
  if (lessonStyle && lessonStyle.gradeBand === 'junior') {
    try {
      const stamp = pickStamp({
        gradeBand: 'junior', language: lang,
        accent: `#${nthAccent(lessonStyle, 0)}`,
      });
      if (stamp) {
        const png = illustrationToPng(stamp.svg, { widthPx: 360 });
        els.push(new Paragraph({
          children: [new ImageRun({
            data: png, transformation: { width: 110, height: 110 },
          })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
        }));
      }
    } catch {
      // No stamp on raster failure — memo still renders cleanly.
    }
  }

  // Answers table
  els.push(renderMemoAnswers(resource, L));
  els.push(blank(160));

  // Cog analysis — SKIPPED for Creative Arts (CAPS-prescribed Practical
  // Task is rubric-marked, not cog-analysed; the 2026-05 teacher review
  // explicitly flagged the table as inappropriate for this subject).
  const isCreativeArts = /Life Skills.*Creative Arts/i.test(resource.meta.subject || '');
  if (!isCreativeArts) {
    const labels = cogTableLabels(L, resource.meta.cognitiveFramework.name);
    els.push(sectionHead(labels.heading));
    els.push(renderCogAnalysis(resource, L));
    els.push(blank(160));
  }

  // Rubric (optional, but REQUIRED for Creative Arts — that's the entire
  // marking instrument for Practical Task papers).
  if (resource.memo?.rubric) {
    els.push(...renderRubric(resource.memo.rubric, lang));
  }

  // Extension (optional)
  if (resource.memo?.extension) {
    els.push(...renderExtension(resource.memo.extension, lang));
  }

  return els;
}

// ─────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────
export function renderQuestionPaper(resource) {
  const L = i18n(resource.meta.language);
  return buildDocument(resource, L, buildPaperContent(resource, L));
}

export function renderResource(resource) {
  const L = i18n(resource.meta.language);
  const isLesson = resource.meta?.resourceType === 'Lesson' && resource.lesson;
  const lessonStyle = isLesson
    ? pickLessonStyle({ resourceType: resource.meta.resourceType, grade: resource.meta.grade })
    : null;

  // Lesson layout: lesson-plan pages → page break → kid-mode worksheet
  // pages → page break → memo pages. The worksheet uses a softer, more
  // playful renderer (friendly cover, no SECTION headers, soft mark pills,
  // dotted answer lines, accent-coloured question badges, self-assess row).
  // Tests / Exams / standalone Worksheets keep the formal renderer.
  if (isLesson) {
    const plan = buildLessonPlanContent(resource, L);
    plan.push(new Paragraph({ children: [new PageBreak()] }));
    const worksheet = buildLessonWorksheetContent(resource, L, lessonStyle);
    worksheet.push(new Paragraph({ children: [new PageBreak()] }));
    return buildDocument(resource, L, [...plan, ...worksheet, ...buildMemoContent(resource, L)]);
  }

  const paper = buildPaperContent(resource, L);
  paper.push(new Paragraph({ children: [new PageBreak()] }));
  return buildDocument(resource, L, [...paper, ...buildMemoContent(resource, L)]);
}

// ─────────────────────────────────────────────────────────────────
// LESSON PLAN (teacher-facing portion of a Lesson resource)
// ─────────────────────────────────────────────────────────────────
const LESSON_LABELS = {
  English: {
    title:           'LESSON PLAN',
    capsAnchor:      'CAPS Anchor',
    strand:          'Strand',
    weeks:           'Week range',
    minutes:         'Lesson length',
    minutesUnit:     'minutes',
    objectives:      'LEARNING OBJECTIVES',
    objectivesIntro: 'By the end of this lesson learners will be able to:',
    priorKnowledge:  'PRIOR KNOWLEDGE',
    vocabulary:      'KEY VOCABULARY',
    materials:       'MATERIALS',
    phases:          'LESSON PHASES',
    teacherActions:  'Teacher does',
    learnerActions:  'Learners do',
    questionsToAsk:  'Questions to ask',
    worksheetCue:    '→ Learners complete the attached worksheet during this phase.',
    differentiation: 'DIFFERENTIATION',
    diffBelow:       'Below grade',
    diffOnGrade:     'On grade',
    diffAbove:       'Above grade',
    homework:        'HOMEWORK',
    teacherNotes:    'TEACHER NOTES',
    worksheetHeader: 'LEARNER WORKSHEET — STARTS ON THE NEXT PAGE',
    sourceLabel:     'Source',
  },
  Afrikaans: {
    title:           'LESPLAN',
    capsAnchor:      'KABV-anker',
    strand:          'Vakgebied',
    weeks:           'Weekreeks',
    minutes:         'Leslengte',
    minutesUnit:     'minute',
    objectives:      'LEERUITKOMSTE',
    objectivesIntro: 'Aan die einde van die les sal leerders in staat wees om:',
    priorKnowledge:  'VOORKENNIS',
    vocabulary:      'SLEUTELWOORDESKAT',
    materials:       'MATERIAAL',
    phases:          'LESFASES',
    teacherActions:  'Onderwyser doen',
    learnerActions:  'Leerders doen',
    questionsToAsk:  'Vrae om te vra',
    worksheetCue:    '→ Leerders voltooi die aangehegte werkblad gedurende hierdie fase.',
    differentiation: 'DIFFERENSIASIE',
    diffBelow:       'Onder graad',
    diffOnGrade:     'Op graad',
    diffAbove:       'Bo graad',
    homework:        'HUISWERK',
    teacherNotes:    'ONDERWYSER-NOTAS',
    worksheetHeader: 'LEERDERWERKBLAD — BEGIN OP DIE VOLGENDE BLADSY',
    sourceLabel:     'Bron',
  },
};

function lessonLabels(language) {
  return LESSON_LABELS[language] || LESSON_LABELS.English;
}

function bullet(text, opts = {}) {
  return new Paragraph({
    children: [txt(`•  ${text}`, { size: opts.size || 22 })],
    indent: { left: opts.left ?? 360 },
    spacing: { after: opts.after ?? 40 },
  });
}

function renderLessonHeader(resource, LL) {
  const els = [];
  els.push(para('THE RESOURCE ROOM', {
    bold: true, size: 22, color: GREEN, align: AlignmentType.CENTER, spaceAfter: 40,
  }));
  els.push(para(LL.title, {
    bold: true, size: 36, align: AlignmentType.CENTER, spaceAfter: 60,
  }));
  els.push(para(resource.cover.subjectLine, {
    bold: true, size: 26, align: AlignmentType.CENTER, spaceAfter: 40,
  }));
  els.push(para(`${resource.cover.gradeLine}  |  ${resource.cover.termLine}`, {
    size: 22, align: AlignmentType.CENTER, spaceAfter: 200,
  }));
  return els;
}

function renderLessonAnchor(resource, LL) {
  const els = [];
  const lesson = resource.lesson || {};
  const anchor = lesson.capsAnchor || {};
  els.push(para(LL.capsAnchor, { bold: true, size: 24, color: GREEN, spaceBefore: 80, spaceAfter: 80 }));
  if (anchor.unitTopic) {
    els.push(para(anchor.unitTopic, { bold: true, size: 22, spaceAfter: 40 }));
  }
  if (anchor.capsStrand) {
    const strandLine = anchor.subStrand
      ? `${LL.strand}: ${anchor.capsStrand} / ${anchor.subStrand}`
      : `${LL.strand}: ${anchor.capsStrand}`;
    els.push(para(strandLine, { size: 20, color: GREY, spaceAfter: 30 }));
  }
  if (anchor.weekRange) {
    els.push(para(`${LL.weeks}: ${anchor.weekRange}`, { size: 20, color: GREY, spaceAfter: 30 }));
  }
  if (lesson.lessonMinutes) {
    els.push(para(`${LL.minutes}: ${lesson.lessonMinutes} ${LL.minutesUnit}`, { size: 20, color: GREY, spaceAfter: 30 }));
  }
  if (anchor.sourcePdf) {
    const pageSuffix = anchor.sourcePage ? `, p. ${anchor.sourcePage}` : '';
    els.push(para(`${LL.sourceLabel}: ${anchor.sourcePdf}${pageSuffix}`, {
      size: 18, color: GREY, italics: true, spaceAfter: 80,
    }));
  }
  els.push(blank(80));
  return els;
}

function renderLessonObjectives(resource, LL) {
  const els = [];
  const objectives = resource.lesson?.learningObjectives || [];
  if (objectives.length === 0) return els;
  els.push(para(LL.objectives, { bold: true, size: 24, color: GREEN, spaceBefore: 120, spaceAfter: 60 }));
  els.push(para(LL.objectivesIntro, { italics: true, spaceAfter: 60 }));
  for (const obj of objectives) els.push(bullet(obj));
  els.push(blank(80));
  return els;
}

function renderLessonPriorKnowledge(resource, LL) {
  const els = [];
  const items = resource.lesson?.priorKnowledge || [];
  if (items.length === 0) return els;
  els.push(para(LL.priorKnowledge, { bold: true, size: 22, color: GREEN, spaceBefore: 80, spaceAfter: 60 }));
  for (const it of items) els.push(bullet(it));
  els.push(blank(60));
  return els;
}

function renderLessonVocabulary(resource, LL) {
  const els = [];
  const vocab = resource.lesson?.vocabulary || [];
  if (vocab.length === 0) return els;
  els.push(para(LL.vocabulary, { bold: true, size: 22, color: GREEN, spaceBefore: 80, spaceAfter: 60 }));
  for (const v of vocab) {
    els.push(new Paragraph({
      children: [
        txt(`•  ${v.term}`, { bold: true }),
        txt(` — ${v.definition}`),
      ],
      indent: { left: 360 },
      spacing: { after: 40 },
    }));
  }
  els.push(blank(60));
  return els;
}

function renderLessonMaterials(resource, LL) {
  const els = [];
  const items = resource.lesson?.materials || [];
  if (items.length === 0) return els;
  els.push(para(LL.materials, { bold: true, size: 22, color: GREEN, spaceBefore: 80, spaceAfter: 60 }));
  for (const it of items) els.push(bullet(it));
  els.push(blank(60));
  return els;
}

// Names CAPS uses for the phase where learners do the worksheet. Used as a
// fallback when no phase has worksheetRef:true — Sonnet 4.6 reliably drops
// that field, so we infer instead. Both EN and AF labels are matched.
const WORKSHEET_PHASE_NAMES = new Set([
  'Independent Work', 'Onafhanklike Werk',
]);

/** Decide which phase index (0-based) is the worksheet phase. Prefers the
 *  explicit worksheetRef:true marker; falls back to a name match; finally
 *  falls back to phase #4 (the prompt-prescribed slot). */
function pickWorksheetPhaseIndex(phases) {
  if (!Array.isArray(phases) || phases.length === 0) return -1;
  const explicit = phases.findIndex((p) => p?.worksheetRef === true);
  if (explicit !== -1) return explicit;
  const byName = phases.findIndex((p) => WORKSHEET_PHASE_NAMES.has(p?.name));
  if (byName !== -1) return byName;
  return Math.min(3, phases.length - 1);  // CAPS-conventional slot
}

function renderLessonPhase(phase, LL, isWorksheetPhase) {
  const els = [];
  const heading = `${phase.name}  (${phase.minutes} ${LL.minutesUnit})`;
  els.push(para(heading, { bold: true, size: 22, color: GREEN, spaceBefore: 120, spaceAfter: 40 }));

  if (Array.isArray(phase.teacherActions) && phase.teacherActions.length) {
    els.push(para(`${LL.teacherActions}:`, { bold: true, size: 20, spaceAfter: 30 }));
    for (const a of phase.teacherActions) els.push(bullet(a, { size: 20 }));
  }
  if (Array.isArray(phase.learnerActions) && phase.learnerActions.length) {
    els.push(para(`${LL.learnerActions}:`, { bold: true, size: 20, spaceBefore: 40, spaceAfter: 30 }));
    for (const a of phase.learnerActions) els.push(bullet(a, { size: 20 }));
  }
  if (Array.isArray(phase.questionsToAsk) && phase.questionsToAsk.length) {
    els.push(para(`${LL.questionsToAsk}:`, { bold: true, size: 20, spaceBefore: 40, spaceAfter: 30 }));
    for (const q of phase.questionsToAsk) els.push(bullet(q, { size: 20 }));
  }
  if (isWorksheetPhase) {
    els.push(para(LL.worksheetCue, {
      italics: true, size: 20, color: GREEN, spaceBefore: 40, spaceAfter: 40,
    }));
  }
  els.push(blank(40));
  return els;
}

function renderLessonPhases(resource, LL) {
  const els = [];
  const phases = resource.lesson?.phases || [];
  if (phases.length === 0) return els;
  const worksheetIdx = pickWorksheetPhaseIndex(phases);
  els.push(para(LL.phases, { bold: true, size: 24, color: GREEN, spaceBefore: 120, spaceAfter: 80 }));
  phases.forEach((p, i) => {
    els.push(...renderLessonPhase(p, LL, i === worksheetIdx));
  });
  return els;
}

function renderLessonDifferentiation(resource, LL) {
  const els = [];
  const diff = resource.lesson?.differentiation;
  if (!diff) return els;
  const sections = [
    [diff.below, LL.diffBelow],
    [diff.onGrade, LL.diffOnGrade],
    [diff.above, LL.diffAbove],
  ].filter(([items]) => Array.isArray(items) && items.length > 0);
  if (sections.length === 0) return els;
  els.push(para(LL.differentiation, { bold: true, size: 22, color: GREEN, spaceBefore: 120, spaceAfter: 60 }));
  for (const [items, label] of sections) {
    els.push(para(`${label}:`, { bold: true, size: 20, spaceBefore: 40, spaceAfter: 30 }));
    for (const it of items) els.push(bullet(it, { size: 20 }));
  }
  els.push(blank(60));
  return els;
}

function renderLessonHomework(resource, LL) {
  const els = [];
  const hw = resource.lesson?.homework;
  if (!hw?.description) return els;
  els.push(para(LL.homework, { bold: true, size: 22, color: GREEN, spaceBefore: 80, spaceAfter: 60 }));
  els.push(para(hw.description, { size: 22, spaceAfter: 30 }));
  if (hw.estimatedMinutes) {
    els.push(para(`(${hw.estimatedMinutes} ${LL.minutesUnit})`, {
      italics: true, size: 18, color: GREY, spaceAfter: 60,
    }));
  }
  els.push(blank(40));
  return els;
}

function renderLessonTeacherNotes(resource, LL) {
  const els = [];
  const notes = resource.lesson?.teacherNotes || [];
  if (notes.length === 0) return els;
  els.push(para(LL.teacherNotes, { bold: true, size: 22, color: GREEN, spaceBefore: 80, spaceAfter: 60 }));
  for (const n of notes) els.push(bullet(n));
  els.push(blank(60));
  return els;
}

function buildLessonPlanContent(resource, L) {
  const LL = lessonLabels(resource.meta.language);
  const els = [];
  els.push(...renderLessonHeader(resource, LL));
  els.push(...renderLessonAnchor(resource, LL));
  els.push(...renderLessonObjectives(resource, LL));
  els.push(...renderLessonPriorKnowledge(resource, LL));
  els.push(...renderLessonVocabulary(resource, LL));
  els.push(...renderLessonMaterials(resource, LL));
  els.push(...renderLessonPhases(resource, LL));
  els.push(...renderLessonDifferentiation(resource, LL));
  els.push(...renderLessonHomework(resource, LL));
  els.push(...renderLessonTeacherNotes(resource, LL));

  // Cue the teacher that the worksheet starts on the next page.
  els.push(para(LL.worksheetHeader, {
    bold: true, size: 20, color: GREEN, align: AlignmentType.CENTER,
    spaceBefore: 200, spaceAfter: 60,
  }));
  return els;
}

function buildPaperContent(resource, L) {
  const els = [];

  els.push(...renderCover(resource));
  els.push(new Paragraph({ children: [new PageBreak()] }));

  const renderedStimuli = new Set();
  const stimulusById = new Map((resource.stimuli || []).map((s) => [s.id, s]));

  for (const section of resource.sections) {
    for (const ref of section.stimulusRefs || []) {
      if (renderedStimuli.has(ref)) continue;
      const st = stimulusById.get(ref);
      if (st) {
        els.push(...renderStimulus(st));
        renderedStimuli.add(ref);
      }
    }
    for (const q of section.questions) collectQuestionStimulusRefs(q, stimulusById, renderedStimuli, els);
    els.push(...renderSection(section, L));
  }

  els.push(para(`${L.totalLabel}: ${resource.meta.totalMarks} ${L.marksWord}`, {
    bold: true, size: 26, color: GREEN, align: AlignmentType.RIGHT, spaceBefore: 240,
  }));

  return els;
}

function buildDocument(resource, L, children) {
  return new Document({
    creator: 'The Resource Room',
    title: `${resource.cover.subjectLine} — ${resource.cover.gradeLine} ${resource.cover.termLine}`,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } },
      headers: {
        default: new Header({
          children: [para('THE RESOURCE ROOM', { size: 16, color: GREY, align: AlignmentType.RIGHT })],
        }),
      },
      footers: {
        default: new Footer({
          children: [para(
            `© The Resource Room  |  CAPS ${resource.cover.gradeLine} ${resource.cover.termLine}  |  ${resource.cover.subjectLine}`,
            { size: 16, color: GREY, align: AlignmentType.CENTER },
          )],
        }),
      },
      children,
    }],
  });
}

function collectQuestionStimulusRefs(q, stimulusById, rendered, els) {
  if (q.stimulusRef && !rendered.has(q.stimulusRef)) {
    const st = stimulusById.get(q.stimulusRef);
    if (st) {
      els.push(...renderStimulus(st));
      rendered.add(q.stimulusRef);
    }
  }
  if (Array.isArray(q.subQuestions)) {
    q.subQuestions.forEach((sq) => collectQuestionStimulusRefs(sq, stimulusById, rendered, els));
  }
}

// ─────────────────────────────────────────────────────────────────
// LESSON WORKSHEET (kid-mode) RENDERING
//
// Applied only when meta.resourceType === 'Lesson'. The shape of the
// content tracks the formal renderer one-to-one (cover → stimuli →
// sections of questions → totals/self-assess) but the visual language is
// markedly softer:
//
//   • Friendly title ("Time to practice") instead of "WORKSHEET"
//   • Single-line Name/Date strip, no learner-info table, no instructions
//     block (those belong on a test paper, not a practice sheet)
//   • SECTION A: / SECTION B: headings dropped — Lesson worksheets are
//     usually one section anyway and the kid doesn't need that frame
//   • Accent-coloured question-number badges that cycle through the
//     grade-band's accent rotation, instead of "1.1, 1.2, 1.3"
//   • Dotted answer lines instead of solid underscore strings
//   • Soft "5 pts" pill (right-aligned, accent-coloured) instead of "[5]"
//   • Self-assessment row with three labelled face-cells at the end
//
// The renderer is gated on a `style` object from pickLessonStyle({ ... })
// — Tests/Exams/standalone Worksheets pass through the existing formal
// path with byte-identical output.
// ─────────────────────────────────────────────────────────────────

function dottedAnswerLine({ left = 900, after = 100 } = {}) {
  // A real dotted bottom border on an otherwise empty paragraph. The
  // single space TextRun guarantees the paragraph has a non-zero height
  // so the border has somewhere to sit; without it some Word renderers
  // collapse the paragraph to zero pixels.
  return new Paragraph({
    children: [new TextRun({ text: ' ', font: FONT, size: 22 })],
    indent: { left },
    spacing: { after, line: 280 },
    border: { bottom: { style: BorderStyle.DOTTED, size: 6, color: 'BBBBBB', space: 4 } },
  });
}

function markPill(marks, L, accentColor) {
  // Right-aligned single-row table whose right cell is a shaded "5 pts"
  // pill. A tighter visual treatment than the formal "[5]" mark bracket.
  const text = `${marks} ${L.lesson.marksUnit}`;
  const wide = new TableCell({
    borders: noBorders,
    width: { size: 7800, type: WidthType.DXA },
    children: [new Paragraph({ children: [txt('')] })],
  });
  const pill = new TableCell({
    borders: noBorders,
    width: { size: 1226, type: WidthType.DXA },
    shading: { type: ShadingType.SOLID, color: accentColor, fill: accentColor },
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({
      children: [txt(text, { bold: true, size: 18, color: 'FFFFFF' })],
      alignment: AlignmentType.CENTER,
    })],
  });
  return new Table({
    width: { size: 9026, type: WidthType.DXA },
    columnWidths: [7800, 1226],
    rows: [new TableRow({ children: [wide, pill] })],
  });
}

function renderLessonCover(resource, L, style) {
  const els = [];
  const LL = L.lesson;
  const heroAccent = nthAccent(style, 0);

  // Try to render a hero illustration (mascot on junior, subject icon on
  // senior). The raster path needs the vendored Inter fonts; if it fails
  // for any reason, we fall back to the text-only cover so generation
  // never breaks just because an illustration couldn't render.
  let heroPng = null;
  try {
    const hero = pickHero({
      subject:   resource.meta.subject,
      gradeBand: style.gradeBand,
      accent:    `#${heroAccent}`,
    });
    heroPng = illustrationToPng(hero.svg, { widthPx: 480 });
  } catch {
    heroPng = null;
  }

  if (heroPng) {
    // 2-column borderless layout: text on the left, hero illustration on
    // the right. Mirrors the same pattern as renderCover()'s learner-info
    // table — borderless cells using TableCell with explicit widths.
    const textCellChildren = [
      para('THE RESOURCE ROOM', {
        bold: true, size: 18, color: style.palette.green,
        align: AlignmentType.LEFT, spaceAfter: 60,
      }),
      para(LL.worksheetTitle, {
        bold: true, size: 44, color: heroAccent,
        align: AlignmentType.LEFT, spaceAfter: 80,
      }),
      para(`${resource.cover.subjectLine}  ·  ${resource.cover.gradeLine}  ${resource.cover.termLine}`, {
        size: 24, align: AlignmentType.LEFT, spaceAfter: 60,
      }),
      para(LL.greeting, {
        italics: true, size: 22, color: style.palette.inkSoft,
        align: AlignmentType.LEFT, spaceAfter: 0,
      }),
    ];

    // Mascot is taller than wide; subject icons are square. Square embed
    // works for both because the SVGs are designed in their own viewBox
    // and the docx ImageRun aspect ratio is respected by Word.
    const imgW = 140;
    const imgH = style.gradeBand === 'junior' ? 182 : 140;   // mascot is 100×130
    const imageCellChildren = [
      new Paragraph({
        children: [new ImageRun({
          data: heroPng,
          transformation: { width: imgW, height: imgH },
        })],
        alignment: AlignmentType.CENTER,
      }),
    ];

    els.push(new Table({
      width: { size: 9026, type: WidthType.DXA },
      columnWidths: [6400, 2626],
      rows: [new TableRow({ children: [
        new TableCell({
          borders: noBorders,
          width: { size: 6400, type: WidthType.DXA },
          children: textCellChildren,
          margins: { top: 0, bottom: 0, left: 0, right: 240 },
        }),
        new TableCell({
          borders: noBorders,
          width: { size: 2626, type: WidthType.DXA },
          children: imageCellChildren,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        }),
      ] })],
    }));
    els.push(blank(240));
  } else {
    // Text-only fallback (raster pipeline unavailable / fonts missing)
    els.push(para('THE RESOURCE ROOM', {
      bold: true, size: 18, color: style.palette.green,
      align: AlignmentType.CENTER, spaceAfter: 60,
    }));
    els.push(para(LL.worksheetTitle, {
      bold: true, size: 44, color: heroAccent,
      align: AlignmentType.CENTER, spaceAfter: 80,
    }));
    els.push(para(`${resource.cover.subjectLine}  ·  ${resource.cover.gradeLine}  ${resource.cover.termLine}`, {
      size: 24, align: AlignmentType.CENTER, spaceAfter: 60,
    }));
    els.push(para(LL.greeting, {
      italics: true, size: 22, color: style.palette.inkSoft,
      align: AlignmentType.CENTER, spaceAfter: 240,
    }));
  }

  // Single-line Name + Date strip — no formal learner-info table.
  els.push(para(
    `${LL.nameLabel}: _______________________________     ${LL.dateLabel}: __________________`,
    { size: 22, spaceAfter: 200 },
  ));
  return els;
}

function renderLessonAnswerSpace(q, { left = 900 } = {}) {
  const els = [];
  const space = q.answerSpace || { kind: 'lines', lines: 2 };

  switch (space.kind) {
    case 'options': {
      for (const opt of q.options || []) {
        els.push(new Paragraph({
          children: [txt(`${opt.label.toUpperCase()}.  `, { bold: true }), ...richRuns(opt.text)],
          indent: { left: 1200 },
          spacing: { after: 40 },
        }));
      }
      break;
    }
    case 'workingPlusAnswer': {
      els.push(new Paragraph({
        children: [txt('Working:', { bold: true, size: 20 })],
        indent: { left }, spacing: { before: 40, after: 30 },
      }));
      els.push(dottedAnswerLine({ left }));
      els.push(dottedAnswerLine({ left }));
      els.push(new Paragraph({
        children: [txt('Answer:', { bold: true, size: 20 })],
        indent: { left }, spacing: { before: 40, after: 30 },
      }));
      els.push(dottedAnswerLine({ left }));
      break;
    }
    case 'lines': {
      const n = Math.max(1, space.lines || 2);
      for (let i = 0; i < n; i++) els.push(dottedAnswerLine({ left }));
      break;
    }
    case 'inlineBlank':
    case 'none':
      break;
    case 'table': {
      const headers = space.columns?.headers && space.columns.headers.length > 0
        ? space.columns.headers
        : ['Answer'];
      const rows = Math.max(1, space.rows || 4);
      const blankRow = headers.map(() => '');
      const allRows = Array.from({ length: rows }, () => blankRow);
      els.push(renderTable(headers, allRows));
      break;
    }
  }
  return els;
}

function renderLessonQuestion(q, ctx) {
  const { depth, style, L, accentIdx } = ctx;
  const els = [];
  const isComposite = Array.isArray(q.subQuestions);
  const accent = nthAccent(style, accentIdx) || style.palette.green;
  const multipart = !isComposite ? splitMultipartStem(q) : null;
  const headerStem = multipart ? multipart.preamble : (q.stem || '');

  // Question number → accent-coloured "badge" via run-level shading.
  // Word renderers that ignore run shading still get a bold accent number,
  // which is itself a softer alternative to the formal black-bold "1.1".
  const badge = new TextRun({
    text: `  ${q.number}  `,
    font: FONT,
    size: 22,
    bold: true,
    color: 'FFFFFF',
    shading: { type: ShadingType.SOLID, color: accent, fill: accent },
  });
  els.push(new Paragraph({
    children: [badge, new TextRun({ text: '  ', font: FONT }), ...richRuns(headerStem)],
    tabStops: [{ type: TabStopType.LEFT, position: 900 }],
    indent: { left: 900, hanging: 900 },
    spacing: { before: depth === 0 ? 220 : 120, after: 60 },
  }));

  if (isComposite) {
    q.subQuestions.forEach((sub, i) => {
      els.push(...renderLessonQuestion(sub, {
        ...ctx, depth: depth + 1, accentIdx: accentIdx + 1 + i,
      }));
    });
    return els;
  }

  if (multipart) {
    const linesPerPart = Math.max(1, q.answerSpace?.lines || 2);
    for (const part of multipart.parts) {
      els.push(new Paragraph({
        children: [txt(`(${part.label}) `, { bold: true }), ...richRuns(part.text)],
        indent: { left: 900 },
        spacing: { before: 80, after: 40 },
      }));
      for (let i = 0; i < linesPerPart; i++) els.push(dottedAnswerLine({ left: 900 }));
    }
    els.push(markPill(q.marks, L, accent));
    return els;
  }

  els.push(...renderLessonAnswerSpace(q, { left: 900 }));
  els.push(markPill(q.marks, L, accent));
  return els;
}

function renderLessonSection(section, L, style, baseAccentIdx) {
  const els = [];
  // No "SECTION A:" heading. A short italic intro from section.instructions
  // is kept (it's where teachers put "Try these on your own" type prompts).
  if (section.instructions) {
    els.push(para(section.instructions, {
      italics: true, color: style.palette.inkSoft, spaceAfter: 120,
    }));
  }
  section.questions.forEach((q, i) => {
    els.push(...renderLessonQuestion(q, {
      depth: 0, style, L, accentIdx: baseAccentIdx + i,
    }));
  });
  return els;
}

function renderSelfAssessRow(L, style) {
  const els = [];
  const LL = L.lesson;
  const labels = LL.selfAssessFaces || ['Easy', 'OK', 'Tricky'];
  const faces = [':)', ':|', ':('];   // ASCII variants — universal across fonts
  const colours = [
    style.palette.accents.mint,    // easy → calm green
    style.palette.accents.sky,     // ok   → neutral blue
    style.palette.accents.coral,   // tricky → warm coral
  ];

  els.push(para(LL.selfAssess, {
    bold: true, size: 22, color: style.palette.green,
    align: AlignmentType.CENTER, spaceBefore: 240, spaceAfter: 80,
  }));

  const cellWidth = 3000;
  const cells = faces.map((face, i) => new TableCell({
    width: { size: cellWidth, type: WidthType.DXA },
    borders: cellBorders,
    margins: { top: 120, bottom: 120, left: 80, right: 80 },
    shading: { type: ShadingType.SOLID, color: colours[i], fill: colours[i] },
    children: [
      new Paragraph({
        children: [txt(face, { size: 36, bold: true, color: 'FFFFFF' })],
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({
        children: [txt(labels[i] || '', { size: 20, bold: true, color: 'FFFFFF' })],
        alignment: AlignmentType.CENTER,
      }),
    ],
  }));
  els.push(new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [cellWidth, cellWidth, cellWidth],
    rows: [new TableRow({ children: cells })],
  }));
  return els;
}

function buildLessonWorksheetContent(resource, L, style) {
  const els = [];
  els.push(...renderLessonCover(resource, L, style));

  const renderedStimuli = new Set();
  const stimulusById = new Map((resource.stimuli || []).map((s) => [s.id, s]));

  let accentBase = 0;
  for (const section of resource.sections) {
    for (const ref of section.stimulusRefs || []) {
      if (renderedStimuli.has(ref)) continue;
      const st = stimulusById.get(ref);
      if (st) { els.push(...renderStimulus(st)); renderedStimuli.add(ref); }
    }
    for (const q of section.questions) {
      collectQuestionStimulusRefs(q, stimulusById, renderedStimuli, els);
    }
    els.push(...renderLessonSection(section, L, style, accentBase));
    accentBase += section.questions.length;
  }

  els.push(...renderSelfAssessRow(L, style));
  return els;
}

// Exposed for tests / other renderers.
export const __internals = {
  txt, para, richRuns, splitMultipartStem, sectionHead, sumLeafMarks, renderTable,
  renderStimulus, renderQuestion, renderMemoAnswers, renderCogAnalysis, renderRubric,
  renderExtension, buildMemoContent, tallyByLevel, localiseCogLevel,
  buildLessonPlanContent, lessonLabels, pickWorksheetPhaseIndex, WORKSHEET_PHASE_NAMES,
  // Lesson kid-mode helpers
  buildLessonWorksheetContent, renderLessonCover, renderLessonSection,
  renderLessonQuestion, renderLessonAnswerSpace, renderSelfAssessRow,
  dottedAnswerLine, markPill,
};
