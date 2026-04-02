export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    subject, topic, resourceType, language, duration, difficulty,
    includeRubric, diagramCount, diagramType, diagramPlacement,
    grade, term, bloomsMode, bloomsLevels
  } = req.body;

  if (!subject || !topic || !resourceType || !language) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const g = parseInt(grade) || 6;
  const t = parseInt(term) || 3;
  const numDiag = parseInt(diagramCount) || 0;
  const phase = g <= 3 ? 'Foundation Phase' : g <= 6 ? 'Intermediate Phase' : 'Senior Phase';

  // DoE cognitive level ratios per subject
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

  // Diagram placement description
  const diagPlacementDesc = diagramPlacement === 'beginning' ? 'before Section A'
    : diagramPlacement === 'end' ? 'after TOTAL line'
    : 'inline at the relevant question';

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
  // STEP 1: Generate resource text only (no SVG = fast)
  // ═══════════════════════════════════════════════════════════
  const diagPlaceholders = numDiag > 0
    ? '\nInsert placeholder(s) ' + Array.from({length: numDiag}, (_, i) => '[DIAGRAM_' + (i+1) + ']').join(' ') + ' at position: ' + diagPlacementDesc + '.'
    : '';

  const systemText = 'You are an expert South African CAPS ' + phase + ' teacher. Write in ' + language + ' only. Use SA context (rands, names like Sipho/Ayanda/Zanele, local scenarios). Sound like a real experienced teacher.\n\nDoE COGNITIVE LEVELS — MANDATORY: ' + doeRatios + '\nLabel each section with cognitive level and marks. Calculate mark split from total.\n' + (bloomsNote ? bloomsNote + '\n' : '') + 'DIFFICULTY: ' + diffNote + '\nTEXTBOOK: ' + textbookNote + ' — match its vocabulary, style and difficulty. Reference chapter in teacher instructions.\nATP: Grade ' + g + ' Term ' + t + ' ' + subject + ' — ' + topic + '. Stay within this term scope.' + diagPlaceholders + '\n\nReturn JSON only: {"content":"resource text"}\n\nStructure:\n---TEACHER INSTRUCTIONS---\nTime: [X min] | Grade: ' + g + ' | Term: ' + t + ' | ' + textbookNote + ' Ch.[X]\nDoE split: ' + doeRatios + '\nMarks: [K:X RP:X CP:X PS:X = total]\nMaterials: [list] | CAPS: ' + subject + ' Gr' + g + ' T' + t + ' ' + topic + '\nNotes: [2-3 prep notes]\n\n---THE RESOURCE ROOM---\n' + subject + ' | Grade ' + g + ' | Term ' + t + ' | ' + language + ' | [X] marks\n\nLearner: _______________________  Date: ________  Class: ______\n' + (numDiag > 0 ? '\n[Diagram placeholders here if beginning placement]\n' : '') + '\n[Sections with DoE cognitive level label. Min 10 questions. Marks in brackets.]\n\nTOTAL: ___ / [X]\n' + (numDiag > 0 ? '\n[Diagram placeholders here if end placement]\n' : '') + '\n---MEMORANDUM---\n[Numbered answers with marks]\n\nTotal: [X] marks' + rubricNote + '\n\n---EXTENSION---\n[One higher-order challenge with answer]';

  const userText = subject + ' | ' + topic + ' | ' + resourceType + ' | ' + language + ' | Gr' + g + ' T' + t + ' | ' + (duration || '1 hour') + ' | ' + (difficulty || 'on') + ' grade' + (numDiag > 0 ? ' | ' + numDiag + ' diagram placeholder(s) — ' + diagPlacementDesc : '') + (includeRubric ? ' | rubric' : '') + '\n\nApply DoE ratios. ' + textbookNote + ' style. SA context. Min 10 questions. JSON only.';

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

  try {
    // Call 1: Resource text — 4096 tokens to prevent truncation
    const raw1 = await callAPI(systemText, userText, 4096);

    let resourceContent = '';
    try {
      const parsed1 = JSON.parse(raw1);
      resourceContent = parsed1.content || raw1;
    } catch(e) {
      // JSON parse failed — strip the wrapper manually if present
      let cleaned = raw1;
      // Remove leading {"content":" or {"content": " wrapper
      cleaned = cleaned.replace(/^\s*\{\s*"content"\s*:\s*"/, '');
      // Remove trailing "} if present
      cleaned = cleaned.replace(/"\s*\}\s*$/, '');
      // Unescape JSON string escapes
      cleaned = cleaned.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
      resourceContent = cleaned;
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Generate diagrams separately (only if requested)
    // ═══════════════════════════════════════════════════════════
    let diagramsArray = [];

    if (numDiag > 0) {
      const diagSystemText = 'You create educational SVG diagrams for South African CAPS Grade ' + g + ' ' + subject + '. Return ONLY valid JSON — no markdown.\n\nSVG rules: viewBox="0 0 520 300" width="520" height="300". First element: <rect width="520" height="300" fill="white"/>. font-family="Arial,sans-serif" on all text. Colours: #085041 #1D9E75 #E1F5EE #185FA5 #BA7517 #888780. Grade-appropriate, topic-specific, clear labels. No JavaScript.';

      const diagRequests = Array.from({length: numDiag}, (_, i) =>
        'Diagram ' + (i+1) + ': ' + (diagTypeMap[diagramType] || 'suitable') + ' for ' + topic
      ).join('\n');

      const diagUserText = 'Create ' + numDiag + ' educational diagram(s) for:\nGrade ' + g + ' ' + subject + ' — ' + topic + '\nType: ' + (diagTypeMap[diagramType] || 'suitable') + '\n' + diagRequests + '\n\nReturn JSON:\n' + Array.from({length: numDiag}, (_, i) =>
        '"diagram' + (i+1) + '":{"title":"Figure ' + (i+1) + ': [title]","caption":"[1-2 sentences: what it shows and what learner must do]","svg":"[complete SVG]"}'
      ).join(',\n') + '\n\nWrap all in: {"diagrams":{...}}';

      try {
        // 3000 tokens for complete SVG diagrams
        const raw2 = await callAPI(diagSystemText, diagUserText, 3000);
        let diagParsed;
        try { diagParsed = JSON.parse(raw2); } catch(e) { diagParsed = {}; }
        const diagData = diagParsed.diagrams || diagParsed;
        for (let i = 1; i <= numDiag; i++) {
          const d = diagData['diagram' + i];
          if (d && d.svg) diagramsArray.push({ ...d, index: i });
        }
      } catch(diagErr) {
        // Diagrams failed silently — resource still returns without them
        console.error('Diagram generation failed:', diagErr.message);
      }
    }

    return res.status(200).json({
      content: resourceContent,
      diagrams: diagramsArray.length > 0 ? diagramsArray : null,
      diagramPlacement: diagramPlacement || 'beginning'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
