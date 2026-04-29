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
  });
}

function para(content, opts = {}) {
  const children = typeof content === 'string' ? [txt(content, opts)] : content;
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
      if (stimulus.table) els.push(renderTable(stimulus.table.headers, stimulus.table.rows));
      else if (stimulus.description) els.push(para(stimulus.description));
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
  const headerRow = new TableRow({
    children: headers.map((h) => new TableCell({
      children: [new Paragraph({ children: [txt(h, { size: 18, bold: true, color: 'FFFFFF' })] })],
      shading: { fill: GREEN, type: ShadingType.SOLID },
      borders: cellBorders,
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
    })),
  });
  const dataRows = rows.map((r) => new TableRow({
    children: r.map((c) => new TableCell({
      children: [new Paragraph({ children: [txt(c, { size: 18 })] })],
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
  const heading = section.letter
    ? `SECTION ${section.letter}: ${section.title}  (${sectionMarks} ${L.marksWord})`
    : `${section.title}  (${sectionMarks} ${L.marksWord})`;
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

  // Number + stem on a single paragraph; mark bracket on the next line for leaves.
  const stemRun = [
    txt(q.number, { bold: true }),
    new TextRun({ text: '\t', font: FONT }),
    txt(q.stem || ''),
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

  // Leaf — render the answer space in the same indent as the stem body.
  els.push(...renderAnswerSpace(q));
  els.push(markBracket(q.marks));

  return els;
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
            txt(opt.text),
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
      const headers = space.columns?.headers || [];
      const rows = space.rows || 4;
      const blankRow = headers.map(() => '');
      const allRows = Array.from({ length: rows }, () => blankRow);
      if (headers.length > 0) els.push(renderTable(headers, allRows));
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
      children: c.split('\n').map((line) => new Paragraph({ children: [txt(line, { size: 18 })] })),
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

  // Answers table
  els.push(renderMemoAnswers(resource, L));
  els.push(blank(160));

  // Cog analysis
  const labels = cogTableLabels(L, resource.meta.cognitiveFramework.name);
  els.push(sectionHead(labels.heading));
  els.push(renderCogAnalysis(resource, L));
  els.push(blank(160));

  // Rubric (optional)
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
  const paper = buildPaperContent(resource, L);
  paper.push(new Paragraph({ children: [new PageBreak()] }));
  return buildDocument(resource, L, [...paper, ...buildMemoContent(resource, L)]);
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

// Exposed for tests / other renderers.
export const __internals = {
  txt, para, sectionHead, sumLeafMarks, renderTable, renderStimulus, renderQuestion,
  renderMemoAnswers, renderCogAnalysis, renderRubric, renderExtension, buildMemoContent,
  tallyByLevel, localiseCogLevel,
};
