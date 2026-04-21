import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, TabStopType,
  ShadingType, Header, Footer
} from 'docx';

import { logger as defaultLogger } from '../lib/logger.js';
import { callAnthropic, AnthropicError } from '../lib/anthropic.js';
import { str, int, oneOf, bool, ValidationError } from '../lib/validate.js';
import { getCogLevels, largestRemainder, marksToTime, isBarretts as isBarrettsFn } from '../lib/cognitive.js';
import { countMarks } from '../lib/marks.js';
import { ATP, EXAM_SCOPE, getATPTopics } from '../lib/atp.js';

// ============================================================
// MAIN HANDLER
// ============================================================
export default async function handler(req, res) {
  const log = req.log || defaultLogger;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let subject, topic, resourceType, language, duration, difficulty, includeRubric, grade, term;
  try {
    subject      = str(req.body?.subject,      { field: 'subject',      max: 200 });
    topic        = str(req.body?.topic,        { field: 'topic',        required: false, max: 500 });
    resourceType = str(req.body?.resourceType, { field: 'resourceType', max: 50 });
    language     = str(req.body?.language,     { field: 'language',     max: 40 });
    duration     = int(req.body?.duration,     { field: 'duration',     required: false, min: 10, max: 200 }) || 50;
    difficulty   = oneOf(req.body?.difficulty || 'on', ['below', 'on', 'above'], { field: 'difficulty' });
    includeRubric = bool(req.body?.includeRubric);
    grade        = int(req.body?.grade, { field: 'grade', min: 4, max: 7 });
    term         = int(req.body?.term,  { field: 'term',  min: 1, max: 4 });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }

  const g = grade;
  const t = term;
  const phase = g <= 3 ? 'Foundation' : g <= 6 ? 'Intermediate' : 'Senior';
  const isExam = resourceType === 'Exam';
  const isFinalExam = resourceType === 'Final Exam';
  const isWorksheet = resourceType === 'Worksheet';
  const isTest = resourceType === 'Test';
  const isExamType = isExam || isFinalExam;
 
  const totalMarks = parseInt(duration) || 50;
 
  // ── ATP topic lookup — replaces allTopics from UI ──
  // Always use the database; topic field is now just a focus hint
  const atpTopics = isFinalExam
    ? [1, 2, 3, 4].flatMap(tm => (ATP[subject]?.[g]?.[tm]) || [])
    : getATPTopics(subject, g, t, isExamType);
 
  const atpTopicList = atpTopics.length > 0
    ? atpTopics.join('\n- ')
    : (topic || subject);
 
  const focusHint = topic && topic !== subject
    ? `\nFOCUS: The teacher has requested emphasis on: ${topic}\n(This is a specific focus within the above topic list — do not limit to only this topic)`
    : '';
 
  const timeAllocation = marksToTime(totalMarks);
  const diffNote = difficulty === 'below' ? 'Below grade level' : difficulty === 'above' ? 'Above grade level' : 'On grade level';
 
  const cog = getCogLevels(subject);
  const isBarretts = isBarrettsFn(cog);
  const cogMarks = largestRemainder(totalMarks, cog.pcts);
  const cogTolerance = Math.max(1, Math.round(totalMarks * 0.02));
  const cogTable = cog.levels.map((l, i) => l + ' ' + cog.pcts[i] + '% = ' + cogMarks[i] + ' marks').join('\n');
 
  // Build topic instruction using ATP database
  let topicInstruction = '';
  // Build separate T1 and T2 topic lists for exam terms so the split is explicit
  const examTerm1Topics = isExam && t === 2 ? (ATP[subject]?.[g]?.[1] || []) : [];
  const examTerm2Topics = isExam && t === 2 ? (ATP[subject]?.[g]?.[2] || []) : [];
  const examTerm3Topics = isExam && t === 4 ? (ATP[subject]?.[g]?.[3] || []) : [];
  const examTerm4Topics = isExam && t === 4 ? (ATP[subject]?.[g]?.[4] || []) : [];

  if (isFinalExam) {
    topicInstruction = `FINAL EXAM — covers ALL topics from the entire year (Terms 1, 2, 3 and 4).\nEnsure questions are spread across these topics:\n- ${atpTopicList}${focusHint}`;
  } else if (isExam && t === 2) {
    const t1List = examTerm1Topics.join('\n  - ');
    const t2List = examTerm2Topics.join('\n  - ');
    topicInstruction = `TERM 2 EXAM — THIS IS AN EXAM TERM. CAPS requires BOTH Term 1 AND Term 2 content.

⚠️ CRITICAL SPLIT RULE — NON-NEGOTIABLE:
Approximately 50% of marks must come from Term 1 topics and 50% from Term 2 topics.
The difference between the two terms must NEVER exceed 70%/30%.
A paper using ONLY Term 1 topics is WRONG and will be rejected.
A paper using ONLY Term 2 topics is WRONG and will be rejected.
You MUST include questions from BOTH lists below.

TERM 1 TOPICS for Grade ${g} ${subject} (approximately ${Math.round(totalMarks * 0.5)} marks from here):
  - ${t1List}

TERM 2 TOPICS for Grade ${g} ${subject} (approximately ${Math.round(totalMarks * 0.5)} marks from here):
  - ${t2List}${focusHint}`;
  } else if (isExam && t === 4) {
    const t3List = examTerm3Topics.join('\n  - ');
    const t4List = examTerm4Topics.join('\n  - ');
    topicInstruction = `TERM 4 EXAM — THIS IS AN EXAM TERM. CAPS requires BOTH Term 3 AND Term 4 content.

⚠️ CRITICAL SPLIT RULE — NON-NEGOTIABLE:
Approximately 50% of marks must come from Term 3 topics and 50% from Term 4 topics.
The difference between the two terms must NEVER exceed 70%/30%.
A paper using ONLY Term 3 topics is WRONG and will be rejected.
A paper using ONLY Term 4 topics is WRONG and will be rejected.
You MUST include questions from BOTH lists below.

TERM 3 TOPICS for Grade ${g} ${subject} (approximately ${Math.round(totalMarks * 0.5)} marks from here):
  - ${t3List}

TERM 4 TOPICS for Grade ${g} ${subject} (approximately ${Math.round(totalMarks * 0.5)} marks from here):
  - ${t4List}${focusHint}`;
  } else {
    topicInstruction = `TERM ${t} ASSESSMENT — covers ONLY Term ${t} topics (CAPS rule: Term 1 and Term 3 assessments test only that term's work).\nQuestions MUST be drawn ONLY from these CAPS-prescribed Grade ${g} Term ${t} topics:\n- ${atpTopicList}${focusHint}\n\nDO NOT include topics from other terms — this is a strict CAPS compliance requirement.`;
  }
 
  // ═══════════════════════════════════════
  // DOCX HELPERS
  // ═══════════════════════════════════════
  const FONT = 'Arial';
  const GREEN = '085041';
  const bdr = { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' };
  const cellBorders = { top: bdr, bottom: bdr, left: bdr, right: bdr };
 
  function txt(text, opts = {}) {
    return new TextRun({ text: String(text), font: FONT, size: opts.size || 22, bold: !!opts.bold, color: opts.color || '000000', italics: !!opts.italics });
  }
 
  function para(content, opts = {}) {
    const children = typeof content === 'string' ? [txt(content, opts)] : content;
    return new Paragraph({
      children,
      spacing: { before: opts.spaceBefore || 0, after: opts.spaceAfter || 60 },
      alignment: opts.align || AlignmentType.LEFT,
      indent: opts.indent,
      tabStops: opts.tabStops
    });
  }
 
  function sectionHead(text) {
    return para(text, { bold: true, size: 26, color: GREEN, spaceBefore: 300, spaceAfter: 120 });
  }
 
  function questionHead(text) {
    return new Paragraph({
      children: [txt(text, { bold: true, size: 24 })],
      spacing: { before: 240, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } }
    });
  }
 
  function numQ(num, text) {
    return new Paragraph({
      children: [txt(num, { bold: true }), new TextRun({ text: '\t', font: FONT }), txt(text)],
      tabStops: [{ type: TabStopType.LEFT, position: 900 }],
      indent: { left: 900, hanging: 900 },
      spacing: { before: 120, after: 40 }
    });
  }
 
  function optLine(text) {
    return para(text, { indent: { left: 1200 }, spaceAfter: 20 });
  }
 
  function blankLine() {
    return para('_______________________________________________', { indent: { left: 900 }, spaceAfter: 80 });
  }
 
  function workLine() {
    return para([txt('Working: ', { bold: true, size: 20 }), txt('_______________________________________________', { size: 20 })], { indent: { left: 900 }, spaceAfter: 20 });
  }
 
  function ansLine() {
    return para([txt('Answer: ', { bold: true, size: 20 }), txt('_______________________________________________', { size: 20 })], { indent: { left: 900 }, spaceAfter: 80 });
  }
 
  function cell(text, opts = {}) {
    return new TableCell({
      children: [new Paragraph({
        children: [txt(String(text), { size: opts.size || 18, bold: !!opts.bold, color: opts.color || '000000' })],
        alignment: opts.align || AlignmentType.LEFT
      })],
      width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
      shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
      borders: cellBorders
    });
  }
 
  function tbl(headers, rows) {
    const hRow = new TableRow({
      children: headers.map(h => new TableCell({
        children: [new Paragraph({ children: [txt(String(h), { size: 18, bold: true, color: 'FFFFFF' })], alignment: AlignmentType.LEFT })],
        shading: { fill: GREEN, type: ShadingType.SOLID },
        borders: cellBorders,
        margins: { top: 60, bottom: 60, left: 120, right: 120 }
      }))
    });
    const dRows = rows.map(r => new TableRow({ children: r.map(c => cell(c)) }));
    return new Table({ rows: [hRow, ...dRows], width: { size: 9026, type: WidthType.DXA } });
  }
 
  // ═══════════════════════════════════════
  // COVER PAGE
  // ═══════════════════════════════════════
  function buildCover(actualMarks) {
    const displayMarks = actualMarks || totalMarks;
    const els = [];
 
    els.push(para('THE RESOURCE ROOM', { bold: true, size: 28, color: GREEN, align: AlignmentType.CENTER, spaceAfter: 60 }));
    els.push(para(resourceType.toUpperCase(), { bold: true, size: 36, align: AlignmentType.CENTER, spaceAfter: 60 }));
    els.push(para(subject, { bold: true, size: 28, align: AlignmentType.CENTER, spaceAfter: 160 }));
 
    const noBorder = { style: BorderStyle.NIL, size: 0, color: 'FFFFFF' };
    const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
 
    els.push(new Table({
      width: { size: 9026, type: WidthType.DXA }, columnWidths: [4513, 4513],
      rows: [new TableRow({ children: [
        new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('Grade ' + g, { size: 24, bold: true })] })] }),
        new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('Term ' + t, { size: 24, bold: true })], alignment: AlignmentType.RIGHT })] })
      ]})]
    }));
    els.push(para('', { spaceAfter: 60 }));
 
    els.push(new Table({
      width: { size: 9026, type: WidthType.DXA }, columnWidths: [4513, 4513],
      rows: [
        new TableRow({ children: [
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('Name: ___________________________', { size: 22 })] })] }),
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('Date: ___________________', { size: 22 })], alignment: AlignmentType.RIGHT })] })
        ]}),
        new TableRow({ children: [
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('Surname: ________________________', { size: 22 })] })] }),
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('', { size: 22 })] })] })
        ]})
      ]
    }));
    els.push(para('', { spaceAfter: 40 }));
 
    if (!isWorksheet) {
      els.push(new Table({
        width: { size: 9026, type: WidthType.DXA }, columnWidths: [4513, 4513],
        rows: [new TableRow({ children: [
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('Examiner: ______________________', { size: 22 })] })] }),
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('Time: ' + timeAllocation, { size: 22, bold: true })], alignment: AlignmentType.RIGHT })] })
        ]})]
      }));
      els.push(para('', { spaceAfter: 80 }));
    }
 
    const scoreBdr = { style: BorderStyle.SINGLE, size: 4, color: '085041' };
    const scoreBorders = { top: scoreBdr, bottom: scoreBdr, left: scoreBdr, right: scoreBdr };
    const colW = [3611, 1805, 1805, 1805];
    const cm = (w, children, align) => new TableCell({ borders: scoreBorders, width: { size: w, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children, alignment: align || AlignmentType.LEFT })] });
    els.push(new Table({
      width: { size: 9026, type: WidthType.DXA }, columnWidths: colW,
      rows: [
        new TableRow({ children: [cm(colW[0], [txt('Total', { bold: true, size: 20 })]), cm(colW[1], [txt(String(displayMarks), { bold: true, size: 20 })], AlignmentType.CENTER), cm(colW[2], [txt('%', { bold: true, size: 20 })], AlignmentType.CENTER), cm(colW[3], [txt('Code', { bold: true, size: 20 })], AlignmentType.CENTER)] }),
        new TableRow({ children: [cm(colW[0], [txt('Comments:', { bold: true, size: 18 })]), new TableCell({ borders: scoreBorders, columnSpan: 3, width: { size: colW[1]+colW[2]+colW[3], type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [txt('', { size: 18 })] })] })] })
      ]
    }));
    els.push(para('', { spaceAfter: 120 }));
 
    els.push(new Paragraph({ children: [txt('Instructions:', { bold: true, size: 22 })], spacing: { before: 0, after: 60 } }));
    for (const item of ['Read the questions properly.', 'Answer ALL the questions.', 'Show all working where required.', 'Pay special attention to the mark allocation of each question.']) {
      els.push(new Paragraph({ children: [txt('•  ' + item, { size: 22 })], indent: { left: 360 }, spacing: { before: 0, after: 40 } }));
    }
    els.push(para('', { spaceAfter: 160 }));
    return els;
  }
 
  // ═══════════════════════════════════════
  // TEXT → DOCX ELEMENTS
  // ═══════════════════════════════════════
  function parseText(text) {
    const lines = text.split('\n');
    const els = [];
    for (let i = 0; i < lines.length; i++) {
      const tr = lines[i].trim();
      if (!tr) { els.push(para('', { spaceAfter: 40 })); continue; }
      if (/^[═━─\-_]{3,}$/.test(tr)) continue;
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
      if (tr.includes('|') && tr.split('|').filter(c => c.trim()).length >= 2) {
        const rows = [tr];
        while (i + 1 < lines.length) {
          const nx = lines[i + 1].trim();
          if (/^[|\s\-:]+$/.test(nx)) { i++; continue; }
          if (nx.includes('|') && nx.split('|').filter(c => c.trim()).length >= 2) { rows.push(nx); i++; }
          else break;
        }
        const parsed = rows.map(r => r.split('|').map(c => c.trim()).filter(c => c));
        if (parsed.length > 1) els.push(tbl(parsed[0], parsed.slice(1)));
        else els.push(para(tr));
        continue;
      }
      els.push(para(tr));
    }
    return els;
  }
 
  // ═══════════════════════════════════════
  // BUILD DOCUMENT
  // ═══════════════════════════════════════
  function stripBrandHeader(text) {
    return text.split('\n').filter(line => {
      const t = line.trim().replace(/\*+/g, '').trim();
      return !/^THE RESOURCE ROOM\s*$/i.test(t);
    }).join('\n');
  }
 
  function buildDoc(qText, mText, actualMarks) {
    const cleanQ = stripBrandHeader(qText);
    const cleanM = stripBrandHeader(mText);
    const cover = isWorksheet
      ? [para(subject + ' — Worksheet', { bold: true, size: 28, align: AlignmentType.CENTER, spaceAfter: 80 }),
         para('Grade ' + g + '  |  Term ' + t + '  |  ' + language, { align: AlignmentType.CENTER, spaceAfter: 40 }),
         para([txt('Name: ___________________________'), txt('     Date: ___________________')], { spaceAfter: 40 }),
         para('Total: _____ / ' + totalMarks + ' marks', { bold: true, spaceAfter: 120 })]
      : buildCover(actualMarks);
    return new Document({
      styles: { default: { document: { run: { font: FONT, size: 22 } } } },
      sections: [{
        properties: { page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } },
        headers: { default: new Header({ children: [para('THE RESOURCE ROOM', { size: 16, color: '999999', align: AlignmentType.RIGHT })] }) },
        footers: { default: new Footer({ children: [para('© The Resource Room  |  CAPS Grade ' + g + ' Term ' + t + '  |  ' + subject, { size: 16, color: '999999', align: AlignmentType.CENTER })] }) },
        children: [...cover, ...parseText(cleanQ), ...parseText(cleanM)]
      }]
    });
  }
 
  // ═══════════════════════════════════════
  // CLAUDE API — delegates to shared wrapper (retries + 180s timeout);
  // this thin adapter preserves the legacy content-extraction behaviour
  // (JSON.content if present, else raw text with escape chars unescaped).
  // Structured-output migration is Phase 1.5.
  // ═══════════════════════════════════════
  async function callClaude(system, user, maxTok) {
    let raw;
    try {
      raw = await callAnthropic({ system, user, maxTokens: maxTok, logger: log });
    } catch (err) {
      if (err instanceof AnthropicError && err.code === 'TIMEOUT') {
        throw new Error('Generation is taking longer than usual. Please try again — complex resources can take up to 3 minutes.');
      }
      throw err;
    }
    const stripped = raw.replace(/```json|```/g, '').trim();
    try { return JSON.parse(stripped).content || stripped; } catch (e) {
      let c = stripped.replace(/^\s*\{\s*"content"\s*:\s*"/, '').replace(/"\s*\}\s*$/, '');
      return c.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
    }
  }
 
  // ═══════════════════════════════════════
  // SAFE CONTENT EXTRACTOR
  // ═══════════════════════════════════════
  function safeExtractContent(raw) {
    if (!raw || typeof raw !== 'string') return raw;
    let text = raw.trim();
    text = text.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim();
    text = text.replace(/^\{\s*"content"\s*:\s*"/, '').replace(/"\s*\}\s*$/, '').trim();
    if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text);
        if (parsed.content) return parsed.content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
      } catch(e) {}
    }
    const lines = text.split('\n');
    let startIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (/^(SECTION|AFDELING|Question\s+\d|Vraag\s+\d|\d+\.\d|TOTAL:|TOTAAL:|MEMORANDUM)/i.test(l)) {
        startIdx = i;
        break;
      }
      if (l.startsWith('{"content"')) {
        const remainder = lines.slice(i).join('\n');
        return safeExtractContent(remainder);
      }
    }
    if (startIdx > 0) text = lines.slice(startIdx).join('\n');
    return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
  }
 
  // ═══════════════════════════════════════
  // CLEANUP — remove AI meta-commentary
  // ═══════════════════════════════════════
  function cleanOutput(text) {
    const lines = text.split('\n').filter(line => {
      const t = line.trim().toUpperCase();
      const tr = line.trim();
      if (/^STEP\s+\d+\s*[—\-–]?/i.test(tr)) return false;
      if (/^STEP\s+\d+$/i.test(tr)) return false;
      if (t.startsWith('CORRECTED ') || t.startsWith('UPDATED ')) return false;
      if (t.includes('CORRECTED MEMORANDUM') || t.includes('CORRECTED COGNITIVE')) return false;
      if (t.startsWith('NOTE:') || t.startsWith('NOTE ') || t.startsWith('NOTE TO')) return false;
      if (t.includes('DISCREPANCY') || t.includes('RECONCILIATION')) return false;
      if (t.startsWith('REVISED ') || t.startsWith('FINAL INSTRUCTION') || t.startsWith('FINAL CONFIRMED')) return false;
      if (t.startsWith('RECOMMENDED ADJUSTMENT') || t.startsWith('TEACHERS SHOULD')) return false;
      if (t.startsWith('RECOUNT:') || t.startsWith('RE-EXAMINE') || t.startsWith('RE-COUNT')) return false;
      if (t.startsWith('VERIFY:') || t.startsWith('VERIFY ALL') || t.startsWith('CHECK:')) return false;
      if (t.includes('ALREADY COUNTED') || t.includes('CUMULATIVE')) return false;
      if (t.startsWith('THAT GIVES') || t.startsWith('THIS GIVES')) return false;
      if (t.startsWith('SO ROUTINE') || t.startsWith('SO COMPLEX') || t.startsWith('SO KNOWLEDGE')) return false;
      if (/^(KNOWLEDGE|ROUTINE|COMPLEX|PROBLEM|LOW|MIDDLE|HIGH|LITERAL|REORGAN|INFERENTIAL|EVALUATION)\s+ROWS?:/i.test(tr)) return false;
      if (/^(\*{0,2})THE RESOURCE ROOM(\*{0,2})\s*$/i.test(tr)) return false;
      if (/^MARKS?:/i.test(tr) && /written as|include also|one question/i.test(tr)) return false;
      if (/^\(\d+\)\s*\+\s*\(\d+\)/.test(tr)) return false;
      if (/^\[diagram/i.test(tr) || /^\[figure/i.test(tr) || /^\[image/i.test(tr)) return false;
      if (/^\[an angle/i.test(tr) || /^\[a shape/i.test(tr)) return false;
      if (/^TRY\s+/i.test(tr) || /^USE\s+\*\*/i.test(tr)) return false;
      if (/^NEW DATA SET/i.test(tr) || /^CHECKING CONSISTENCY/i.test(tr)) return false;
      if (/^LET ME TRY/i.test(tr) || /^LET'S TRY/i.test(tr)) return false;
      if (/^WAIT\s*[—\-–]/i.test(tr) || t.startsWith('WAIT ')) return false;
      if (/^I MUST RECHECK/i.test(tr) || /^LET ME RECHECK/i.test(tr)) return false;
      if (/^RECHECK:/i.test(tr) || /^CHECKING:/i.test(tr)) return false;
      if (/^COST\s*=/i.test(tr) || /^INCOME\s*=/i.test(tr)) return false;
      if (/^SINCE\s+R\d/i.test(tr)) return false;
      if (/^I NEED TO/i.test(tr) || /^LET ME VERIFY/i.test(tr)) return false;
      if (/^CURRENT TOTALS?:/i.test(tr) || /^LET ME RECOUNT/i.test(tr)) return false;
      if (/^REDUCE BY/i.test(tr)) return false;
      return true;
    });
 
    const cleaned = lines.map(line => {
      if (line.length > 300 && /recount|already counted|cumulative|verify|reconcil/i.test(line) && /\d+\s*\+\s*\d+/.test(line)) return '';
      return line;
    });
 
    const result = [];
    let blanks = 0;
    for (const line of cleaned) {
      if (line.trim() === '') { blanks++; if (blanks <= 1) result.push(line); }
      else { blanks = 0; result.push(line); }
    }
 
    const cogHeadingRx = /COGNITIVE LEVEL/i;
    const cogTableRowRx = /Prescribed\s*%/i;
    let cogCount = 0;
    const deduped = [];
    for (const line of result) {
      if (cogHeadingRx.test(line) || cogTableRowRx.test(line)) {
        cogCount++;
        if (cogCount === 2) break;
      }
      deduped.push(line);
    }
    return deduped.join('\n');
  }
 
  // ═══════════════════════════════════════
  // COGNITIVE LEVEL TYPE RULES
  // ═══════════════════════════════════════
  const LOW_DEMAND_TYPES = ['MCQ', 'True/False', 'True-False', 'Matching', 'True or False'];
  const maxLowDemandMarks = cogMarks[0];
  const highDemandLevels = cog.levels.slice(Math.max(0, cog.levels.length - 2));
 
  // ═══════════════════════════════════════
  // PHASE 1 — PLAN VALIDATOR
  // ═══════════════════════════════════════
  function validatePlan(plan) {
    if (!plan || !Array.isArray(plan.questions) || plan.questions.length === 0) return null;
    const planTotal = plan.questions.reduce((s, q) => s + (parseInt(q.marks) || 0), 0);
    if (planTotal !== totalMarks) { log.info(`Plan total ${planTotal} !== requested ${totalMarks} — rejecting`); return null; }
    const cogActual = {};
    cog.levels.forEach(l => cogActual[l] = 0);
    for (const q of plan.questions) { const lvl = q.cogLevel; if (cogActual[lvl] !== undefined) cogActual[lvl] += parseInt(q.marks) || 0; }
    for (let i = 0; i < cog.levels.length; i++) {
      const actual = cogActual[cog.levels[i]] || 0;
      const target = cogMarks[i];
      if (Math.abs(actual - target) > cogTolerance) { log.info(`Cog level "${cog.levels[i]}" has ${actual} marks, target ${target} ±${cogTolerance} — rejecting`); return null; }
    }
    const lowDemandTotal = plan.questions.filter(q => LOW_DEMAND_TYPES.some(t => (q.type || '').toLowerCase().includes(t.toLowerCase()))).reduce((s, q) => s + (parseInt(q.marks) || 0), 0);
    if (lowDemandTotal > maxLowDemandMarks) { log.info(`Low-demand types total ${lowDemandTotal} marks, max ${maxLowDemandMarks} — rejecting`); return null; }
    for (const q of plan.questions) {
      const isHighLevel = highDemandLevels.includes(q.cogLevel);
      const isLowType = LOW_DEMAND_TYPES.some(t => (q.type || '').toLowerCase().includes(t.toLowerCase()));
      if (isHighLevel && isLowType) { log.info(`Q${q.number} is ${q.cogLevel} but uses ${q.type} — rejecting`); return null; }
    }
    return plan;
  }
 
  // ═══════════════════════════════════════
  // PROMPTS
  // ═══════════════════════════════════════
  const taxLabel = isBarretts ? 'Barrett\'s Taxonomy' : 'Bloom\'s Taxonomy (DoE cognitive levels)';
 
  const planSys = `You are a South African CAPS ${phase} Phase assessment designer.
Return ONLY valid JSON — no markdown, no explanation.
Schema: {"questions":[{"number":"Q1","type":"MCQ","topic":"string","marks":5,"cogLevel":"${cog.levels[0]}"},...]}
cogLevel must be exactly one of: ${cog.levels.join(' | ')}`;
 
  const planUsr = `Design a ${totalMarks}-mark ${resourceType} question plan for: Grade ${g} ${subject} Term ${t} in ${language}.
 
${topicInstruction}
 
${taxLabel} cognitive level targets — marks must hit each level within ±${cogTolerance} marks:
${cog.levels.map((l, i) => `  ${l}: ${cogMarks[i]} marks (${cog.pcts[i]}%)`).join('\n')}
 
QUESTION TYPE RULES — strict and non-negotiable:
1. MCQ and True/False questions are LOW DEMAND — they address recall only.
   Total marks from MCQ + True/False combined must NOT exceed ${cogMarks[0]} marks.
   MCQ and True/False can ONLY serve the "${cog.levels[0]}" level.
 
2. The following levels MUST use higher-order question types:
${cog.levels.slice(1).map((l, i) => '   "' + l + '": use ' + (i === 0 ? 'Short Answer, Structured Question, Fill in the blank, Calculations' : i === cog.levels.length - 2 ? 'Multi-step, Structured Question, Analysis, Problem-solving' : 'Word Problem, Extended Response, Essay, Investigation')).join('\n')}
3. Every question must have: number (Q1, Q2...), type, topic (must be from the ATP list above), marks (whole number ≥ 1), cogLevel
4. Questions must sum to EXACTLY ${totalMarks} marks
5. Minimum ${isWorksheet ? '4' : '6'} questions — spread topics across all prescribed ATP topics above
 
Return only the JSON object, nothing else.`;
 
  const qSys = (plan) => `You are a South African CAPS ${phase} Phase teacher writing a ${resourceType} question paper in ${language}.
Use SA context (rands, names: Sipho, Ayanda, Zanele, Thandi, Pieter, Anri, SA places like Johannesburg, Cape Town, Durban, Pretoria).
DIFFICULTY: ${diffNote}
CAPS: Grade ${g} Term ${t} ${subject}
 
CRITICAL TOPIC RULE — NON-NEGOTIABLE:
This assessment covers ONLY these CAPS-prescribed topics for Grade ${g} ${subject}:
- ${atpTopicList}
Do NOT include questions on topics from other terms. This is a CAPS compliance requirement.
Every question topic field in the plan maps to this list — trust the plan.
 
CRITICAL: Follow the question plan EXACTLY. Do not change any mark values. Do not add or remove questions.
The plan guarantees CAPS cognitive level compliance — trust it and write accordingly.
 
DO NOT INCLUDE:
- NO cover page, title, header, name/date fields, or instructions — start DIRECTLY with Question 1 or SECTION A
- NO cognitive level labels in the learner paper
- NO notes, commentary, or meta-text of any kind
 
NO DIAGRAMS RULE (applies to ALL subjects — non-negotiable):
This system cannot render diagrams, graphs, drawings, or images.
Do NOT write any question requiring the learner to look at a drawn diagram, drawn shape, drawn graph, drawn map, or drawn image.
INSTEAD use text-only alternatives:
- Angles: provide the value → "An angle measures 65°. Classify this angle."
- Shapes: describe dimensions in words → "A rectangle is 10 cm long and 4 cm wide."
- Graphs/charts: provide data as a text table using pipe format
- Maps/scenarios: describe in words → "A garden is 14 m long and 9 m wide."
- Food webs/circuits/ecosystems: describe relationships in words or use a text table
This rule applies to EVERY subject. No exceptions.
 
FORMAT RULES:
- Numbering: Question 1: [heading] then 1.1, 1.2, 1.2.1 etc.
- EVERY sub-question MUST show its mark in brackets (X) on the SAME LINE as the question text
- MCQ: show (1) on the question line BEFORE the a. b. c. d. options
- True/False: statement then blank then (marks) all on ONE line
- Answer lines: _______________________________________________
- Working:/Answer: lines only for calculation questions
- Question block totals: [X] right-aligned at end of each question block
${isTest ? '- NO SECTION headers. Use Question 1, Question 2 etc.' : ''}
${isExamType ? '- USE SECTION A / B / C / D headers' : ''}
- Write fractions as plain text: 3/4 not ¾
- No Unicode box characters or Unicode fraction symbols
 
ORDERING QUESTION RULE:
- Never include two values that are mathematically equal
- Convert ALL values to decimals to verify all are distinct before writing

${subject.toLowerCase().includes('math') || subject.toLowerCase().includes('wiskunde') ? `MATHS NUMBER RANGE RULE FOR GRADE ${g}:
${g <= 4 ? '- Use numbers up to 4-digit (up to 9,999). Do NOT use 5-digit or larger numbers.' : ''}${g === 5 ? '- Use numbers up to 6-digit (up to 999,999). Do NOT use 7-digit or larger numbers.' : ''}${g === 6 ? `- Use numbers up to 9-digit where CAPS requires it, but VARY your number sizes:
  * Some questions must use small numbers (hundreds: 100–999)
  * Some questions must use medium numbers (thousands: 1,000–99,999)
  * Some questions must use large numbers only where CAPS explicitly requires it (up to 9 million max for Grade 6 tests)
  * Do NOT use numbers in the hundreds of millions (100,000,000+) — these are too large for Grade 6 tests
  * Whole number place value may go to 9-digit for ordering/comparing ONLY` : ''}${g === 7 ? '- Use numbers appropriate for Grade 7 — whole numbers up to 9-digit where needed, decimals to 3 places, fractions with mixed numbers. Vary sizes — not all numbers should be in the millions.' : ''}` : ''}
 
NO DIAGRAMS rule: Do not write "Use the diagram/graph/map/figure below."
End with: TOTAL: _____ / ${totalMarks} marks
Return JSON: {"content":"question paper text only"}`;
 
  const qUsr = (plan) => `Write the question paper following this EXACT plan:
${JSON.stringify(plan.questions, null, 2)}
 
Subject: ${subject} | Grade: ${g} | Term: ${t} | Language: ${language}
${topicInstruction}
Total must be: ${totalMarks} marks`;
 
  const mSys = `You are a South African CAPS Grade ${g} ${subject} teacher creating a memorandum in ${language}.
Use pipe | tables only. No Unicode box characters. Write fractions as plain text.
Output ONLY the memorandum content — no headings like "STEP 1", "CORRECTED", "Updated" etc.
No reasoning, notes or adjustments outside tables. Generate each cognitive level table ONCE only.
Do NOT question or adjust mark allocation — use marks exactly as shown in the paper.
 
COGNITIVE FRAMEWORK: ${taxLabel}
Levels used: ${cog.levels.join(', ')}
 
MEDIAN RULE: Sort ALL values from smallest to largest first. Count total n.
If n is odd: median = value at position (n+1)/2.
If n is even: median = average of values at positions n/2 and (n/2)+1.
Count position by position — do not skip repeated values.
 
STEM-AND-LEAF COUNT RULE: Count every individual leaf digit. Write count per stem, then add them.
 
DECIMAL ROUNDING RULE: Round non-terminating decimals to 1 decimal place. Use same value throughout.
 
COGNITIVE LEVEL TABLE RULE: Fill the table by mechanically adding MARK values per level from the memo rows above.
Actual Marks for each level MUST equal the sum of that level's rows. All Actual Marks MUST sum to the paper total.
 
Return JSON: {"content":"memorandum text"}`;
 
  const mUsrA = (qp, actualTotal, cogLevelRef) => `Grade ${g} ${subject} — ${resourceType} — Term ${t}
 
Question paper:
${qp}
 
This paper totals ${actualTotal} marks.
 
COGNITIVE LEVEL REFERENCE (${taxLabel}) — copy these exactly, do not change:
${cogLevelRef}
 
YOUR ONLY TASK: Write the MEMORANDUM TABLE.
Columns: NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK
 
- List EVERY SINGLE sub-question from the paper — scan every question block
- Include ALL sub-parts (e.g. 5.1a, 5.1b)
- Do NOT skip any question
- Use the EXACT (X) mark shown on each question line
- Copy COGNITIVE LEVEL from the reference above — do not reassign
- For financial questions: income > cost = PROFIT; cost > income = LOSS
- For stem-and-leaf: count every leaf individually
 
After the table write: TOTAL: ${actualTotal} marks
Do NOT write the cognitive level analysis table, extension activity, or rubric here.
Return JSON: {"content":"memorandum table and TOTAL line only"}`;
 
  const mUsrB = (memoTable, actualTotal) => `Grade ${g} ${subject} — ${resourceType} — Term ${t}
 
Completed memorandum table (${actualTotal} marks total):
${memoTable}
 
YOUR TASK: Write the following sections based on the table above.
 
SECTION: COGNITIVE LEVEL ANALYSIS (${taxLabel})
Write this pipe table:
Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual %
${cog.levels.map((l, i) => l + ' | ' + cog.pcts[i] + '% | ' + cogMarks[i]).join('\n')}
 
For EACH row:
- Actual Marks = add up MARK column from memo table for all rows where COGNITIVE LEVEL matches
- Actual % = (Actual Marks ÷ ${actualTotal}) × 100, rounded to 1 decimal place
- All Actual Marks MUST sum to ${actualTotal}
 
Then write ONE summary line per level:
[Level] ([X] marks): Q1.1 (1) + Q2.3 (2) + ... = [X] marks
 
${!isWorksheet ? `SECTION: EXTENSION ACTIVITY
Write one challenging question beyond the paper scope. Include complete step-by-step model answer.` : ''}
 
${includeRubric ? `SECTION: MARKING RUBRIC
CRITERIA | Level 5 Outstanding (90-100%) | Level 4 Good (75-89%) | Level 3 Satisfactory (60-74%) | Level 2 Needs Improvement (40-59%) | Level 1 Not Achieved (0-39%)
Write 3-4 subject-relevant criteria rows for ${subject}.` : ''}
 
Return JSON: {"content":"cognitive level analysis + extension + rubric"}`;
 
  const mUsr = mUsrA;
 
  // ═══════════════════════════════════════
  // RESPONSE TO TEXT — 4-SECTION PIPELINE
  // Runs instead of the standard pipeline for English HL/FAL
  // and Afrikaans HL/FAL Response to Text papers
  // ═══════════════════════════════════════
  const isResponseToText = isBarretts && !isWorksheet;

  // Barrett's marks per section for a Response to Text paper:
  // Section A: Comprehension 20 marks  → own Barrett's
  // Section B: Visual text  10 marks  → own Barrett's
  // Section C: Summary       5 marks  → Reorganisation only
  // Section D: Language     15 marks  → own Barrett's
  // Total = 50 marks (standard). For non-50 papers, scale proportionally.
  function getRTTSectionMarks(total) {
    if (total === 50) return { a: 20, b: 10, c: 5, d: 15 };
    // Scale proportionally, round to whole numbers
    const scale = total / 50;
    const a = Math.round(20 * scale);
    const b = Math.round(10 * scale);
    const d = Math.round(15 * scale);
    const c = total - a - b - d;
    return { a, b, c: Math.max(c, 3), d };
  }

  // Barrett's marks per level for a given section total
  function getBarrettMarks(sectionTotal, includeSummaryOnly = false) {
    if (includeSummaryOnly) {
      // Summary is purely Reorganisation level
      return [0, sectionTotal, 0, 0];
    }
    return largestRemainder(sectionTotal, [20, 20, 40, 20]);
  }

  async function generateResponseToText() {
    const lang = language;
    const isAfrikan = subject.toLowerCase().includes('afrikaans');
    const secLabel = isAfrikan
      ? ['AFDELING A', 'AFDELING B', 'AFDELING C', 'AFDELING D']
      : ['SECTION A', 'SECTION B', 'SECTION C', 'SECTION D'];
    const sm = getRTTSectionMarks(totalMarks);

    // Shared passage — one literary or non-literary reading passage for Section A & C
    const passageSys = `You are a South African CAPS ${phase} Phase ${lang} teacher.
Write a reading passage suitable for Grade ${g} learners in ${lang}.
Use South African context, names (Sipho, Ayanda, Zanele, Thandi, Pieter, Anri), SA places, SA currency (rands).
The passage must be:
- A ${isAfrikan ? 'literêre of nie-literêre teks' : 'literary or non-literary text'}
- Appropriate reading level for Grade ${g}
- Between 250 and 350 words long
- Interesting and relevant to South African learners
- NOT about diagrams, maps or images (text only)
Return ONLY the passage text — no title instructions or commentary.`;
    const passageUsr = `Write the reading passage for a Grade ${g} ${subject} Term ${t} Response to Text paper.
Topic must align with CAPS Term ${t} ${subject} reading content.
Return only the passage.`;

    let passage = '';
    try {
      passage = await callClaude(passageSys, passageUsr, 1200);
      passage = passage.replace(/^```.*\n?/, '').replace(/```$/, '').trim();
    } catch(e) { passage = ''; }

    // Helper: build Barrett's table for a section
    function barretts(marks, includeSummaryOnly = false) {
      const bm = getBarrettMarks(marks, includeSummaryOnly);
      const levels = ['Literal', 'Reorganisation', 'Inferential', 'Evaluation and Appreciation'];
      const pcts = [20, 20, 40, 20];
      if (includeSummaryOnly) {
        return `| Cognitive Level | Prescribed % | Marks |\n|---|---|---|\n| Reorganisation | 100% | ${marks} |`;
      }
      return `| Cognitive Level | Prescribed % | Marks |\n|---|---|---|\n` +
        levels.map((l, i) => `| ${l} | ${pcts[i]}% | ${bm[i]} |`).join('\n');
    }

    // SECTION A — Comprehension (20 marks)
    const secASys = `You are a South African CAPS Grade ${g} ${subject} teacher writing ${secLabel[0]} of a Response to Text exam in ${lang}.
DIFFICULTY: ${diffNote}
This section tests COMPREHENSION ONLY — NO language/grammar questions here.
Language questions belong ONLY in Section D.
The reading passage is provided. All questions must refer to it.

Barrett's Taxonomy cognitive levels for this section (${sm.a} marks total):
${barretts(sm.a)}

FORMAT:
- Heading: ${secLabel[0]}: ${isAfrikan ? 'BEGRIP' : 'COMPREHENSION'} [${sm.a}]
- Sub-heading: ${isAfrikan ? 'Lees die gegewe teks en beantwoord die vrae wat volg.' : 'Read the passage and answer the questions that follow.'}
- Questions numbered 1.1, 1.2 … with mark in brackets (X) on same line
- Progress from Literal → Reorganisation → Inferential → Evaluation and Appreciation
- End with: [${sm.a}]
- NO grammar, vocabulary, figure of speech, or language structure questions
Return JSON: {"content":"Section A text only"}`;

    const secAUsr = `READING PASSAGE:\n${passage}\n\nWrite ${secLabel[0]} — Comprehension questions (${sm.a} marks) following the instructions exactly.`;

    // SECTION B — Visual Text (10 marks)
    const secBSys = `You are a South African CAPS Grade ${g} ${subject} teacher writing ${secLabel[1]} of a Response to Text exam in ${lang}.
This section tests VISUAL TEXT comprehension ONLY — NO language/grammar questions here.
Language questions belong ONLY in Section D.

IMPORTANT — NO DIAGRAMS RULE: This system cannot display actual images or posters.
Instead, describe a visual text in words (e.g. "Study the advertisement described below:" then describe layout, text, images, colours in words). Learners answer questions about the described visual.

Barrett's Taxonomy cognitive levels for this section (${sm.b} marks total):
${barretts(sm.b)}

FORMAT:
- Heading: ${secLabel[1]}: ${isAfrikan ? 'VISUELE TEKS' : 'VISUAL TEXT'} [${sm.b}]
- Describe the visual text in words (advertisement, poster, or cartoon)
- Sub-heading: ${isAfrikan ? 'Bestudeer die visuele teks hieronder en beantwoord die vrae.' : 'Study the visual text below and answer the questions.'}
- Questions numbered 2.1, 2.2 … with mark in brackets (X) on same line
- End with: [${sm.b}]
- NO grammar, vocabulary, or language structure questions
Return JSON: {"content":"Section B text only"}`;

    const secBUsr = `Write ${secLabel[1]} — Visual Text questions (${sm.b} marks) for Grade ${g} ${subject} Term ${t}.
Use SA context. Describe a visual in words (advertisement, poster or cartoon about an SA topic relevant to Grade ${g}).`;

    // SECTION C — Summary (5 marks)
    const secCSys = `You are a South African CAPS Grade ${g} ${subject} teacher writing ${secLabel[2]} of a Response to Text exam in ${lang}.
This section is a SUMMARY WRITING task ONLY — one question only.
Barrett's Taxonomy: This is a Reorganisation level task (selecting and organising key information).

FORMAT:
- Heading: ${secLabel[2]}: ${isAfrikan ? 'OPSOMMING' : 'SUMMARY'} [${sm.c}]
- Instruct learners to write a summary of the reading passage (from Section A) in their own words
- Specify maximum word count (about 50 words for 5 marks, scale accordingly)
- State exactly what the summary must include (e.g. main points, key ideas)
- Mark allocation: content marks + language/structure marks
- End with: [${sm.c}]
Return JSON: {"content":"Section C text only"}`;

    const secCUsr = `READING PASSAGE (from Section A):\n${passage}\n\nWrite ${secLabel[2]} — Summary task (${sm.c} marks).`;

    // SECTION D — Language Structures and Conventions
    const secDSys = `You are a South African CAPS Grade ${g} ${subject} teacher writing ${secLabel[3]} of a Response to Text exam in ${lang}.
THIS IS THE ONLY SECTION WHERE LANGUAGE/GRAMMAR QUESTIONS ARE ASKED.
Do NOT include comprehension questions here — only language structures and conventions.

Barrett's Taxonomy for this section (${sm.d} marks total):
${barretts(sm.d)}

CAPS Grade ${g} ${subject} Term ${t} Language topics to draw from:
${atpTopicList}

QUESTION TYPES (mix these — do not repeat the same type more than twice):
- Parts of speech (nouns, verbs, adjectives, adverbs, pronouns)
- Tense (change sentence from present to past, etc.)
- Active/Passive voice
- Direct/Indirect speech
- Punctuation and capitalisation
- Synonyms and antonyms
- Prefixes and suffixes
- Figures of speech (simile, metaphor, personification)
- Sentence structure (combine sentences, identify subject/predicate)
- Vocabulary in context
AVOID: conditional sentences and other Grade 7+ structures for Grade 6.

FORMAT:
- Heading: ${secLabel[3]}: ${isAfrikan ? 'TAALSTRUKTURE EN -KONVENSIES' : 'LANGUAGE STRUCTURES AND CONVENTIONS'} [${sm.d}]
- Questions numbered 4.1, 4.2 … with mark in brackets (X) on same line
- Mix question types — provide context sentences for each
- End with: [${sm.d}]
Return JSON: {"content":"Section D text only"}`;

    const secDUsr = `Write ${secLabel[3]} — Language Structures and Conventions (${sm.d} marks) for Grade ${g} ${subject} Term ${t} in ${lang}.`;

    // Generate all 4 sections in parallel
    log.info(`RTT Pipeline: generating 4 sections in parallel (${sm.a}+${sm.b}+${sm.c}+${sm.d}=${sm.a+sm.b+sm.c+sm.d} marks)`);
    const [secARaw, secBRaw, secCRaw, secDRaw] = await Promise.all([
      callClaude(secASys, secAUsr, 3000),
      callClaude(secBSys, secBUsr, 2000),
      callClaude(secCSys, secCUsr, 1000),
      callClaude(secDSys, secDUsr, 2500)
    ]);

    const secA = cleanOutput(safeExtractContent(secARaw));
    const secB = cleanOutput(safeExtractContent(secBRaw));
    const secC = cleanOutput(safeExtractContent(secCRaw));
    const secD = cleanOutput(safeExtractContent(secDRaw));

    // Assemble the full paper
    const passageHeading = isAfrikan ? 'LEESSTUK:' : 'READING PASSAGE:';
    const questionPaper = [
      passageHeading,
      '',
      passage,
      '',
      secA,
      '',
      secB,
      '',
      secC,
      '',
      secD,
      '',
      `TOTAL: _____ / ${totalMarks} marks`
    ].join('\n');

    log.info(`RTT Pipeline: paper assembled (${questionPaper.length} chars)`);

    // ── RTT Memo Phase 1: Section A (Comprehension) answers + Barrett's ──
    // Deliberately separate from the question paper generation to stay within token limits
    const rttMemoSys = `You are a South African CAPS Grade ${g} ${subject} teacher creating a memorandum for a Response to Text exam in ${lang}.
Use pipe | tables only. No Unicode box characters. No markdown headings with #.
Return JSON: {"content":"memorandum text"}`;

    const rttMemoUsrA = `${secLabel[0]} QUESTIONS (${sm.a} marks):
${secA}

Write the memo for ${secLabel[0]} ONLY:
1. Answer table with columns: NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK
   - List every sub-question (1.1, 1.2 … etc)
   - COGNITIVE LEVEL must be one of: Literal | Reorganisation | Inferential | Evaluation and Appreciation
   - Use the MARK shown in brackets on each question line
2. After the table, write a Barrett's Taxonomy summary for ${secLabel[0]} ONLY:
   | Barrett's Level | Questions | Marks Allocated | Marks as % of Section |
   All rows must sum to exactly ${sm.a} marks. Target: Literal 20%, Reorganisation 20%, Inferential 40%, Evaluation 20%.
3. End with: ${secLabel[0]} TOTAL: ${sm.a} marks

Return JSON: {"content":"Section A memo"}`;

    // ── RTT Memo Phase 2: Section B (Visual Text) + Section C (Summary) answers + Barrett's ──
    const rttMemoUsrB = `${secLabel[1]} QUESTIONS (${sm.b} marks):
${secB}

${secLabel[2]} QUESTION (${sm.c} marks):
${secC}

Write the memo for ${secLabel[1]} AND ${secLabel[2]}:

PART 1 — ${secLabel[1]} answer table: NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK
List every sub-question (2.1, 2.2 … etc). Use Literal/Reorganisation/Inferential/Evaluation and Appreciation.
Then write Barrett's Taxonomy summary for ${secLabel[1]} ONLY (must sum to ${sm.b} marks).
End with: ${secLabel[1]} TOTAL: ${sm.b} marks

PART 2 — ${secLabel[2]} answer table: NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK
This section is a summary task. Award marks for: content points included (award per bullet point met) + language/structure.
Cognitive level for summary = Reorganisation.
Then write Barrett's Taxonomy summary for ${secLabel[2]} ONLY (must sum to ${sm.c} marks — all Reorganisation).
End with: ${secLabel[2]} TOTAL: ${sm.c} marks

Return JSON: {"content":"Section B and C memo"}`;

    // ── RTT Memo Phase 3: Section D (Language) answers + Barrett's + combined paper table ──
    const rttMemoUsrD = `${secLabel[3]} QUESTIONS (${sm.d} marks):
${secD}

Write the memo for ${secLabel[3]}:
1. Answer table: NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK
   List every sub-question (4.1, 4.2 … etc). Use Literal/Reorganisation/Inferential/Evaluation and Appreciation.
2. Barrett's Taxonomy summary for ${secLabel[3]} ONLY (must sum to ${sm.d} marks).
3. End with: ${secLabel[3]} TOTAL: ${sm.d} marks

Then write the COMBINED PAPER BARRETT'S ANALYSIS:
Heading: COMBINED BARRETT'S TAXONOMY ANALYSIS — FULL PAPER (${totalMarks} marks)
Write this pipe table:
| Barrett's Level | Prescribed % | Prescribed Marks | Actual Marks | Actual % |
| Literal | 20% | ${largestRemainder(totalMarks,[20,20,40,20])[0]} | [sum from all sections] | [%] |
| Reorganisation | 20% | ${largestRemainder(totalMarks,[20,20,40,20])[1]} | [sum from all sections] | [%] |
| Inferential | 40% | ${largestRemainder(totalMarks,[20,20,40,20])[2]} | [sum from all sections] | [%] |
| Evaluation and Appreciation | 20% | ${largestRemainder(totalMarks,[20,20,40,20])[3]} | [sum from all sections] | [%] |
| TOTAL | 100% | ${totalMarks} | [must equal ${totalMarks}] | 100% |

Actual Marks per level = sum across ALL four sections. All Actual Marks must total exactly ${totalMarks}.

Return JSON: {"content":"Section D memo and combined Barrett's"}`;

    log.info(`RTT Memo: generating in 3 phases (A / B+C / D+combined)`);
    const [memoARaw, memoBCRaw, memoDRaw] = await Promise.all([
      callClaude(rttMemoSys, rttMemoUsrA, 4000),
      callClaude(rttMemoSys, rttMemoUsrB, 4000),
      callClaude(rttMemoSys, rttMemoUsrD, 4000)
    ]);

    const memoA  = cleanOutput(safeExtractContent(memoARaw));
    const memoBC = cleanOutput(safeExtractContent(memoBCRaw));
    const memoD  = cleanOutput(safeExtractContent(memoDRaw));

    const memoContent = [
      'MEMORANDUM',
      '',
      `Grade ${g} ${subject} — Response to Text — Term ${t}`,
      `CAPS Aligned | Barrett\'s Taxonomy Framework`,
      '',
      memoA,
      '',
      memoBC,
      '',
      memoD
    ].join('\n');

    log.info(`RTT Memo: complete (${memoContent.length} chars — A:${memoARaw.length} BC:${memoBCRaw.length} D:${memoDRaw.length})`);

    const markTotal = totalMarks; // RTT papers use fixed mark total

    // Build DOCX
    let docxBase64 = null;
    const filename = (subject + '-ResponseToText-Grade' + g + '-Term' + t).replace(/[^a-zA-Z0-9\-]/g, '-') + '.docx';
    try {
      const doc = buildDoc(questionPaper, memoContent, markTotal);
      const buffer = await Packer.toBuffer(doc);
      docxBase64 = buffer.toString('base64');
    } catch(docxErr) { log.error({ err: docxErr?.message || docxErr }, 'RTT DOCX build error'); }

    const preview = questionPaper + '\n\n' + memoContent;
    return res.status(200).json({ docxBase64, preview, filename });
  }

  // ═══════════════════════════════════════
  // EXECUTE — multi-phase generation
  // ═══════════════════════════════════════
  try {
    // Route Barrett's subjects to the dedicated RTT pipeline
    if (isResponseToText) {
      return await generateResponseToText();
    }

    // ── Phase 1: Generate & validate question plan ──
    let plan = null;
    let planAttempts = 0;
    while (!plan && planAttempts < 2) {
      planAttempts++;
      try {
        const rawPlan = await callClaude(planSys, planUsr, 1500);
        let parsedPlan;
        try { parsedPlan = typeof rawPlan === 'object' ? rawPlan : JSON.parse(rawPlan); }
        catch(e) { log.info(`Plan attempt ${planAttempts}: JSON parse failed`); continue; }
        plan = validatePlan(parsedPlan);
        if (!plan) log.info(`Plan attempt ${planAttempts}: validation failed`);
      } catch(e) { log.info(`Plan attempt ${planAttempts}: error — ${e.message}`); }
    }
 
    if (!plan) {
      log.info('Plan validation failed — using JS fallback plan');
      const fallbackQuestions = [];
      const typeByLevel = ['MCQ', 'Short Answer', 'Multi-step', 'Word Problem'];
      cog.levels.forEach((lvl, li) => {
        let lvlMarks = cogMarks[li];
        const qType = typeByLevel[Math.min(li, typeByLevel.length - 1)];
        const chunkSize = li === 0 ? 5 : 10;
        while (lvlMarks > 0) {
          const chunk = Math.min(lvlMarks, chunkSize);
          fallbackQuestions.push({ number: 'Q' + (fallbackQuestions.length + 1), type: qType, topic: atpTopics[0] || subject, marks: chunk, cogLevel: lvl });
          lvlMarks -= chunk;
        }
      });
      plan = { questions: fallbackQuestions };
      log.info(`Fallback plan: ${fallbackQuestions.length} questions, ${fallbackQuestions.reduce((s,q)=>s+q.marks,0)} marks`);
    }
 
    log.info(`Plan validated: ${plan.questions.length} questions, ${plan.questions.reduce((s,q)=>s+q.marks,0)} marks`);
 
    // ── Phase 2: Write questions from validated plan ──
    const qTok = isWorksheet ? 3000 : (isExamType) ? 5500 : 4500;
    let questionPaper = await callClaude(qSys(plan), qUsr(plan), qTok);
    questionPaper = cleanOutput(questionPaper);
 
    // ── Phase 2a: Mark drift correction ──
    const countedAfterP2 = countMarks(questionPaper);
    const drift = countedAfterP2 - totalMarks;
    if (countedAfterP2 > 0 && drift !== 0) {
      log.info(`Mark drift: counted=${countedAfterP2}, target=${totalMarks}, drift=${drift > 0 ? '+' : ''}${drift}`);
      const corrSys = `You are correcting a ${subject} ${resourceType} question paper. The paper totals ${countedAfterP2} marks but must total EXACTLY ${totalMarks} marks. ${drift > 0 ? 'Reduce' : 'Increase'} the total by ${Math.abs(drift)} mark${Math.abs(drift) > 1 ? 's' : ''}.
RULES: Change minimum sub-question mark values needed. Only change (X) numbers — not content. Keep Working:/Answer: lines. Return JSON: {"content":"complete corrected question paper"}`;
      const corrUsr = `Paper totals ${countedAfterP2}, must be EXACTLY ${totalMarks}. ${drift > 0 ? 'Reduce' : 'Increase'} by ${Math.abs(drift)}.\n\nPAPER:\n${questionPaper}\n\nReturn the complete corrected paper.`;
      try {
        const corrected = cleanOutput(await callClaude(corrSys, corrUsr, qTok));
        const countedAfterCorr = countMarks(corrected);
        if (countedAfterCorr === totalMarks) { questionPaper = corrected; log.info(`Correction successful: ${countedAfterCorr} marks ✓`); }
        else log.info(`Correction resulted in ${countedAfterCorr} marks — keeping Phase 2 paper`);
      } catch(corrErr) { log.info(`Correction failed: ${corrErr.message}`); }
    } else if (countedAfterP2 === totalMarks) {
      log.info(`Phase 2 exact: ${countedAfterP2} marks ✓`);
    }
 
    const finalCount = countMarks(questionPaper);
    const markTotal = finalCount > 0 ? finalCount : totalMarks;
    log.info(`Final mark total: ${markTotal}`);
 
    // ── Phase 2b: Question Quality Check ──
    const qQualitySys = `You are a South African CAPS examiner reviewing a question paper for design flaws.
Return ONLY valid JSON — no markdown.
Check for:
1. ORDERING_EQUAL_VALUES — ordering question where two or more values are mathematically equal
2. MCQ_MULTIPLE_CORRECT — MCQ where more than one option is correct
3. MCQ_NO_CORRECT — MCQ where no option is correct
4. DATA_AMBIGUOUS — data set where multiple modes exist but question says "the mode"
5. QUESTION_IMPOSSIBLE — question that cannot be answered with information given
6. WRONG_TERM_TOPIC — question on a topic NOT in this list: ${atpTopics.slice(0,8).join('; ')}
 
Return: {"flaws":[{"question":"4.3","type":"ORDERING_EQUAL_VALUES","detail":"0.6 and 3/5 are both 0.60","fix":"Replace 3/5 with 2/5"}],"clean":false}
If no flaws: {"flaws":[],"clean":true}`;
 
    const qQualityUsr = `Review this Grade ${g} ${subject} Term ${t} question paper for design flaws:\n\n${questionPaper}`;
 
    try {
      const rawQuality = await callClaude(qQualitySys, qQualityUsr, 1200);
      let qualityResult;
      try { qualityResult = typeof rawQuality === 'object' ? rawQuality : JSON.parse(rawQuality); }
      catch(e) { qualityResult = { flaws: [], clean: true }; }
 
      if (qualityResult.flaws && qualityResult.flaws.length > 0) {
        log.info(`Phase 2b: ${qualityResult.flaws.length} flaw(s) detected`);
        qualityResult.flaws.forEach(f => log.info(`  Q${f.question} [${f.type}]: ${f.detail}`));
        const fixSys = `You are correcting specific design flaws in a ${subject} question paper.
OUTPUT RULES:
- Output the complete corrected question paper ONLY
- Start IMMEDIATELY with the first line of the paper (e.g. "SECTION A" or "Question 1")
- Do NOT write any explanation, reasoning, preamble, or notes before or after
- Do NOT wrap in JSON — output raw paper text directly
- Rewrite ONLY the flagged questions — leave everything else character-for-character identical
- Preserve every (X) mark value exactly`;
        const flawList = qualityResult.flaws.map(f => `Q${f.question}: [${f.type}] ${f.detail} — Fix: ${f.fix}`).join('\n');
        const fixUsr = `Fix ONLY these flaws. Output complete corrected paper with NO preamble.\n\nFLAWS:\n${flawList}\n\nPAPER:\n${questionPaper}`;
        try {
          const rawFixed = await callClaude(fixSys, fixUsr, qTok);
          const fixedPaper = cleanOutput(safeExtractContent(rawFixed));
          const fixedCount = countMarks(fixedPaper);
          if (fixedCount === markTotal) { questionPaper = fixedPaper; log.info(`Phase 2b: fixed ✓`); }
          else log.info(`Phase 2b: fix shifted mark total (${fixedCount}≠${markTotal}) — keeping original`);
        } catch(fixErr) { log.info(`Phase 2b: fix failed (${fixErr.message})`); }
      } else {
        log.info(`Phase 2b: no design flaws ✓`);
      }
    } catch(qErr) { log.info(`Phase 2b: quality check skipped (${qErr.message})`); }
 
    // ── Phase 3A: Generate memo table ──
    const cogLevelRef = plan.questions.map(q => `${q.number} (${q.marks} marks) → ${q.cogLevel}`).join('\n');
    const memoTableRaw = cleanOutput(await callClaude(mSys, mUsrA(questionPaper, markTotal, cogLevelRef), 8192));
    log.info(`Phase 3A: memo table generated (${memoTableRaw.length} chars)`);
 
    // ── Phase 3B: Generate cog analysis + extension + rubric ──
    const memoAnalysisRaw = cleanOutput(await callClaude(mSys, mUsrB(memoTableRaw, markTotal), 8192));
    log.info(`Phase 3B: cog analysis generated (${memoAnalysisRaw.length} chars)`);
 
    const memoContent = memoTableRaw + '\n\n' + memoAnalysisRaw;
 
    // ── Phase 4: Memo Verification + Auto-Correction ──
    const verSys = `You are a senior South African CAPS examiner performing a final accuracy check on a memorandum.
Check EVERY row of the memorandum table:
1. ARITHMETIC — recalculate the answer from scratch. Flag any mismatch.
2. PROFIT_LOSS — income > cost = PROFIT; cost > income = LOSS. Flag wrong label or amount.
3. COUNT — for stem-and-leaf or data set "how many" questions: count every leaf. Flag mismatches.
4. ROUNDING — check rounded value matches marking guidance. Flag if answer uses different value.
5. COG_LEVEL_TOTAL — add up MARK values per cognitive level. Compare to the analysis table. Flag mismatches.
 
Return ONLY valid JSON:
{"errors":[{"question":"7.1a","check":"COUNT","found":"15","correct":"13","fix":"Change answer from 15 to 13 visitors"}],"cogLevelErrors":[{"level":"Knowledge","foundInTable":"16","foundInAnalysis":"15","fix":"Actual Marks for Knowledge should be 16"}],"clean":true}
If no errors: {"errors":[],"cogLevelErrors":[],"clean":true}`;
 
    const verUsr = `QUESTION PAPER:\n${questionPaper}\n\nMEMORANDUM TO VERIFY:\n${memoContent}\n\nCheck every memo row. Report ALL errors.`;
 
    let verifiedMemo = memoContent;
    try {
      const rawVer = await callClaude(verSys, verUsr, 3000);
      let verResult;
      try { verResult = typeof rawVer === 'object' ? rawVer : JSON.parse(rawVer); }
      catch(e) { verResult = { errors: [], cogLevelErrors: [], clean: true }; }
 
      const totalErrors = (verResult.errors || []).length + (verResult.cogLevelErrors || []).length;
      if (totalErrors > 0) {
        log.info(`Phase 4: ${totalErrors} error(s) detected`);
        (verResult.errors || []).forEach(e => log.info(`  Q${e.question} [${e.check}]: found="${e.found}" correct="${e.correct}"`));
        (verResult.cogLevelErrors || []).forEach(e => log.info(`  CogLevel [${e.level}]: table=${e.foundInTable} analysis=${e.foundInAnalysis}`));
 
        const corrMemoSys = `You are correcting specific verified errors in a memorandum.
Fix ONLY the rows and cells listed in the error report. Do not change anything else.
Return the complete corrected memorandum as JSON: {"content":"complete corrected memorandum"}`;
        const allErrors = [
          ...(verResult.errors || []).map(e => `Q${e.question} [${e.check}]: Answer should be "${e.correct}". ${e.fix}`),
          ...(verResult.cogLevelErrors || []).map(e => `Cognitive Level table — ${e.level}: ${e.fix}`)
        ].join('\n');
        const corrMemoUsr = `Correct ONLY these verified errors. Do not change anything else.\n\nERRORS:\n${allErrors}\n\nMEMORANDUM:\n${memoContent}`;
 
        try {
          const rawCorrected = await callClaude(corrMemoSys, corrMemoUsr, 8192);
          const correctedMemo = cleanOutput(safeExtractContent(rawCorrected));
          if (correctedMemo && correctedMemo.length > 500) { verifiedMemo = correctedMemo; log.info(`Phase 4: memo corrected ✓`); }
          else { log.info(`Phase 4: correction too short — keeping original`); verifiedMemo = memoContent; }
        } catch(corrErr) { log.info(`Phase 4: correction failed (${corrErr.message})`); verifiedMemo = memoContent; }
      } else {
        log.info(`Phase 4: memo verified — no errors ✓`);
      }
    } catch(verErr) { log.info(`Phase 4: verification skipped (${verErr.message})`); }
 
    // ── Build DOCX ──
    let docxBase64 = null;
    const filename = (subject + '-' + resourceType + '-Grade' + g + '-Term' + t).replace(/[^a-zA-Z0-9\-]/g, '-') + '.docx';
    try {
      const doc = buildDoc(questionPaper, verifiedMemo, markTotal);
      const buffer = await Packer.toBuffer(doc);
      docxBase64 = buffer.toString('base64');
    } catch (docxErr) {
      log.error({ err: docxErr?.message || docxErr }, 'DOCX build error');
    }
 
    const preview = questionPaper + '\n\n' + verifiedMemo;
    return res.status(200).json({ docxBase64, preview, filename });
 
  } catch (err) {
    log.error({ err: err?.message || err, stack: err?.stack }, 'Generate error');
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({ error: err?.message || 'Server error' });
  }
}
