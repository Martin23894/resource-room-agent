export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    subject, topic, resourceType, language, duration, difficulty,
    includeRubric, diagramCount, diagramType,
    grade, term, bloomsMode, bloomsLevels
  } = req.body;

  if (!subject || !topic || !resourceType || !language) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const g = parseInt(grade) || 6;
  const t = parseInt(term) || 3;
  const numDiag = Math.min(parseInt(diagramCount) || 0, 3);
  const phase = g <= 3 ? 'Foundation Phase' : g <= 6 ? 'Intermediate Phase' : 'Senior Phase';

  function getDoERatios(subj, gradeNum) {
    const s = (subj || '').toLowerCase();
    if (s.includes('math') || s.includes('wiskunde'))
      return gradeNum <= 3
        ? 'Knowledge 25% | Routine Procedures 45% | Complex Procedures 20% | Problem Solving 10%'
        : 'Knowledge 20% | Routine Procedures 35% | Complex Procedures 30% | Problem Solving 15%';
    if (s.includes('home language') || s.includes('huistaal'))
      return 'Lower Order/Literal 30% | Middle Order/Inferential 40% | Higher Order/Critical 30%';
    if (s.includes('additional') || s.includes('addisionele'))
      return 'Lower Order/Literal 40% | Middle Order/Inferential 35% | Higher Order/Critical 25%';
    if (s.includes('natural') || s.includes('natuur'))
      return 'Recall 25% | Comprehension 30% | Application/Analysis 30% | Synthesis/Evaluation 15%';
    if (s.includes('social') || s.includes('sosiale'))
      return 'Knowledge/Recall 30% | Comprehension 30% | Application/Analysis 25% | Synthesis/Evaluation 15%';
    if (s.includes('technolog') || s.includes('tegnol'))
      return 'Knowledge 20% | Comprehension 30% | Application 35% | Analysis/Evaluation 15%';
    if (s.includes('economic') || s.includes('ekonom'))
      return 'Knowledge 25% | Application 45% | Analysis/Synthesis 30%';
    if (s.includes('life') || s.includes('lewens'))
      return 'Knowledge 30% | Understanding 40% | Application 30%';
    return 'Lower Order 30% | Middle Order 40% | Higher Order 30%';
  }

  const doeRatios = getDoERatios(subject, g);
  const textbookNote = g <= 3
    ? 'SA Foundation Phase resources (Thelma Res/Spot On style)'
    : 'Platinum ' + subject + ' Grade ' + g + ' (Maskew Miller Longman)';

  let bloomsNote = '';
  if (bloomsMode === 'single' && bloomsLevels && bloomsLevels.length > 0)
    bloomsNote = 'Teacher Bloom\'s focus: ' + bloomsLevels[0] + ' — weight questions toward this level.';
  else if (bloomsMode === 'mixed' && bloomsLevels && bloomsLevels.length > 0)
    bloomsNote = 'Teacher Bloom\'s focus: blend of ' + bloomsLevels.join(', ') + '.';

  const diffNote = difficulty === 'below' ? 'BELOW grade — simplified, more scaffolding'
    : difficulty === 'above' ? 'ABOVE grade — extension, higher-order focus'
    : 'ON grade — standard CAPS level';

  const rubricNote = includeRubric
    ? '\n\n---MARKING RUBRIC---\n[4-level rubric Level 1-4 aligned to DoE cognitive levels above]'
    : '';

  const diagTypeMap = {
    agent: 'most suitable for this topic',
    bar: 'bar graph or pie chart',
    line: 'line graph',
    science: 'scientific diagram',
    flow: 'flow diagram',
    map: 'map or grid',
    maths: 'mathematical diagram'
  };

  // ═══════════════════════════════════════════════════════════
  // Addendum A instruction for resource text
  // ═══════════════════════════════════════════════════════════
  let addendumInstruction = '';
  if (numDiag > 0) {
    const figureList = Array.from({length: numDiag}, (_, i) => 'Figure ' + (i+1)).join(', ');
    addendumInstruction = '\n\nDIAGRAMS: This resource includes ' + numDiag + ' diagram(s) in Addendum A (' + figureList + '). For EACH figure, write a question that says "Refer to Figure X in Addendum A" or "Study Figure X in Addendum A and answer the following." Then describe SPECIFICALLY what the diagram shows so the diagram can be created to match. For example: "Refer to Figure 1 in Addendum A which shows a bar graph of rainfall in Cape Town from January to June." Be specific about what data, shapes, processes, or concepts each figure should contain.';
  }

  const systemText = 'You are an expert South African CAPS ' + phase + ' teacher. Write in ' + language + ' only. Use SA context (rands, names like Sipho/Ayanda/Zanele, local scenarios). Sound like a real experienced teacher.\n\nDoE COGNITIVE LEVELS — MANDATORY: ' + doeRatios + '\nLabel each section with cognitive level and marks. Calculate mark split from total.\n' + (bloomsNote ? bloomsNote + '\n' : '') + 'DIFFICULTY: ' + diffNote + '\nTEXTBOOK: ' + textbookNote + ' — match its vocabulary, style and difficulty. Reference chapter in teacher instructions.\nATP: Grade ' + g + ' Term ' + t + ' ' + subject + ' — ' + topic + '. Stay within this term scope.' + addendumInstruction + '\n\nReturn JSON only: {"content":"resource text"}\n\nStructure:\n---TEACHER INSTRUCTIONS---\nTime: [X min] | Grade: ' + g + ' | Term: ' + t + ' | ' + textbookNote + ' Ch.[X]\nDoE split: ' + doeRatios + '\nMarks: [K:X RP:X CP:X PS:X = total]\nMaterials: [list] | CAPS: ' + subject + ' Gr' + g + ' T' + t + ' ' + topic + '\nNotes: [2-3 prep notes]' + (numDiag > 0 ? '\nNote to teacher: Diagrams are provided in Addendum A at the end of this resource. You may rearrange them in the Word document after downloading.' : '') + '\n\n---THE RESOURCE ROOM---\n' + subject + ' | Grade ' + g + ' | Term ' + t + ' | ' + language + ' | [X] marks\n\nLearner: _______________________  Date: ________  Class: ______\n\n[Sections with DoE cognitive level label. Min 10 questions. Marks in brackets.]\n\nTOTAL: ___ / [X]\n\n---MEMORANDUM---\n[Numbered answers with marks]\n\nTotal: [X] marks' + rubricNote + '\n\n---EXTENSION---\n[One higher-order challenge with answer]';

  const userText = subject + ' | ' + topic + ' | ' + resourceType + ' | ' + language + ' | Gr' + g + ' T' + t + ' | ' + (duration || '1 hour') + ' | ' + (difficulty || 'on') + ' grade' + (numDiag > 0 ? ' | ' + numDiag + ' diagram(s) in Addendum A — describe each figure specifically in the questions' : '') + (includeRubric ? ' | rubric' : '') + '\n\nApply DoE ratios. ' + textbookNote + ' style. SA context. Min 10 questions. JSON only.';

  async function callAPI(system, user, maxTok) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTok,
        system,
        messages: [{ role: 'user', content: user }]
      })
    });
    const text = await response.text();
    if (!response.ok) {
      let msg = 'API error ' + response.status;
      try { msg = JSON.parse(text).error?.message || msg; } catch(e) {}
      throw new Error(msg);
    }
    let raw = '';
    try { raw = JSON.parse(text).content?.map(c => c.text || '').join('') || ''; }
    catch(e) { throw new Error('Parse error: ' + text.substring(0, 100)); }
    return raw.replace(/```json|```/g, '').trim();
  }

  // Helper: extract diagram data from various JSON formats
  function extractDiagram(raw, figureNum) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch(e) { return null; }
    if (parsed && parsed.svg) return parsed;
    if (parsed && parsed.diagram && parsed.diagram.svg) return parsed.diagram;
    const key = 'diagram' + figureNum;
    if (parsed && parsed[key] && parsed[key].svg) return parsed[key];
    if (parsed && parsed.diagrams) {
      const inner = parsed.diagrams[key];
      if (inner && inner.svg) return inner;
    }
    for (const k of Object.keys(parsed)) {
      if (parsed[k] && typeof parsed[k] === 'object' && parsed[k].svg) return parsed[k];
    }
    return null;
  }

  // Helper: extract context around "Figure N" references in the resource
  function extractFigureContext(content, figureNum) {
    const lines = content.split('\n');
    const pattern = new RegExp('Figure\\s+' + figureNum, 'i');
    let contextLines = [];
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        // Grab the line before, the matching line, and 2 lines after for context
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length - 1, i + 2);
        for (let j = start; j <= end; j++) {
          contextLines.push(lines[j].trim());
        }
        break;
      }
    }
    return contextLines.length > 0
      ? contextLines.join(' ')
      : subject + ' — ' + topic + ' (Figure ' + figureNum + ')';
  }

  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  try {
    // ═══════════════════════════════════════════════════════════
    // STEP 1: Generate resource text (4096 tokens)
    // ═══════════════════════════════════════════════════════════
    const raw1 = await callAPI(systemText, userText, 4096);

    let resourceContent = '';
    try {
      const parsed1 = JSON.parse(raw1);
      resourceContent = parsed1.content || raw1;
    } catch(e) {
      let cleaned = raw1;
      cleaned = cleaned.replace(/^\s*\{\s*"content"\s*:\s*"/, '');
      cleaned = cleaned.replace(/"\s*\}\s*$/, '');
      cleaned = cleaned.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
      resourceContent = cleaned;
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Generate diagrams that MATCH the questions
    // ═══════════════════════════════════════════════════════════
    let diagramsArray = [];

    if (numDiag > 0) {
      const diagSystemText = 'You create educational SVG diagrams for South African CAPS Grade ' + g + ' ' + subject + '. Return ONLY a single flat JSON object — no markdown, no code fences, no explanation.\n\nSVG rules: viewBox="0 0 520 300" width="520" height="300". First element: <rect width="520" height="300" fill="white"/>. font-family="Arial,sans-serif" on all text. Colours: #085041 #1D9E75 #E1F5EE #185FA5 #BA7517 #888780. Grade-appropriate, topic-specific, clear labels. No JavaScript.';

      for (let i = 1; i <= numDiag; i++) {
        if (i > 1) await delay(1500);

        // Extract what the question says about this figure
        const figureContext = extractFigureContext(resourceContent, i);

        const singleDiagUserText = 'Create 1 educational diagram for Addendum A of a Grade ' + g + ' ' + subject + ' assessment.\n\nThe assessment question says: "' + figureContext + '"\n\nCreate the EXACT diagram described in that question. The diagram must match what the learner is asked to study or interpret.\n\nDiagram type preference: ' + (diagTypeMap[diagramType] || 'most suitable') + '\n\nReturn a single JSON object:\n{"title":"Figure ' + i + ': [short descriptive title]","caption":"[1-2 sentences explaining what the diagram shows]","svg":"[complete SVG code]"}';

        let diagramData = null;

        try {
          const rawDiag = await callAPI(diagSystemText, singleDiagUserText, 2500);
          diagramData = extractDiagram(rawDiag, i);
          if (diagramData) {
            console.log('Diagram ' + i + ' OK on attempt 1');
          } else {
            console.error('Diagram ' + i + ' attempt 1: no SVG in response');
          }
        } catch(diagErr) {
          console.error('Diagram ' + i + ' attempt 1 error:', diagErr.message);
        }

        if (!diagramData) {
          await delay(2000);
          try {
            const rawDiag = await callAPI(diagSystemText, singleDiagUserText, 2500);
            diagramData = extractDiagram(rawDiag, i);
            if (diagramData) {
              console.log('Diagram ' + i + ' OK on retry');
            }
          } catch(retryErr) {
            console.error('Diagram ' + i + ' retry error:', retryErr.message);
          }
        }

        if (diagramData) {
          diagramsArray.push({ ...diagramData, index: i });
        }
      }
    }

    return res.status(200).json({
      content: resourceContent,
      diagrams: diagramsArray.length > 0 ? diagramsArray : null
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
