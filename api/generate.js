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

  const durParts = (duration || '50 marks, 1 hour').split(',').map(s => s.trim());
  const totalMarks = parseInt(durParts[0]) || 50;
  const timeAllocation = durParts[1] || '1 hour';
  const diffNote = difficulty === 'below' ? 'Below grade level' : difficulty === 'above' ? 'Above grade level' : 'On grade level';

  // ═══════════════════════════════════════
  // DoE COGNITIVE LEVELS
  // ═══════════════════════════════════════
  function getCogLevels(subj, gr) {
    const s = (subj || '').toLowerCase();
    if (s.includes('math') || s.includes('wiskunde'))
      return { levels: ['Knowledge', 'Routine Procedures', 'Complex Procedures', 'Problem Solving'], pcts: gr <= 3 ? [25,45,20,10] : [25,45,25,10] };
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
  const cogTable = cog.levels.map((l, i) => l + ' ' + cog.pcts[i] + '% = ' + Math.round(totalMarks * cog.pcts[i] / 100) + ' marks').join('\n');

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
    const hRow = new TableRow({ children: headers.map(h => cell(h, { bold: true, color: 'FFFFFF', fill: GREEN })) });
    const dRows = rows.map(r => new TableRow({ children: r.map(c => cell(c)) }));
    return new Table({ rows: [hRow, ...dRows], width: { size: 100, type: WidthType.PERCENTAGE } });
  }

  // ═══════════════════════════════════════
  // COVER PAGE
  // ═══════════════════════════════════════
  function buildCover() {
    const els = [];
    els.push(para('THE RESOURCE ROOM', { bold: true, size: 28, color: GREEN, align: AlignmentType.CENTER, spaceAfter: 200 }));
    els.push(para(resourceType.toUpperCase(), { bold: true, size: 36, align: AlignmentType.CENTER, spaceAfter: 80 }));
    els.push(para(subject, { bold: true, size: 28, align: AlignmentType.CENTER, spaceAfter: 200 }));
    els.push(para([txt('Grade ' + g, { size: 24 }), txt('                                                                    Term ' + t, { size: 24 })], { spaceAfter: 80 }));
    els.push(para([txt('Name: ___________________________', {}), txt('          Date: ___________________', {})], { spaceAfter: 40 }));
    els.push(para('Surname: ________________________', { spaceAfter: 40 }));
    if (!isWorksheet) {
      els.push(para([txt('Examiner: ______________________', {}), txt('     Time: ' + timeAllocation, {})], { spaceAfter: 120 }));
    }
    els.push(new Table({
      rows: [new TableRow({
        children: [
          cell('Total', { bold: true }), cell(String(totalMarks), { bold: true, align: AlignmentType.CENTER }),
          cell('%', { bold: true, align: AlignmentType.CENTER }), cell('Code', { bold: true, align: AlignmentType.CENTER })
        ]
      })],
      width: { size: 100, type: WidthType.PERCENTAGE }
    }));
    els.push(para(''));
    els.push(para([txt('Comments: ', { bold: true, size: 20 }), txt('_______________________________________________', { size: 20 })], { spaceAfter: 120 }));
    els.push(para('Instructions:', { bold: true, spaceAfter: 40 }));
    els.push(para('•   Read the questions properly.', { indent: { left: 360 }, spaceAfter: 20 }));
    els.push(para('○   Answer ALL the questions.', { indent: { left: 720 }, spaceAfter: 20 }));
    els.push(para('○   Show all working where required.', { indent: { left: 720 }, spaceAfter: 20 }));
    els.push(para('○   Pay special attention to the mark allocation of each question.', { indent: { left: 720 }, spaceAfter: 200 }));
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
  function buildDoc(qText, mText) {
    const cover = isWorksheet
      ? [para(subject + ' — Worksheet', { bold: true, size: 28, align: AlignmentType.CENTER, spaceAfter: 80 }),
         para('Grade ' + g + '  |  Term ' + t + '  |  ' + language, { align: AlignmentType.CENTER, spaceAfter: 40 }),
         para([txt('Name: ___________________________'), txt('     Date: ___________________')], { spaceAfter: 40 }),
         para('Total: _____ / ' + totalMarks + ' marks', { bold: true, spaceAfter: 120 })]
      : buildCover();

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
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
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
  }

  // ═══════════════════════════════════════
  // PROMPTS
  // ═══════════════════════════════════════
  const qSys = `You are a South African CAPS ${phase} Phase teacher creating a ${resourceType} question paper in ${language}. Use SA context (rands, names: Sipho, Ayanda, Zanele, Thandi, Pieter, Anri, SA places).

DIFFICULTY: ${diffNote}
DoE COGNITIVE LEVELS (distribute marks accordingly — do NOT label levels in the learner paper):
${cogTable}
CAPS: Grade ${g} Term ${t} ${subject}
${topicInstruction}
TOTAL: EXACTLY ${totalMarks} marks. TIME: ${timeAllocation}.

RULES:
- NEVER use Unicode box characters. Plain text only.
- Question numbering: Question 1: [heading] then 1.1, 1.2, 1.1.1
- Marks in brackets: (2)
- Answer lines: _______________________________________________
- Working:/Answer: lines ONLY for calculation questions
- MCQ: a. b. c. d. then Answer: ___
- True/False: statement then _______________
- Match columns: plain text list, NOT tables
- NO cognitive level labels in the question paper
- NO meta-commentary, notes, or AI reasoning
${isTest ? '- NO SECTION headers. Use Question 1, 2, 3.' : ''}
${(isExam || isFinalExam) ? '- USE SECTION A/B/C/D headers.' : ''}
${(isExam || isFinalExam) ? '- Every topic must have at least one question.' : ''}
- Minimum ${isWorksheet ? '8' : '10'} question items
- Keep questions concise

Return JSON: {"content":"question paper text — stop after TOTAL line"}`;

  const qUsr = `Create the question paper ONLY for: ${subject} ${resourceType}, Grade ${g}, Term ${t}, ${language}, ${totalMarks} marks, ${timeAllocation}. ${topicInstruction}. Stop after TOTAL line.`;

  const mSys = `You are a South African CAPS teacher. Create a COMPLETE memorandum in ${language}. NEVER use Unicode box characters. Use pipe | tables only. No meta-commentary or AI reasoning. Return JSON: {"content":"memorandum text"}`;

  const mUsr = (qp) => `Question paper:

${qp}

Create ALL sections using pipe | tables:

1. MEMORANDUM
NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK
Answer every question. Marks total EXACTLY ${totalMarks}.

2. COGNITIVE LEVEL ANALYSIS
Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual %
${cog.levels.map((l,i) => l + ' | ' + cog.pcts[i] + '% | ' + Math.round(totalMarks*cog.pcts[i]/100)).join('\n')}
Then: [Level] ([X] marks): Q1.1 (1) + Q2.1 (2) + ... = X

${!isWorksheet ? '3. EXTENSION ACTIVITY\nOne challenging question with model answer.\n' : ''}
${includeRubric ? '4. MARKING RUBRIC\nCRITERIA | Level 5 Outstanding | Level 4 Good | Level 3 Satisfactory | Level 2 Needs Improvement | Level 1 Not Achieved\n3-4 rows for ' + subject + '. Mark ranges per level.' : ''}`;

  // ═══════════════════════════════════════
  // EXECUTE
  // ═══════════════════════════════════════
  try {
    const qTok = isWorksheet ? 3000 : (isExam || isFinalExam) ? 5000 : 4000;
    const questionPaper = await callClaude(qSys, qUsr, qTok);
    const memoContent = await callClaude(mSys, mUsr(questionPaper), includeRubric ? 8192 : 6000);

    const doc = buildDoc(questionPaper, memoContent);
    const buffer = await Packer.toBuffer(doc);
    const docxBase64 = buffer.toString('base64');
    const filename = (subject + '-' + resourceType + '-Grade' + g + '-Term' + t).replace(/[^a-zA-Z0-9\-]/g, '-') + '.docx';
    const preview = questionPaper + '\n\n' + memoContent;

    return res.status(200).json({ docxBase64, preview, filename });
  } catch (err) {
    console.error('Generate error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
