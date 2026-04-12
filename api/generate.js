import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, TabStopType,
  ShadingType, Header, Footer
} from 'docx';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { subject, topic, resourceType, language, duration, difficulty, includeRubric, grade, term, allTopics } = req.body;
  if (!subject || !resourceType || !language) return res.status(400).json({ error: 'Missing required fields' });

  const g = parseInt(grade) || 6;
  const t = parseInt(term) || 3;
  const phase = g <= 3 ? 'Foundation' : g <= 6 ? 'Intermediate' : 'Senior';
  const isExam = resourceType === 'Exam';
  const isFinalExam = resourceType === 'Final Exam';
  const isWorksheet = resourceType === 'Worksheet';
  const isTest = resourceType === 'Test';

  const totalMarks = parseInt(duration) || 50;

  // Auto-calculate time from marks — no longer sent from UI
  function marksToTime(m) {
    if (m <= 10)  return '15 minutes';
    if (m <= 20)  return '30 minutes';
    if (m <= 25)  return '45 minutes';
    if (m <= 30)  return '45 minutes';
    if (m <= 50)  return '1 hour';
    if (m <= 60)  return '1 hour 30 minutes';
    if (m <= 70)  return '1 hour 45 minutes';
    if (m <= 75)  return '2 hours';
    if (m <= 100) return '2 hours 30 minutes';
    return Math.round(m * 1.5 / 60) + ' hours';
  }
  const timeAllocation = marksToTime(totalMarks);
  const diffNote = difficulty === 'below' ? 'Below grade level' : difficulty === 'above' ? 'Above grade level' : 'On grade level';

  // ═══════════════════════════════════════
  // DoE COGNITIVE LEVELS
  // ═══════════════════════════════════════
  function getCogLevels(subj, gr) {
    const s = (subj || '').toLowerCase();
    if (s.includes('math') || s.includes('wiskunde'))
      return { levels: ['Knowledge', 'Routine Procedures', 'Complex Procedures', 'Problem Solving'], pcts: gr <= 3 ? [25,45,20,10] : [25,45,20,10] };
    if (s.includes('home language') || s.includes('huistaal'))
      return { levels: ['Lower Order/Literal', 'Middle Order/Inferential', 'Higher Order/Critical'], pcts: [30,40,30] };
    if (s.includes('additional') || s.includes('addisionele'))
      return { levels: ['Lower Order/Literal', 'Middle Order/Inferential', 'Higher Order/Critical'], pcts: [40,35,25] };
    if (s.includes('natural') || s.includes('natuur'))
      return { levels: ['Recall', 'Comprehension', 'Application/Analysis', 'Synthesis/Evaluation'], pcts: [25,30,30,15] };
    if (s.includes('social') || s.includes('sosiale'))
      return { levels: ['Knowledge/Recall', 'Comprehension', 'Application/Analysis', 'Synthesis/Evaluation'], pcts: [30,30,25,15] };
    if (s.includes('technolog') || s.includes('tegnol'))
      return { levels: ['Knowledge', 'Comprehension', 'Application', 'Analysis/Evaluation'], pcts: [20,30,35,15] };
    if (s.includes('economic') || s.includes('ekonom'))
      return { levels: ['Knowledge', 'Application', 'Analysis/Synthesis'], pcts: [25,45,30] };
    if (s.includes('life') || s.includes('lewens'))
      return { levels: ['Knowledge', 'Understanding', 'Application'], pcts: [30,40,30] };
    return { levels: ['Lower Order', 'Middle Order', 'Higher Order'], pcts: [30,40,30] };
  }

  const cog = getCogLevels(subject, g);

  // ─── Largest Remainder Method — guarantees marks sum exactly to total ───
  function largestRemainder(total, pcts) {
    const raw = pcts.map(p => total * p / 100);
    const floored = raw.map(Math.floor);
    const remainders = raw.map((v, i) => ({ i, r: v - floored[i] }));
    let deficit = total - floored.reduce((a, b) => a + b, 0);
    remainders.sort((a, b) => b.r - a.r);
    for (let k = 0; k < deficit; k++) floored[remainders[k].i]++;
    return floored;
  }

  const cogMarks = largestRemainder(totalMarks, cog.pcts);
  // Tolerance check (±2% of total) — used in plan validation
  const cogTolerance = Math.max(1, Math.round(totalMarks * 0.02));

  const cogTable = cog.levels.map((l, i) => l + ' ' + cog.pcts[i] + '% = ' + cogMarks[i] + ' marks').join('\n');

  let topicInstruction = '';
  if (isFinalExam && allTopics) topicInstruction = 'FINAL EXAM — cover ALL topics from the entire year:\n' + allTopics;
  else if (isExam && allTopics) topicInstruction = 'TERM EXAM — cover ALL Term ' + t + ' topics:\n' + allTopics;
  else topicInstruction = 'TOPIC: ' + (topic || subject);

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

    // Brand header
    els.push(para('THE RESOURCE ROOM', { bold: true, size: 28, color: GREEN, align: AlignmentType.CENTER, spaceAfter: 60 }));
    els.push(para(resourceType.toUpperCase(), { bold: true, size: 36, align: AlignmentType.CENTER, spaceAfter: 60 }));
    els.push(para(subject, { bold: true, size: 28, align: AlignmentType.CENTER, spaceAfter: 160 }));

    // Borderless table helpers
    const noBorder = { style: BorderStyle.NIL, size: 0, color: 'FFFFFF' };
    const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

    // Grade | Term
    els.push(new Table({
      width: { size: 9026, type: WidthType.DXA },
      columnWidths: [4513, 4513],
      rows: [new TableRow({
        children: [
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA },
            children: [new Paragraph({ children: [txt('Grade ' + g, { size: 24, bold: true })] })] }),
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA },
            children: [new Paragraph({ children: [txt('Term ' + t, { size: 24, bold: true })], alignment: AlignmentType.RIGHT })] })
        ]
      })]
    }));
    els.push(para('', { spaceAfter: 60 }));

    // Name | Date + Surname row
    els.push(new Table({
      width: { size: 9026, type: WidthType.DXA },
      columnWidths: [4513, 4513],
      rows: [
        new TableRow({
          children: [
            new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA },
              children: [new Paragraph({ children: [txt('Name: ___________________________', { size: 22 })] })] }),
            new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA },
              children: [new Paragraph({ children: [txt('Date: ___________________', { size: 22 })], alignment: AlignmentType.RIGHT })] })
          ]
        }),
        new TableRow({
          children: [
            new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA },
              children: [new Paragraph({ children: [txt('Surname: ________________________', { size: 22 })] })] }),
            new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA },
              children: [new Paragraph({ children: [txt('', { size: 22 })] })] })
          ]
        })
      ]
    }));
    els.push(para('', { spaceAfter: 40 }));

    // Examiner | Time (not for worksheets)
    if (!isWorksheet) {
      els.push(new Table({
        width: { size: 9026, type: WidthType.DXA },
        columnWidths: [4513, 4513],
        rows: [new TableRow({
          children: [
            new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA },
              children: [new Paragraph({ children: [txt('Examiner: ______________________', { size: 22 })] })] }),
            new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA },
              children: [new Paragraph({ children: [txt('Time: ' + timeAllocation, { size: 22, bold: true })], alignment: AlignmentType.RIGHT })] })
          ]
        })]
      }));
      els.push(para('', { spaceAfter: 80 }));
    }

    // Total / % / Code score table with Comments row
    const scoreBdr = { style: BorderStyle.SINGLE, size: 4, color: '085041' };
    const scoreBorders = { top: scoreBdr, bottom: scoreBdr, left: scoreBdr, right: scoreBdr };
    const colW = [3611, 1805, 1805, 1805];
    const cm = (w, children, align) => new TableCell({
      borders: scoreBorders, width: { size: w, type: WidthType.DXA },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children, alignment: align || AlignmentType.LEFT })]
    });
    els.push(new Table({
      width: { size: 9026, type: WidthType.DXA },
      columnWidths: colW,
      rows: [
        new TableRow({ children: [
          cm(colW[0], [txt('Total', { bold: true, size: 20 })]),
          cm(colW[1], [txt(String(displayMarks), { bold: true, size: 20 })], AlignmentType.CENTER),
          cm(colW[2], [txt('%', { bold: true, size: 20 })], AlignmentType.CENTER),
          cm(colW[3], [txt('Code', { bold: true, size: 20 })], AlignmentType.CENTER)
        ]}),
        new TableRow({ children: [
          cm(colW[0], [txt('Comments:', { bold: true, size: 18 })]),
          new TableCell({
            borders: scoreBorders,
            columnSpan: 3,
            width: { size: colW[1] + colW[2] + colW[3], type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [txt('', { size: 18 })] })]
          })
        ]})
      ]
    }));
    els.push(para('', { spaceAfter: 120 }));

    // Instructions
    els.push(new Paragraph({ children: [txt('Instructions:', { bold: true, size: 22 })], spacing: { before: 0, after: 60 } }));
    for (const item of [
      'Read the questions properly.',
      'Answer ALL the questions.',
      'Show all working where required.',
      'Pay special attention to the mark allocation of each question.'
    ]) {
      els.push(new Paragraph({
        children: [txt('•  ' + item, { size: 22 })],
        indent: { left: 360 },
        spacing: { before: 0, after: 40 }
      }));
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

      // Numbered items (1.1, 2.3.1, etc.)
      const nm = tr.match(/^(\d+[\.\d]*)\s+(.*)/);
      if (nm && /^\d+\.\d+/.test(tr)) { els.push(numQ(nm[1], nm[2])); continue; }

      // MCQ options
      if (/^[a-d]\.\s/.test(tr)) { els.push(optLine(tr)); continue; }

      // Answer/Working
      if (/^Answer:/i.test(tr) || /^Antwoord:/i.test(tr)) { els.push(ansLine()); continue; }
      if (/^Working:/i.test(tr) || /^Werking:/i.test(tr)) { els.push(workLine()); continue; }

      // Blank lines
      if (/^_{5,}$/.test(tr)) { els.push(blankLine()); continue; }

      // Pipe tables
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

      // Default
      els.push(para(tr));
    }
    return els;
  }

  // ═══════════════════════════════════════
  // BUILD DOCUMENT
  // ═══════════════════════════════════════
  function buildDoc(qText, mText, actualMarks) {
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
        children: [...cover, ...parseText(qText), ...parseText(mText)]
      }]
    });
  }

  // ═══════════════════════════════════════
  // CLAUDE API
  // ═══════════════════════════════════════
  async function callClaude(system, user, maxTok) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 120s timeout per call
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTok, system, messages: [{ role: 'user', content: user }] })
      });
      const text = await r.text();
      if (!r.ok) throw new Error(JSON.parse(text).error?.message || 'API error ' + r.status);
      let raw = JSON.parse(text).content?.map(c => c.text || '').join('') || '';
      raw = raw.replace(/```json|```/g, '').trim();
      try { return JSON.parse(raw).content || raw; } catch(e) {
        let c = raw.replace(/^\s*\{\s*"content"\s*:\s*"/, '').replace(/"\s*\}\s*$/, '');
        return c.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
      }
    } catch(err) {
      if (err.name === 'AbortError') throw new Error('Generation is taking longer than usual. Please try again — complex resources can take up to 2 minutes.');
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ═══════════════════════════════════════
  // SAFE CONTENT EXTRACTOR
  // Strips JSON wrappers, reasoning preambles, and any text before
  // the actual content. Used for all phase outputs to prevent leaks.
  // ═══════════════════════════════════════
  function safeExtractContent(raw) {
    if (!raw || typeof raw !== 'string') return raw;
    let text = raw.trim();

    // Remove JSON wrapper variations
    text = text.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim();
    text = text.replace(/^\{\s*"content"\s*:\s*"/, '').replace(/"\s*\}\s*$/, '').trim();

    // If it looks like the whole thing is still JSON, try to parse it
    if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text);
        if (parsed.content) return parsed.content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
      } catch(e) {}
    }

    // Strip any leading lines that look like reasoning preambles
    // (before the actual question paper content starts)
    const lines = text.split('\n');
    let startIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      // Question paper content starts with SECTION, Question, or a numbered item
      if (/^(SECTION|Question\s+\d|\d+\.\d|TOTAL:|MEMORANDUM)/i.test(l)) {
        startIdx = i;
        break;
      }
      // If we find JSON content wrapper mid-text, skip everything before it
      if (l.startsWith('{"content"')) {
        // Extract from here
        const remainder = lines.slice(i).join('\n');
        return safeExtractContent(remainder);
      }
    }
    if (startIdx > 0) {
      text = lines.slice(startIdx).join('\n');
    }

    return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
  }

  // ═══════════════════════════════════════
  // CLEANUP — remove AI meta-commentary
  // ═══════════════════════════════════════
  function cleanOutput(text) {
    // Remove leaked prompt instructions and AI meta-commentary line by line
    const lines = text.split('\n').filter(line => {
      const t = line.trim().toUpperCase();
      const tr = line.trim();

      // Strip prompt step headings that leaked into output
      if (/^STEP\s+\d+\s*[—\-–]?/i.test(tr)) return false;
      if (/^STEP\s+\d+$/i.test(tr)) return false;

      // Strip corrected/updated table headers
      if (t.startsWith('CORRECTED ') || t.startsWith('UPDATED ')) return false;
      if (t.includes('CORRECTED MEMORANDUM') || t.includes('CORRECTED COGNITIVE')) return false;
      if (t.includes('CORRECTED COGNITIVE LEVEL')) return false;

      // Strip AI meta-commentary and reasoning
      if (t.startsWith('NOTE:') || t.startsWith('NOTE ') || t.startsWith('NOTE TO')) return false;
      if (t.includes('DISCREPANCY') || t.includes('RECONCILIATION')) return false;
      if (t.startsWith('REVISED ') || t.startsWith('FINAL INSTRUCTION') || t.startsWith('FINAL CONFIRMED')) return false;
      if (t.startsWith('THE QUESTION PAPER AS') || t.startsWith('THE PAPER AS')) return false;
      if (t.startsWith('RECOMMENDED ADJUSTMENT') || t.startsWith('TEACHERS SHOULD')) return false;
      if (t.startsWith('RECOUNT:') || t.startsWith('RE-EXAMINE') || t.startsWith('RE-COUNT')) return false;
      if (t.startsWith('VERIFY:') || t.startsWith('VERIFY ALL') || t.startsWith('CHECK:')) return false;
      if (t.startsWith('REMOVE ') || t.startsWith('MOVE ') || t.startsWith('PLACE ')) return false;
      if (t.includes('ALREADY COUNTED') || t.includes('ALREADY IN ')) return false;
      if (t.startsWith('CUMULATIVE') || t.includes('CUMULATIVE ')) return false;
      if (t.startsWith('THAT GIVES') || t.startsWith('THIS GIVES')) return false;
      if (t.startsWith('SO ROUTINE') || t.startsWith('SO COMPLEX') || t.startsWith('SO KNOWLEDGE')) return false;
      if (t.startsWith('WITHOUT ') && t.includes(' RECOUNT')) return false;
      if (t.startsWith('ALL OTHER COGNITIVE') || t.startsWith('ALL OTHER LEVEL')) return false;
      if (/^(KNOWLEDGE|ROUTINE|COMPLEX|PROBLEM)\s+ROWS?:/i.test(tr)) return false;

      // Strip standalone "THE RESOURCE ROOM" lines that duplicate the cover page
      // Match with or without markdown bold markers
      if (/^(\*{0,2})THE RESOURCE ROOM(\*{0,2})\s*$/i.test(tr)) return false;

      // Strip mark-reasoning lines that leak into question paper
      // e.g. "Marks: (1) + (1) = but written as one question: (3)"
      if (/^MARKS?:/i.test(tr) && /written as|include also|one question/i.test(tr)) return false;
      // Strip any line that is purely an internal note about mark splits
      if (/^\(\d+\)\s*\+\s*\(\d+\)/.test(tr)) return false;
      // Strip "[Diagram..." placeholder notes that leaked into learner paper
      if (/^\[diagram/i.test(tr) || /^\[figure/i.test(tr) || /^\[image/i.test(tr)) return false;
      if (/^\[an angle/i.test(tr) || /^\[a shape/i.test(tr) || /^\[the shape/i.test(tr)) return false;
      // Strip Phase 2b self-correction reasoning that leaks into paper
      if (/^TRY\s+/i.test(tr) || /^USE\s+\*\*/i.test(tr)) return false;
      if (/^NEW DATA SET/i.test(tr) || /^CHECKING CONSISTENCY/i.test(tr)) return false;
      if (/^LET ME TRY/i.test(tr) || /^LET'S TRY/i.test(tr)) return false;
      if (/^WAIT\s*[—\-–]/i.test(tr) || t.startsWith('WAIT ')) return false;
      if (/^I MUST RECHECK/i.test(tr) || /^LET ME RECHECK/i.test(tr)) return false;
      if (/^RECHECK:/i.test(tr) || /^CHECKING:/i.test(tr)) return false;
      if (/^COST\s*=/i.test(tr) || /^INCOME\s*=/i.test(tr)) return false;
      if (/^SINCE\s+R\d/i.test(tr)) return false;

      return true;
    });

    // Also strip multi-line AI reasoning blocks:
    // Any line longer than 300 chars that contains both calculation notation
    // and meta-words is likely a leaked reasoning paragraph — truncate to empty
    const cleaned = lines.map(line => {
      if (line.length > 300 &&
          /recount|already counted|cumulative|verify|reconcil/i.test(line) &&
          /\d+\s*\+\s*\d+/.test(line)) {
        return '';
      }
      return line;
    });

    // Collapse multiple consecutive blank lines into one
    const result = [];
    let blanks = 0;
    for (const line of cleaned) {
      if (line.trim() === '') {
        blanks++;
        if (blanks <= 1) result.push(line);
      } else {
        blanks = 0;
        result.push(line);
      }
    }

    // Fix 3 (strengthened) — Remove everything from the SECOND occurrence of the
    // cognitive level table. Detects BOTH the section heading AND the pipe table
    // header row ("Prescribed %") so it catches duplicates even when the second
    // table appears without a heading — which is what caused the Test 12 failure.
    const cogHeadingRx = /COGNITIVE LEVEL/i;
    const cogTableRowRx = /Prescribed\s*%/i;
    let cogCount = 0;
    const deduped = [];
    for (const line of result) {
      if (cogHeadingRx.test(line) || cogTableRowRx.test(line)) {
        cogCount++;
        if (cogCount === 2) break; // Drop the second table and everything after it
      }
      deduped.push(line);
    }

    return deduped.join('\n');
  }

  // ═══════════════════════════════════════
  // MARK COUNTER — parse (X) marks from question paper
  // ═══════════════════════════════════════
  function countMarks(text) {
    let total = 0;
    const markPattern = /\((\d+)\)\s*$/gm;
    let match;
    while ((match = markPattern.exec(text)) !== null) {
      total += parseInt(match[1]);
    }
    if (total === 0) {
      const blockPattern = /\[(\d+)\]/g;
      while ((match = blockPattern.exec(text)) !== null) {
        total += parseInt(match[1]);
      }
    }
    return total;
  }

  // ═══════════════════════════════════════
  // QUESTION TYPE → COGNITIVE LEVEL RULES
  // Low-demand types cap at Knowledge/Recall level
  // These rules are subject-agnostic and scale with any pcts array
  // ═══════════════════════════════════════
  const LOW_DEMAND_TYPES = ['MCQ', 'True/False', 'True-False', 'Matching', 'True or False'];
  const HIGH_DEMAND_TYPES = ['Multi-step', 'Word Problem', 'Extended Response', 'Essay', 'Investigation', 'Analysis'];

  // First level in any subject's cog array is always the lowest (Knowledge/Recall/Lower Order)
  const maxLowDemandMarks = cogMarks[0];
  // Last two levels are always the highest (Complex + Problem Solving, or equivalent)
  const highDemandLevels = cog.levels.slice(Math.max(0, cog.levels.length - 2));

  // ═══════════════════════════════════════
  // PHASE 1 — PLAN VALIDATOR
  // Returns validated plan or null if invalid
  // ═══════════════════════════════════════
  function validatePlan(plan) {
    if (!plan || !Array.isArray(plan.questions) || plan.questions.length === 0) return null;

    // Rule 1: Total marks must be exact
    const planTotal = plan.questions.reduce((s, q) => s + (parseInt(q.marks) || 0), 0);
    if (planTotal !== totalMarks) {
      console.log(`Plan total ${planTotal} !== requested ${totalMarks} — rejecting`);
      return null;
    }

    // Rule 2: Cognitive level marks within ±2% tolerance
    const cogActual = {};
    cog.levels.forEach(l => cogActual[l] = 0);
    for (const q of plan.questions) {
      const lvl = q.cogLevel;
      if (cogActual[lvl] !== undefined) cogActual[lvl] += parseInt(q.marks) || 0;
    }
    for (let i = 0; i < cog.levels.length; i++) {
      const actual = cogActual[cog.levels[i]] || 0;
      const target = cogMarks[i];
      if (Math.abs(actual - target) > cogTolerance) {
        console.log(`Cog level "${cog.levels[i]}" has ${actual} marks, target ${target} ±${cogTolerance} — rejecting`);
        return null;
      }
    }

    // Rule 3: MCQ + True/False total marks must not exceed the lowest cognitive level allocation
    // (You cannot fulfil Routine/Complex/Problem Solving with recall-type questions)
    const lowDemandTotal = plan.questions
      .filter(q => LOW_DEMAND_TYPES.some(t => (q.type || '').toLowerCase().includes(t.toLowerCase())))
      .reduce((s, q) => s + (parseInt(q.marks) || 0), 0);
    if (lowDemandTotal > maxLowDemandMarks) {
      console.log(`Low-demand question types (MCQ/T/F) total ${lowDemandTotal} marks, max allowed ${maxLowDemandMarks} — rejecting`);
      return null;
    }

    // Rule 4: High cognitive level questions must use appropriate question types
    // Complex Procedures and Problem Solving cannot be MCQ or True/False
    for (const q of plan.questions) {
      const isHighLevel = highDemandLevels.includes(q.cogLevel);
      const isLowType = LOW_DEMAND_TYPES.some(t => (q.type || '').toLowerCase().includes(t.toLowerCase()));
      if (isHighLevel && isLowType) {
        console.log(`Question ${q.number} is ${q.cogLevel} but uses ${q.type} — MCQ/T/F cannot serve high cognitive levels — rejecting`);
        return null;
      }
    }

    return plan;
  }

  // ═══════════════════════════════════════
  // PROMPTS
  // ═══════════════════════════════════════

  // Plan prompt — Phase 1 (cheap, fast, validated before writing)
  const planSys = `You are a South African CAPS ${phase} Phase assessment designer.
Return ONLY valid JSON — no markdown, no explanation.
Schema: {"questions":[{"number":"Q1","type":"MCQ","topic":"string","marks":5,"cogLevel":"${cog.levels[0]}"},...]}
cogLevel must be exactly one of: ${cog.levels.join(' | ')}`;

  const planUsr = `Design a ${totalMarks}-mark ${resourceType} question plan for: Grade ${g} ${subject} Term ${t} in ${language}.
${topicInstruction}

CAPS DoE cognitive level targets — marks must hit each level within ±${cogTolerance} marks:
${cog.levels.map((l, i) => `  ${l}: ${cogMarks[i]} marks (${cog.pcts[i]}%)`).join('\n')}

QUESTION TYPE RULES — these are strict and non-negotiable:
1. MCQ and True/False questions are LOW DEMAND — they address recall only.
   Total marks from MCQ + True/False combined must NOT exceed ${cogMarks[0]} marks.
   MCQ and True/False can ONLY serve the "${cog.levels[0]}" level.

2. The following levels MUST use higher-order question types:\n${cog.levels.slice(1).map((l, i) => '   "' + l + '": use ' + (i === 0 ? 'Short Answer, Calculations, Structured Question, Fill in the blank' : i === cog.levels.length - 2 ? 'Multi-step Calculations, Structured Question, Analysis' : 'Word Problem, Extended Response, Essay, Investigation, Multi-step')).join('\n')}
3. Every question must have: number (Q1, Q2...), type, topic, marks (whole number ≥ 1), cogLevel
4. Questions must sum to EXACTLY ${totalMarks} marks
5. Minimum ${isWorksheet ? '4' : '6'} questions — spread topics across the ${subject} curriculum

Return only the JSON object, nothing else.`;

  // Question writing prompt — Phase 2 (writes from validated blueprint)
  const qSys = (plan) => `You are a South African CAPS ${phase} Phase teacher writing a ${resourceType} question paper in ${language}.
Use SA context (rands, names: Sipho, Ayanda, Zanele, Thandi, Pieter, Anri, SA places).
DIFFICULTY: ${diffNote}
CAPS: Grade ${g} Term ${t} ${subject}

CRITICAL: Follow the question plan EXACTLY. Do not change any mark values. Do not add or remove questions.
The plan guarantees CAPS cognitive level compliance — trust it and write accordingly.

DO NOT INCLUDE:
- NO cover page, title, header, name/date fields, or instructions — start DIRECTLY with Question 1
- NO cognitive level labels in the paper
- NO notes, commentary, or meta-text — this includes notes about mark allocation, instructions to the teacher, or explanations of how marks are split
- NO Unicode box characters or Unicode fraction symbols — write fractions as plain text: 1/2, 3/4, 2/3

NO DIAGRAMS RULE (applies to ALL subjects — non-negotiable):
This system cannot render or print diagrams, graphs, drawings, or images of any kind.
Therefore you MUST NOT write any question that requires the learner to:
- Look at, read from, or interpret a drawn diagram, shape, graph, map, or image
- Measure anything from a drawing (angles, lengths, distances)
- Identify features of a drawn figure
- Use a protractor, ruler, or any measuring tool on a printed diagram
- Complete or label a drawn figure

INSTEAD, for every question type, use text-only alternatives:
- Angles: provide the angle value in the question → ask learner to classify or calculate
  ✓ CORRECT: "An angle measures 65°. Classify this angle as acute, obtuse, reflex or right."
  ✗ WRONG:   "Measure the angle below using a protractor."
  ✗ WRONG:   "Use a protractor to measure the angle in the diagram."
- Shapes: describe dimensions in words → ask learner to calculate area/perimeter
  ✓ CORRECT: "A rectangle has a length of 10 cm and a width of 4 cm. Calculate its area."
  ✗ WRONG:   "Calculate the area of the shape shown below."
- Compound shapes: describe each component in words with measurements
  ✓ CORRECT: "A shape is made of two rectangles: Rectangle A (10 cm × 4 cm) and Rectangle B (6 cm × 3 cm)."
  ✗ WRONG:   "Calculate the area of the L-shaped figure below."
- Graphs/charts: describe the data in words or a table → ask questions from that
  ✓ CORRECT: Provide a stem-and-leaf table in text/pipe format
  ✗ WRONG:   "Study the bar graph below and answer the questions."
- Maps/diagrams: describe the scenario in words
  ✓ CORRECT: "A garden is 14 m long and 9 m wide."
  ✗ WRONG:   "Study the map below."

This rule applies to EVERY subject: Mathematics, Natural Sciences, Social Sciences,
English, Afrikaans, Technology, and all others. No exceptions.

FORMAT RULES:
- Numbering: Question 1: [heading] then 1.1, 1.2, 1.2.1 etc
- EVERY sub-question MUST show its mark in brackets on the SAME LINE as the question text, even when Working:/Answer: lines follow
  CORRECT:   1.1  Calculate the area of the rectangle. (2)
             Working: _______________________________________________
             Answer:  _______________________________________________
  INCORRECT: 1.1  Calculate the area of the rectangle.
             Working: _______________________________________________ (2)
- MCQ options: EVERY MCQ sub-question MUST show (1) on the question line BEFORE the options
  CORRECT:   1.1  Which fraction equals 3/4? (1)
             a. 6/8   b. 9/12   c. 6/9   d. 4/8
             Answer: ___
  INCORRECT: 1.1  Which fraction equals 3/4?
             a. 6/8   b. 9/12   c. 6/9   d. 4/8   (1)
- True/False: statement then blank then (marks) all on ONE line: "2.1 The mode is the middle value. _______________ (1)"
- Answer lines: _______________________________________________
- Working:/Answer: lines only for calculation questions
- Question block totals: [X] right-aligned at end of each question
${isTest ? '- NO SECTION headers. Use Question 1, Question 2 etc.' : ''}
${(isExam || isFinalExam) ? '- USE SECTION A / B / C / D headers' : ''}
- Write fractions as plain text: 3/4 not ¾, 2/3 not ²⁄₃

ORDERING/ASCENDING/DESCENDING QUESTION RULE:
- Never include two values that are mathematically equal in an ordering question
- Before writing, convert ALL values to decimals to check they are all distinct
- INVALID example: "Order 0.6 ; 1/4 ; 0.3 ; 3/5" — 0.6 = 3/5 = 0.60, they are equal
- VALID example: "Order 0.4 ; 1/4 ; 0.3 ; 3/5" — all distinct: 0.40, 0.25, 0.30, 0.60

End with: TOTAL: _____ / ${totalMarks} marks

Return JSON: {"content":"question paper text only — no cover page, no memo"}`;

  const qUsr = (plan) => `Write the question paper following this EXACT plan — do not change any marks:
${JSON.stringify(plan.questions, null, 2)}

Subject: ${subject} | Grade: ${g} | Term: ${t} | Language: ${language}
${topicInstruction}
Total must be: ${totalMarks} marks`;

  // Memo prompt — Phase 3
  const mSys = `You are a South African CAPS Grade ${g} ${subject} teacher creating a memorandum in ${language}.

CRITICAL RULES:
- Use pipe | tables only. No Unicode box characters.
- Output ONLY the memorandum content — no headings like "STEP 1", "STEP 2", "CORRECTED", "Updated" etc.
- No notes, adjustments, commentary, or reasoning outside tables. Just answers.
- Generate each cognitive level table ONCE. Never repeat it or add a "corrected" version.
- Write fractions as plain text: 3/4 not ¾
- Do NOT question or adjust the mark allocation — use marks exactly as shown in the paper.
- Do NOT show your working or reasoning anywhere in the output — only final answers in tables.

MEDIAN RULE (strictly follow this):
- Sort ALL data values from smallest to largest first
- Count the total number of values (n)
- If n is odd: median = the middle value at position (n+1)/2
- If n is even: median = the average of the values at positions n/2 and (n/2)+1
- Count position by position through the sorted list — do not skip repeated values
- Example: sorted data 23,27,29,31,31,31,35,35,38,42 has n=10
  Position 5 = 31, Position 6 = 31, Median = (31+31)/2 = 31 (NOT 33)

STEM-AND-LEAF COUNT RULE (strictly follow this):
- To count values in a stem-and-leaf plot: count every individual leaf digit — do NOT estimate
- Write out the count per stem row first, then add them: stem1=4, stem2=5, stem3=2, stem4=2 → total=13
- Write your count in the ANSWER cell. Do not second-guess it or "correct" it after writing.

DECIMAL ROUNDING RULE (strictly follow this):
- When a calculation produces a non-terminating decimal (e.g. 333÷13=25.615...), round to 1 decimal place
- The ANSWER cell MUST use the same rounded value shown at the end of your MARKING GUIDANCE
- If guidance says "≈ 25.6" then answer must be "25.6" — never write "25.7" if guidance shows "25.6"
- Round once, use that value everywhere

COGNITIVE LEVEL TABLE RULE (strictly follow this):
- Write the MEMORANDUM table first with every sub-question's MARK column filled in
- THEN fill the COGNITIVE LEVEL ANALYSIS table by mechanically adding up the MARK values
  from the memorandum table above — grouped by their COGNITIVE LEVEL column
- The Actual Marks for each level MUST equal the sum of MARK values in that level's rows
- The four Actual Marks values MUST sum to exactly the paper total
- Do NOT copy prescribed marks into the actual marks column
- Do NOT estimate or guess — count from the table above

Return JSON: {"content":"memorandum text"}`;

  const mUsr = (qp, actualTotal) => `Grade ${g} ${subject} — ${resourceType} — Term ${t}

Question paper — read every (X) mark carefully before writing anything:

${qp}

This paper totals ${actualTotal} marks.

Write the following sections IN THIS EXACT ORDER. Complete each section FULLY before starting the next. Never skip a question.

SECTION 1 — MEMORANDUM TABLE (write this first and completely — do not stop until every sub-question is listed):
NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK
- List EVERY SINGLE sub-question from the question paper — scan through every Question block and list every numbered sub-question including sub-parts like 5.1a, 5.1b
- Do NOT skip any question — if you finish the table and the mark total does not equal ${actualTotal}, you have missed questions
- Use the EXACT (X) mark shown on each question line — never change it
- Copy the COGNITIVE LEVEL from the REFERENCE TABLE above — do not reassign
- For financial questions: apply PROFIT/LOSS RULE before writing the answer
- Do not write any step headings in your output

Then write: TOTAL: ${actualTotal} marks

SECTION 2 — COGNITIVE LEVEL ANALYSIS (write this second, completely):
Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual %
${cog.levels.map((l, i) => l + ' | ' + cog.pcts[i] + '% | ' + cogMarks[i]).join('\n')}
For EACH level row:
- Actual Marks = sum of MARK column values from Section 1 table where COGNITIVE LEVEL matches
- Actual % = (Actual Marks / ${actualTotal}) × 100, rounded to 1 decimal place
- All Actual Marks values MUST sum to ${actualTotal}
Then write ONE summary line per level:
[Level name] ([total] marks): Q1.1 (1) + Q2.3 (2) + ... = [total] marks

${!isWorksheet ? 'SECTION 3 — EXTENSION ACTIVITY (write this third):\nOne challenging question with a complete model answer.' : ''}

${includeRubric ? 'SECTION 4 — MARKING RUBRIC (write this last):\nCRITERIA | Level 5 Outstanding (90-100%) | Level 4 Good (75-89%) | Level 3 Satisfactory (60-74%) | Level 2 Needs Improvement (40-59%) | Level 1 Not Achieved (0-39%)\nWrite 3-4 subject-relevant criteria rows for ' + subject + '.' : ''}`;

  // ═══════════════════════════════════════
  // EXECUTE — 3-phase generation
  // ═══════════════════════════════════════
  try {
    // ── Phase 1: Generate & validate question plan ──
    let plan = null;
    let planAttempts = 0;
    while (!plan && planAttempts < 2) {
      planAttempts++;
      try {
        const rawPlan = await callClaude(planSys, planUsr, 1500);
        let parsedPlan;
        try {
          parsedPlan = typeof rawPlan === 'object' ? rawPlan : JSON.parse(rawPlan);
        } catch(e) {
          console.log(`Plan attempt ${planAttempts}: JSON parse failed`);
          continue;
        }
        plan = validatePlan(parsedPlan);
        if (!plan) console.log(`Plan attempt ${planAttempts}: validation failed`);
      } catch(e) {
        console.log(`Plan attempt ${planAttempts}: error — ${e.message}`);
      }
    }

    // If plan fails validation twice, build a guaranteed-correct fallback plan in JS
    // This plan always passes validation because we build it from the rules directly
    if (!plan) {
      console.log('Plan validation failed — using JS fallback plan');
      const fallbackQuestions = [];

      // Type map per cognitive level index — respects the type rules
      // Index 0 = Knowledge/Recall/Lower Order → MCQ allowed
      // Index 1 = Routine/Comprehension/Middle → Short Answer/Calculations
      // Index 2 = Complex/Application/Higher   → Multi-step/Structured
      // Index 3 = Problem Solving/Synthesis    → Word Problem/Essay
      const typeByLevel = [
        'MCQ',                  // level 0: Knowledge/Recall/Lower Order
        'Short Answer',         // level 1: Routine/Middle Order
        'Multi-step',           // level 2: Complex/Application
        'Word Problem',         // level 3: Problem Solving/Synthesis
      ];

      cog.levels.forEach((lvl, li) => {
        let lvlMarks = cogMarks[li];
        const qType = typeByLevel[Math.min(li, typeByLevel.length - 1)];
        // Chunk size: Knowledge questions small (5 max), others larger
        const chunkSize = li === 0 ? 5 : 10;
        while (lvlMarks > 0) {
          const chunk = Math.min(lvlMarks, chunkSize);
          fallbackQuestions.push({
            number: 'Q' + (fallbackQuestions.length + 1),
            type: qType,
            topic: topic || subject,
            marks: chunk,
            cogLevel: lvl
          });
          lvlMarks -= chunk;
        }
      });

      plan = { questions: fallbackQuestions };
      console.log(`Fallback plan: ${fallbackQuestions.length} questions, ${fallbackQuestions.reduce((s,q)=>s+q.marks,0)} marks`);
    }

    console.log(`Plan validated: ${plan.questions.length} questions, ${plan.questions.reduce((s,q)=>s+q.marks,0)} marks`);

    // ── Phase 2: Write questions from validated plan ──
    const qTok = isWorksheet ? 3000 : (isExam || isFinalExam) ? 5500 : 4500;
    let questionPaper = await callClaude(qSys(plan), qUsr(plan), qTok);
    questionPaper = cleanOutput(questionPaper);

    // ── Phase 2a: Correction step — fix mark drift if Claude deviated ──
    const countedAfterP2 = countMarks(questionPaper);
    const drift = countedAfterP2 - totalMarks;
    if (countedAfterP2 > 0 && drift !== 0) {
      console.log(`Mark drift detected: counted=${countedAfterP2}, target=${totalMarks}, drift=${drift > 0 ? '+' : ''}${drift} — running correction`);

      // Find which question block has the discrepancy by comparing plan vs paper
      const planByQ = {};
      plan.questions.forEach(q => { planByQ[q.number] = q.marks; });

      const corrSys = `You are correcting a ${subject} ${resourceType} question paper. The paper currently totals ${countedAfterP2} marks but must total EXACTLY ${totalMarks} marks. You need to ${drift > 0 ? 'reduce' : 'increase'} the total by ${Math.abs(drift)} mark${Math.abs(drift) > 1 ? 's' : ''}.

RULES:
- Change the minimum number of sub-question mark values needed to fix the total
- Only change the (X) mark numbers — do not rewrite questions or change content
- Keep all Working:/Answer: lines exactly as they are
- The corrected paper must total EXACTLY ${totalMarks} marks
- Return the complete corrected paper
Return JSON: {"content":"complete corrected question paper"}`;

      const corrUsr = `This question paper totals ${countedAfterP2} marks but must be EXACTLY ${totalMarks} marks.
Difference: ${drift > 0 ? 'reduce by' : 'increase by'} ${Math.abs(drift)} mark${Math.abs(drift) > 1 ? 's' : ''}.

PAPER:
${questionPaper}

Return the complete corrected paper with the mark values adjusted. Every sub-question mark in brackets (X) must be correct. Do not change any question content — only the (X) numbers.`;

      try {
        const corrected = cleanOutput(await callClaude(corrSys, corrUsr, qTok));
        const countedAfterCorr = countMarks(corrected);
        if (countedAfterCorr === totalMarks) {
          questionPaper = corrected;
          console.log(`Correction successful: paper now totals ${countedAfterCorr} marks ✓`);
        } else {
          console.log(`Correction attempt resulted in ${countedAfterCorr} marks — keeping Phase 2 paper`);
        }
      } catch(corrErr) {
        console.log(`Correction step failed: ${corrErr.message} — keeping Phase 2 paper`);
      }
    } else if (countedAfterP2 === totalMarks) {
      console.log(`Phase 2 exact: ${countedAfterP2} marks ✓`);
    }

    // Final mark count — after correction attempt
    const finalCount = countMarks(questionPaper);
    const markTotal = finalCount > 0 ? finalCount : totalMarks;
    console.log(`Final mark total: ${markTotal}`);


    // ── Phase 2b: Question Quality Check ──
    // Catches design flaws BEFORE the memo is written so the memo never has to
    // answer a broken question. Runs fast — analytical only, small output.
    const qQualitySys = `You are a South African CAPS examiner reviewing a question paper for design flaws.
Return ONLY valid JSON — no markdown, no explanation outside the JSON.

Check every question for these flaws:
1. ORDERING_EQUAL_VALUES — any ordering/ascending/descending question where two or more values are mathematically equal (e.g. 0.6 and 3/5 are both 0.60). Flag with suggested replacement value.
2. MCQ_MULTIPLE_CORRECT — any MCQ where more than one option gives the correct answer when calculated.
3. MCQ_NO_CORRECT — any MCQ where no option is the correct answer.
4. DATA_AMBIGUOUS — any data set question where the data is ambiguous (e.g. multiple modes when question says "the mode").
5. QUESTION_IMPOSSIBLE — any question that cannot be answered with the information given.

Return schema:
{"flaws":[{"question":"4.3","type":"ORDERING_EQUAL_VALUES","detail":"0.6 and 3/5 are both 0.60 — ordering is ambiguous","fix":"Replace 3/5 with 2/5 to make all values distinct"}],"clean":false}
If no flaws: {"flaws":[],"clean":true}`;

    const qQualityUsr = `Review this question paper for the specific design flaws listed above:

${questionPaper}`;

    try {
      const rawQuality = await callClaude(qQualitySys, qQualityUsr, 1200);
      let qualityResult;
      try {
        qualityResult = typeof rawQuality === 'object' ? rawQuality : JSON.parse(rawQuality);
      } catch(e) { qualityResult = { flaws: [], clean: true }; }

      if (qualityResult.flaws && qualityResult.flaws.length > 0) {
        console.log(`Phase 2b: ${qualityResult.flaws.length} flaw(s) detected:`);
        qualityResult.flaws.forEach(f => console.log(`  Q${f.question} [${f.type}]: ${f.detail}`));

        const fixSys = `You are correcting specific design flaws in a ${subject} question paper.
OUTPUT RULES — strictly follow these or the output will be rejected:
- Output the complete corrected question paper ONLY
- Start your output IMMEDIATELY with the first line of the paper (e.g. "SECTION A" or "Question 1")
- Do NOT write any explanation, reasoning, preamble, or notes before or after the paper
- Do NOT wrap in JSON — output the raw paper text directly
- Do NOT write "Here is the corrected paper" or similar
- Rewrite ONLY the flagged questions — leave everything else character-for-character identical
- Preserve every (X) mark value exactly`;

        const flawList = qualityResult.flaws.map(f =>
          `Q${f.question}: [${f.type}] ${f.detail} — Fix: ${f.fix}`
        ).join('\n');

        const fixUsr = `Fix ONLY these specific flaws. Output the complete corrected paper with NO preamble.\n\nFLAWS TO FIX:\n${flawList}\n\nCOMPLETE PAPER (copy everything, fix only flagged questions):\n${questionPaper}`;

        try {
          const rawFixed = await callClaude(fixSys, fixUsr, qTok);
          const fixedPaper = cleanOutput(safeExtractContent(rawFixed));
          const fixedCount = countMarks(fixedPaper);
          if (fixedCount === markTotal) {
            questionPaper = fixedPaper;
            console.log(`Phase 2b: fixed — mark total preserved at ${fixedCount} marks ✓`);
          } else {
            console.log(`Phase 2b: fix shifted mark total (${fixedCount}≠${markTotal}) — keeping original`);
          }
        } catch(fixErr) {
          console.log(`Phase 2b: fix failed (${fixErr.message}) — keeping original`);
        }
      } else {
        console.log(`Phase 2b: no design flaws detected ✓`);
      }
    } catch(qErr) {
      console.log(`Phase 2b: quality check skipped (${qErr.message})`);
    }

    // ── Phase 3: Generate memorandum ──
    const memoContent = cleanOutput(await callClaude(mSys, mUsr(questionPaper, markTotal), 8192));


    // ── Phase 4: Memo Verification + Auto-Correction ──
    // Reads the finished memo and verifies every answer independently.
    // Catches arithmetic errors, wrong profit/loss labels, wrong counts,
    // rounding mismatches, and cognitive level total errors — regardless
    // of subject, grade, or resource type.
    const verSys = `You are a senior South African mathematics examiner performing a final accuracy check on a memorandum.
You will receive the question paper and the completed memorandum.
Your job is to find errors — be thorough and precise.

Check EVERY row of the memorandum table:

1. ARITHMETIC — recalculate the answer from scratch using only the question data.
   Does your calculation match the ANSWER cell? Flag any mismatch.

2. PROFIT_LOSS — for any question involving profit, loss, income, cost, or savings:
   - Calculate: income/selling price vs cost/expenses
   - If income > cost → PROFIT of (income − cost)
   - If cost > income → LOSS of (cost − income)
   - Flag if the ANSWER cell uses the wrong label or wrong amount.

3. COUNT — for any question asking "how many" from a stem-and-leaf plot or data set:
   - Count every individual leaf/value in the plot
   - Flag if ANSWER cell does not match your count.

4. ROUNDING — if MARKING GUIDANCE shows a decimal calculation:
   - Check the rounded value in the guidance
   - Flag if ANSWER cell uses a different rounded value.

5. COG_LEVEL_TOTAL — add up all MARK values per cognitive level from the memo table.
   Compare to the COGNITIVE LEVEL ANALYSIS table's Actual Marks column.
   Flag any mismatch.

Return ONLY valid JSON — no markdown, no explanation outside the JSON:
{
  "errors": [
    {
      "question": "7.1a",
      "check": "COUNT",
      "found": "15",
      "correct": "13",
      "fix": "Change answer from '15 visitors' to '13 visitors'. Stem 1: 4 leaves, Stem 2: 5 leaves, Stem 3: 2 leaves, Stem 4: 2 leaves = 13 total."
    }
  ],
  "cogLevelErrors": [
    {
      "level": "Knowledge",
      "foundInTable": "16",
      "foundInAnalysis": "15",
      "fix": "Actual Marks for Knowledge should be 16, not 15"
    }
  ],
  "clean": true
}
If no errors found, return {"errors":[],"cogLevelErrors":[],"clean":true}`;

    const verUsr = `QUESTION PAPER:
${questionPaper}

MEMORANDUM TO VERIFY:
${memoContent}

Check every memo row against the question paper. Report ALL errors.`;

    let verifiedMemo = memoContent;
    try {
      const rawVer = await callClaude(verSys, verUsr, 3000);
      let verResult;
      try {
        verResult = typeof rawVer === 'object' ? rawVer : JSON.parse(rawVer);
      } catch(e) { verResult = { errors: [], cogLevelErrors: [], clean: true }; }

      const totalErrors = (verResult.errors || []).length + (verResult.cogLevelErrors || []).length;

      if (totalErrors > 0) {
        console.log(`Phase 4: ${totalErrors} memo error(s) detected:`);
        (verResult.errors || []).forEach(e => console.log(`  Q${e.question} [${e.check}]: found="${e.found}" correct="${e.correct}"`));
        (verResult.cogLevelErrors || []).forEach(e => console.log(`  CogLevel [${e.level}]: table=${e.foundInTable} analysis=${e.foundInAnalysis}`));

        // Phase 4b: Auto-correct the memo
        const corrMemoSys = `You are correcting specific verified errors in a memorandum.
Fix ONLY the rows and cells listed in the error report.
Do not change anything that is not listed as an error.
Return the complete corrected memorandum as JSON: {"content":"complete corrected memorandum"}`;

        const allErrors = [
          ...(verResult.errors || []).map(e => `Q${e.question} [${e.check}]: Answer should be "${e.correct}". ${e.fix}`),
          ...(verResult.cogLevelErrors || []).map(e => `Cognitive Level table — ${e.level}: ${e.fix}`)
        ].join('\n');

        const corrMemoUsr = `Correct ONLY these verified errors in the memorandum. Do not change anything else.\n\nERRORS TO FIX:\n${allErrors}\n\nMEMORANDUM:\n${memoContent}`;

        try {
          const rawCorrected = await callClaude(corrMemoSys, corrMemoUsr, 8192);
          const correctedMemo = cleanOutput(safeExtractContent(rawCorrected));
          if (correctedMemo && correctedMemo.length > 500) {
            verifiedMemo = correctedMemo;
            console.log(`Phase 4: memo corrected successfully ✓`);
          } else {
            console.log(`Phase 4: correction returned too short — keeping original memo`);
            verifiedMemo = memoContent; // explicit fallback to uncorrected memo
          }
        } catch(corrErr) {
          console.log(`Phase 4: correction failed (${corrErr.message}) — keeping original memo`);
          verifiedMemo = memoContent; // explicit fallback
        }
      } else {
        console.log(`Phase 4: memo verified — no errors found ✓`);
      }
    } catch(verErr) {
      console.log(`Phase 4: verification skipped (${verErr.message})`);
    }

    // ── Build DOCX ──
    let docxBase64 = null;
    const filename = (subject + '-' + resourceType + '-Grade' + g + '-Term' + t).replace(/[^a-zA-Z0-9\-]/g, '-') + '.docx';

    try {
      const doc = buildDoc(questionPaper, verifiedMemo, markTotal);
      const buffer = await Packer.toBuffer(doc);
      docxBase64 = buffer.toString('base64');
    } catch (docxErr) {
      console.error('DOCX build error:', docxErr.message);
    }

    const preview = questionPaper + '\n\n' + verifiedMemo;
    return res.status(200).json({ docxBase64, preview, filename });

  } catch (err) {
    console.error('Generate error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
