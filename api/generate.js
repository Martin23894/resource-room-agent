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
    bar: 'bar graph or pie chart with specific data values',
    line: 'line graph with specific plotted data points',
    science: 'labelled scientific diagram with specific parts to identify',
    flow: 'flow diagram with specific steps or stages',
    map: 'map, grid, or coordinate diagram with specific points or areas',
    maths: 'mathematical diagram with specific measurements, angles, or values'
  };

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

  function extractDiagram(raw) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch(e) { return null; }
    if (parsed && parsed.svg) return parsed;
    for (const k of Object.keys(parsed)) {
      if (parsed[k] && typeof parsed[k] === 'object' && parsed[k].svg) return parsed[k];
    }
    return null;
  }

  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  try {
    // ═══════════════════════════════════════════════════════════
    // STEP 1: Generate diagrams FIRST
    // These are specific, data-rich diagrams learners can answer questions about
    // ═══════════════════════════════════════════════════════════
    let diagramsArray = [];
    let diagramDescriptions = [];

    if (numDiag > 0) {
      const diagSystemText = 'You create educational diagrams for South African CAPS Grade ' + g + ' ' + subject + ' assessments. Your diagrams are QUESTION-READY — they contain specific data, values, labels, and details that a learner must study to answer questions.\n\nCRITICAL RULES:\n- Do NOT create educational posters, infographics, or concept explanations.\n- DO create diagrams with SPECIFIC DATA that learners must read, interpret, and calculate from.\n- For bar/line/pie charts: include specific numerical values, labelled axes, a clear title.\n- For science diagrams: label specific parts with letters (A, B, C) or names that learners must identify.\n- For maths diagrams: include specific measurements, angles, coordinates, or values.\n- For flow diagrams: include specific steps with details learners must trace.\n\nReturn ONLY a single flat JSON object — no markdown, no code fences, no explanation.\n\nSVG rules: viewBox="0 0 520 300" width="520" height="300". First element: <rect width="520" height="300" fill="white"/>. font-family="Arial,sans-serif" on all text. Colours: #085041 #1D9E75 #E1F5EE #185FA5 #BA7517 #888780. Clear labels with actual values visible. No JavaScript.';

      for (let i = 1; i <= numDiag; i++) {
        if (i > 1) await delay(1500);

        const diagUserText = 'Create 1 QUESTION-READY diagram for a Grade ' + g + ' ' + subject + ' assessment on the topic: ' + topic + '.\n\nDiagram type: ' + (diagTypeMap[diagramType] || 'most suitable for assessment questions') + '\nThis is Figure ' + i + ' of ' + numDiag + ' for Addendum A.\n' + (i > 1 ? 'This diagram must show something DIFFERENT from the previous figure(s) — a different data set, different aspect, or different sub-topic.' : '') + '\n\nIMPORTANT: This diagram must contain SPECIFIC data, values, or labels that a teacher can write questions about. A learner must be able to look at this diagram and extract information to answer questions.\n\nReturn JSON:\n{"title":"Figure ' + i + ': [specific descriptive title]","caption":"[What the diagram shows and what data it contains]","whatItContains":"[Detailed plain-text description of ALL the specific data, labels, values, parts, and measurements visible in this diagram. Be extremely specific — list every data point, every label, every value. A teacher must be able to write questions based ONLY on this description without seeing the SVG.]","svg":"[complete SVG code]"}';

        let diagramData = null;

        try {
          const rawDiag = await callAPI(diagSystemText, diagUserText, 3000);
          diagramData = extractDiagram(rawDiag);
          if (diagramData) console.log('Diagram ' + i + ' generated OK');
        } catch(diagErr) {
          console.error('Diagram ' + i + ' attempt 1:', diagErr.message);
        }

        if (!diagramData) {
          await delay(2000);
          try {
            const rawDiag = await callAPI(diagSystemText, diagUserText, 3000);
            diagramData = extractDiagram(rawDiag);
            if (diagramData) console.log('Diagram ' + i + ' OK on retry');
          } catch(retryErr) {
            console.error('Diagram ' + i + ' retry:', retryErr.message);
          }
        }

        if (diagramData) {
          diagramsArray.push({ ...diagramData, index: i });
          // Build description for the resource generator
          const desc = 'Figure ' + i + ': ' + (diagramData.title || 'Diagram') + '. ' + (diagramData.whatItContains || diagramData.caption || 'A diagram about ' + topic);
          diagramDescriptions.push(desc);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Generate resource text that references ACTUAL diagrams
    // The resource generator knows EXACTLY what each diagram contains
    // ═══════════════════════════════════════════════════════════
    let diagramContext = '';
    if (diagramDescriptions.length > 0) {
      diagramContext = '\n\nADDENDUM A DIAGRAMS (already created — write questions about THESE EXACT diagrams):\n' + diagramDescriptions.join('\n') + '\n\nFor EACH figure listed above, write at least one question that says "Refer to Figure X in Addendum A" and asks the learner to read, interpret, calculate from, or identify something SPECIFIC in that diagram based on the description above. Your questions must match what the diagram actually contains — do not ask about anything not described above.';
    }

    const systemText = 'You are an expert South African CAPS ' + phase + ' teacher. Write in ' + language + ' only. Use SA context (rands, names like Sipho/Ayanda/Zanele, local scenarios). Sound like a real experienced teacher.\n\nDoE COGNITIVE LEVELS — MANDATORY: ' + doeRatios + '\nLabel each section with cognitive level and marks. Calculate mark split from total.\n' + (bloomsNote ? bloomsNote + '\n' : '') + 'DIFFICULTY: ' + diffNote + '\nTEXTBOOK: ' + textbookNote + ' — match its vocabulary, style and difficulty.\nATP: Grade ' + g + ' Term ' + t + ' ' + subject + ' — ' + topic + '. Stay within this term scope.' + diagramContext + '\n\nReturn JSON only: {"content":"resource text"}\n\nStructure:\n---TEACHER INSTRUCTIONS---\nTime: [X min] | Grade: ' + g + ' | Term: ' + t + '\nDoE split: ' + doeRatios + '\nMarks: [K:X RP:X CP:X PS:X = total]\nMaterials: [list] | CAPS: ' + subject + ' Gr' + g + ' T' + t + ' ' + topic + '\nNotes: [2-3 prep notes]' + (diagramDescriptions.length > 0 ? '\nNote to teacher: Diagrams are provided in Addendum A. You may rearrange them after downloading.' : '') + '\n\n---THE RESOURCE ROOM---\n' + subject + ' | Grade ' + g + ' | Term ' + t + ' | ' + language + ' | [X] marks\n\nLearner: _______________________  Date: ________  Class: ______\n\n[Sections with DoE cognitive level label. Min 10 questions. Marks in brackets.]\n\nTOTAL: ___ / [X]\n\n---MEMORANDUM---\n[Numbered answers with marks]\n\nTotal: [X] marks' + rubricNote + '\n\n---EXTENSION---\n[One higher-order challenge with answer]';

    const userText = subject + ' | ' + topic + ' | ' + resourceType + ' | ' + language + ' | Gr' + g + ' T' + t + ' | ' + (duration || '1 hour') + ' | ' + (difficulty || 'on') + ' grade' + (diagramDescriptions.length > 0 ? ' | Write questions about the ' + diagramDescriptions.length + ' diagram(s) described above' : '') + (includeRubric ? ' | rubric' : '') + '\n\nApply DoE ratios. SA context. Min 10 questions. JSON only.';

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

    return res.status(200).json({
      content: resourceContent,
      diagrams: diagramsArray.length > 0 ? diagramsArray : null
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
