// DOCX rendering for a resource pack.
//
// Exports a factory createDocxBuilder(config) that returns a buildDoc(qText,
// mText, actualMarks) function. The config captures everything derived from
// the request so the returned function only needs the AI-generated text.
//
// All DOCX styling, cover-page composition, and text-to-paragraph parsing
// live here; the pipeline keeps orchestration logic only.

import {
  Document, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, HeightRule, WidthType, TabStopType,
  ShadingType, Header, Footer,
} from 'docx';

import { i18n, resourceTypeLabel, subjectDisplayName, localiseDuration } from './i18n.js';
import { marksToTime } from './cognitive.js';

const FONT = 'Arial';
const GREEN = '085041';
const BLANK_LINE = '_______________________________________________';

const bdr = { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' };
const cellBorders = { top: bdr, bottom: bdr, left: bdr, right: bdr };

// ─────────────────────────────────────────────────────────
// PIPE-TABLE PARSING
// Exported as pure helpers so unit tests can cover them without booting
// the whole DOCX builder. A row like "| Term | Meaning |" has 3 pipes,
// yielding 4 split parts including leading + trailing empties.
// "Answer table" rows like "| 15° | |" are valid table rows — the empty
// cell is intentional writing space — but they only have 1 non-empty
// cell, so the old ">= 2 non-empty cells" test wrongly rejected them.
// ─────────────────────────────────────────────────────────

function stripMarkdownBold(s) {
  return s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*\*/g, '');
}

/** Split a pipe-style table row into trimmed cells, preserving empty
 *  middle cells. Leading/trailing empties from the outer pipes are dropped. */
export function parseTableRow(line) {
  const parts = String(line).split('|').map((c) => c.trim());
  if (parts.length && parts[0] === '') parts.shift();
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts.map(stripMarkdownBold);
}

/** True when a line looks like a pipe-table row (at least 2 cells after
 *  stripping the outer empty slots — empty cells in the middle count). */
export function isTableRow(line) {
  if (!String(line).includes('|')) return false;
  return parseTableRow(line).length >= 2;
}

/**
 * Build a DOCX builder configured for a single request.
 *
 * @param {object} config
 * @param {string} config.subject        Canonical (English) subject name.
 * @param {string} config.resourceType   'Test' / 'Exam' / 'Worksheet' / …
 * @param {string} config.language       'English' | 'Afrikaans'
 * @param {number} config.grade          4–7
 * @param {number} config.term           1–4
 * @param {number} config.totalMarks     Requested total marks.
 * @param {boolean} config.isWorksheet   True when building a worksheet cover.
 */
export function createDocxBuilder(config) {
  const { subject, resourceType, language, grade, term, totalMarks, isWorksheet } = config;
  const L = i18n(language);
  const displaySubject = subjectDisplayName(subject, language);
  const timeAllocation = localiseDuration(marksToTime(totalMarks), language);

  function txt(text, opts = {}) {
    return new TextRun({
      text: String(text),
      font: FONT,
      size: opts.size || 22,
      bold: !!opts.bold,
      color: opts.color || '000000',
      italics: !!opts.italics,
    });
  }

  function para(content, opts = {}) {
    const children = typeof content === 'string' ? [txt(content, opts)] : content;
    return new Paragraph({
      children,
      spacing: { before: opts.spaceBefore || 0, after: opts.spaceAfter || 60 },
      alignment: opts.align || AlignmentType.LEFT,
      indent: opts.indent,
      tabStops: opts.tabStops,
    });
  }

  function sectionHead(text) {
    return para(text, { bold: true, size: 26, color: GREEN, spaceBefore: 300, spaceAfter: 120 });
  }

  function questionHead(text) {
    return new Paragraph({
      children: [txt(text, { bold: true, size: 24 })],
      spacing: { before: 240, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } },
    });
  }

  function numQ(num, text) {
    return new Paragraph({
      children: [txt(num, { bold: true }), new TextRun({ text: '\t', font: FONT }), txt(text)],
      tabStops: [{ type: TabStopType.LEFT, position: 900 }],
      indent: { left: 900, hanging: 900 },
      spacing: { before: 120, after: 40 },
    });
  }

  function optLine(text) {
    return para(text, { indent: { left: 1200 }, spaceAfter: 20 });
  }

  function blankLine() {
    return para(BLANK_LINE, { indent: { left: 900 }, spaceAfter: 80 });
  }

  function workLine() {
    return para(
      [txt('Working: ', { bold: true, size: 20 }), txt(BLANK_LINE, { size: 20 })],
      { indent: { left: 900 }, spaceAfter: 20 },
    );
  }

  function ansLine() {
    return para(
      [txt('Answer: ', { bold: true, size: 20 }), txt(BLANK_LINE, { size: 20 })],
      { indent: { left: 900 }, spaceAfter: 80 },
    );
  }

  function cell(text, opts = {}) {
    return new TableCell({
      children: [new Paragraph({
        children: [txt(String(text), { size: opts.size || 18, bold: !!opts.bold, color: opts.color || '000000' })],
        alignment: opts.align || AlignmentType.LEFT,
      })],
      width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
      shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
      borders: cellBorders,
    });
  }

  function tbl(headers, rows) {
    const hRow = new TableRow({
      children: headers.map((h) => new TableCell({
        children: [new Paragraph({ children: [txt(String(h), { size: 18, bold: true, color: 'FFFFFF' })], alignment: AlignmentType.LEFT })],
        shading: { fill: GREEN, type: ShadingType.SOLID },
        borders: cellBorders,
        margins: { top: 60, bottom: 60, left: 120, right: 120 },
      })),
    });
    // Answer-table rows (any cell is empty) get a generous minimum height
    // so the learner has room to write. 1000 twips ≈ 0.7 inch per row.
    // Data rows with content everywhere (e.g. the cog-level analysis table)
    // keep their natural height.
    const dRows = rows.map((r) => {
      const hasEmpty = r.some((c) => !c || !String(c).trim());
      return new TableRow({
        height: hasEmpty ? { value: 1000, rule: HeightRule.ATLEAST } : undefined,
        children: r.map((c) => cell(c)),
      });
    });
    return new Table({ rows: [hRow, ...dRows], width: { size: 9026, type: WidthType.DXA } });
  }

  // ─────────────────────────────────────────────────────────
  // COVER PAGE
  // ─────────────────────────────────────────────────────────
  function buildCover(actualMarks) {
    const displayMarks = actualMarks || totalMarks;
    const els = [];

    els.push(para('THE RESOURCE ROOM', { bold: true, size: 28, color: GREEN, align: AlignmentType.CENTER, spaceAfter: 60 }));
    els.push(para(resourceTypeLabel(resourceType, language), { bold: true, size: 36, align: AlignmentType.CENTER, spaceAfter: 60 }));
    els.push(para(displaySubject, { bold: true, size: 28, align: AlignmentType.CENTER, spaceAfter: 160 }));

    const noBorder = { style: BorderStyle.NIL, size: 0, color: 'FFFFFF' };
    const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

    els.push(new Table({
      width: { size: 9026, type: WidthType.DXA }, columnWidths: [4513, 4513],
      rows: [new TableRow({ children: [
        new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt(L.grade + ' ' + grade, { size: 24, bold: true })] })] }),
        new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt(L.term + ' ' + term, { size: 24, bold: true })], alignment: AlignmentType.RIGHT })] }),
      ]})],
    }));
    els.push(para('', { spaceAfter: 60 }));

    els.push(new Table({
      width: { size: 9026, type: WidthType.DXA }, columnWidths: [4513, 4513],
      rows: [
        new TableRow({ children: [
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt(L.name + ': ___________________________', { size: 22 })] })] }),
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt(L.date + ': ___________________', { size: 22 })], alignment: AlignmentType.RIGHT })] }),
        ]}),
        new TableRow({ children: [
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt(L.surname + ': ________________________', { size: 22 })] })] }),
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('', { size: 22 })] })] }),
        ]}),
      ],
    }));
    els.push(para('', { spaceAfter: 40 }));

    if (!isWorksheet) {
      els.push(new Table({
        width: { size: 9026, type: WidthType.DXA }, columnWidths: [4513, 4513],
        rows: [new TableRow({ children: [
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt(L.examiner + ': ______________________', { size: 22 })] })] }),
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt(L.time + ': ' + timeAllocation, { size: 22, bold: true })], alignment: AlignmentType.RIGHT })] }),
        ]})],
      }));
      els.push(para('', { spaceAfter: 80 }));
    }

    const scoreBdr = { style: BorderStyle.SINGLE, size: 4, color: '085041' };
    const scoreBorders = { top: scoreBdr, bottom: scoreBdr, left: scoreBdr, right: scoreBdr };
    const colW = [3611, 1805, 1805, 1805];
    const cm = (w, children, align) => new TableCell({
      borders: scoreBorders,
      width: { size: w, type: WidthType.DXA },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children, alignment: align || AlignmentType.LEFT })],
    });
    els.push(new Table({
      width: { size: 9026, type: WidthType.DXA }, columnWidths: colW,
      rows: [
        new TableRow({ children: [
          cm(colW[0], [txt(L.total, { bold: true, size: 20 })]),
          cm(colW[1], [txt(String(displayMarks), { bold: true, size: 20 })], AlignmentType.CENTER),
          cm(colW[2], [txt('%', { bold: true, size: 20 })], AlignmentType.CENTER),
          cm(colW[3], [txt(L.code, { bold: true, size: 20 })], AlignmentType.CENTER),
        ]}),
        new TableRow({ children: [
          cm(colW[0], [txt(L.comments + ':', { bold: true, size: 18 })]),
          new TableCell({
            borders: scoreBorders,
            columnSpan: 3,
            width: { size: colW[1] + colW[2] + colW[3], type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [txt('', { size: 18 })] })],
          }),
        ]}),
      ],
    }));
    els.push(para('', { spaceAfter: 120 }));

    els.push(new Paragraph({ children: [txt(L.instructions + ':', { bold: true, size: 22 })], spacing: { before: 0, after: 60 } }));
    for (const item of L.instructionItems) {
      els.push(new Paragraph({ children: [txt('•  ' + item, { size: 22 })], indent: { left: 360 }, spacing: { before: 0, after: 40 } }));
    }
    els.push(para('', { spaceAfter: 160 }));
    return els;
  }

  // ─────────────────────────────────────────────────────────
  // TEXT → DOCX ELEMENTS
  // Each rule matches a line pattern that Claude (or the post-processing
  // helpers) emits, and turns it into the right DOCX paragraph/table.
  // ─────────────────────────────────────────────────────────
  function parseText(text) {
    const lines = text.split('\n');
    const els = [];
    for (let i = 0; i < lines.length; i++) {
      let tr = lines[i].trim();
      if (!tr) { els.push(para('', { spaceAfter: 40 })); continue; }

      // Strip markdown bold anywhere in the line — whole-line headings
      // ("**EXTENSION ACTIVITY**"), inline sub-headings ("**Question:** …"),
      // and stray unclosed pairs. Our DOCX paragraphs don't support inline
      // bold text-runs so the alternative is literal asterisks in output.
      tr = tr.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/\*\*/g, '');

      // Normalise the end-of-paper total when Claude writes "TOTAL: [N]"
      // (using the question-block bracket notation). The intended form is
      // "TOTAL: _____ / N marks".
      tr = tr.replace(/^(TOTAL|TOTAAL)\s*:\s*\[\s*(\d+)\s*\]\s*$/i, (_m, label, n) => `${label}: _____ / ${n} marks`);

      // Horizontal-rule separators (───, ━━━, ═══, ---) are decorative.
      // Underscore runs are NOT skipped — those are learner answer lines.
      if (/^[═━─\-]{3,}$/.test(tr)) continue;
      if (/^\|[\s\-:]+\|/.test(tr)) continue;
      if (/^#{1,3}\s+/.test(tr)) { els.push(sectionHead(tr.replace(/^#+\s+/, ''))); continue; }
      if (/^SECTION\s+[A-Z]/i.test(tr) || /^AFDELING\s+[A-Z]/i.test(tr)) { els.push(sectionHead(tr)); continue; }
      if (/^Question\s+\d+/i.test(tr) || /^Vraag\s+\d+/i.test(tr)) { els.push(questionHead(tr)); continue; }
      if (/^TOTAL/i.test(tr) || /^TOTAAL/i.test(tr)) { els.push(para(tr, { bold: true, size: 24, color: GREEN, spaceBefore: 200 })); continue; }
      if (/^MEMORANDUM/i.test(tr)) { els.push(sectionHead('MEMORANDUM')); continue; }
      if (/^COGNITIVE LEVEL/i.test(tr)) { els.push(sectionHead(tr)); continue; }
      if (/^EXTENSION/i.test(tr) || /^ENRICHMENT/i.test(tr)) { els.push(sectionHead(tr)); continue; }
      if (/^MARKING RUBRIC/i.test(tr) || /^RUBRIC/i.test(tr)) { els.push(sectionHead(tr)); continue; }
      if (/^\[\d+\]$/.test(tr)) { els.push(para(tr, { bold: true, align: AlignmentType.RIGHT })); continue; }
      const nm = tr.match(/^(\d+[\.\d]*)\s+(.*)/);
      if (nm && /^\d+\.\d+/.test(tr)) { els.push(numQ(nm[1], nm[2])); continue; }
      if (/^[a-d]\.\s/.test(tr)) { els.push(optLine(tr)); continue; }
      if (/^Answer:/i.test(tr) || /^Antwoord:/i.test(tr)) { els.push(ansLine()); continue; }
      if (/^Working:/i.test(tr) || /^Werking:/i.test(tr)) { els.push(workLine()); continue; }
      if (/^_{5,}$/.test(tr)) { els.push(blankLine()); continue; }
      if (isTableRow(tr)) {
        // Greedy-collect every subsequent line that's also a table row.
        // Separator rows like "|---|---|" are skipped but don't break the
        // sequence. Empty middle cells are PRESERVED — they're answer
        // spaces, and tbl() gives those rows a generous height.
        const rows = [tr];
        while (i + 1 < lines.length) {
          const nx = lines[i + 1].trim();
          if (/^[|\s\-:]+$/.test(nx)) { i++; continue; }
          if (isTableRow(nx)) { rows.push(nx); i++; }
          else break;
        }
        const parsed = rows.map(parseTableRow);
        if (parsed.length > 1) els.push(tbl(parsed[0], parsed.slice(1)));
        else els.push(para(tr));
        continue;
      }
      els.push(para(tr));
    }
    return els;
  }

  // ─────────────────────────────────────────────────────────
  // BUILD DOCUMENT
  // ─────────────────────────────────────────────────────────
  function stripBrandHeader(text) {
    return text.split('\n').filter((line) => {
      const t = line.trim().replace(/\*+/g, '').trim();
      return !/^THE RESOURCE ROOM\s*$/i.test(t);
    }).join('\n');
  }

  function buildDoc(qText, mText, actualMarks) {
    const cleanQ = stripBrandHeader(qText);
    const cleanM = stripBrandHeader(mText);
    const cover = isWorksheet
      ? [
          para(displaySubject + ' — ' + L.worksheetTitle, { bold: true, size: 28, align: AlignmentType.CENTER, spaceAfter: 80 }),
          para(L.grade + ' ' + grade + '  |  ' + L.term + ' ' + term + '  |  ' + language, { align: AlignmentType.CENTER, spaceAfter: 40 }),
          para([txt(L.name + ': ___________________________'), txt('     ' + L.date + ': ___________________')], { spaceAfter: 40 }),
          para(L.total + ': _____ / ' + totalMarks + ' ' + L.marksWord, { bold: true, spaceAfter: 120 }),
        ]
      : buildCover(actualMarks);

    return new Document({
      styles: { default: { document: { run: { font: FONT, size: 22 } } } },
      sections: [{
        properties: { page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } },
        headers: { default: new Header({ children: [para('THE RESOURCE ROOM', { size: 16, color: '999999', align: AlignmentType.RIGHT })] }) },
        footers: { default: new Footer({ children: [para(
          '© The Resource Room  |  CAPS ' + L.grade + ' ' + grade + ' ' + L.term + ' ' + term + '  |  ' + displaySubject,
          { size: 16, color: '999999', align: AlignmentType.CENTER },
        )] }) },
        children: [...cover, ...parseText(cleanQ), ...parseText(cleanM)],
      }],
    });
  }

  return { buildDoc, timeAllocation, displaySubject };
}
