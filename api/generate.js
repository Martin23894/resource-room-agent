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
  // Diagram instruction — AI must output BOTH content + specs
  // ═══════════════════════════════════════════════════════════
  let diagramInstruction = '';
  let jsonFormat = '{"content":"resource text"}';

  if (numDiag > 0) {
    diagramInstruction = '\n\nDIAGRAMS: This resource includes ' + numDiag + ' diagram(s) in Addendum A. For each figure:\n1. Write questions that say "Refer to Figure X in Addendum A" and describe what it shows.\n2. In the JSON response, include a "diagramSpecs" array with DETAILED specifications for each diagram.\nEach spec must include: figure number, title, type (e.g. bar graph, line graph, pie chart, science diagram, flow diagram), and a DETAILED description with ALL specific data values, labels, axis names, and measurements needed to draw it. Be extremely specific — include actual numbers, names, and values.\n\nPreferred diagram type: ' + (diagTypeMap[diagramType] || 'most suitable') + '.';

    const specsExample = Array.from({length: numDiag}, (_, i) => '{"figure":' + (i+1) + ',"title":"Figure ' + (i+1) + ': [title]","type":"[bar graph/line graph/pie chart/science diagram/flow diagram/map]","description":"[VERY DETAILED description with ALL data values, labels, axis names, measurements. Example: A bar graph with X-axis showing months Jan-Jun, Y-axis showing rainfall in mm. Values: Jan=50, Feb=30, Mar=40, Apr=80, May=100, Jun=120. Title: Monthly Rainfall in Cape Town.]"}').join(',');

    jsonFormat = '{"content":"resource text","diagramSpecs":[' + specsExample + ']}';
  }

  const systemText = 'You are an expert South African CAPS ' + phase + ' teacher. Write in ' + language + ' only. Use SA context (rands, names like Sipho/Ayanda/Zanele, local scenarios). Sound like a real experienced teacher.\n\nDoE COGNITIVE LEVELS — MANDATORY: ' + doeRatios + '\nLabel each section with cognitive level and marks. Calculate mark split from total.\n' + (bloomsNote ? bloomsNote + '\n' : '') + 'DIFFICULTY: ' + diffNote + '\nTEXTBOOK: ' + textbookNote + ' — match its vocabulary, style and difficulty.\nATP: Grade ' + g + ' Term ' + t + ' ' + subject + ' — ' + topic + '. Stay within this term scope.' + diagramInstruction + '\n\nReturn JSON only: ' + jsonFormat + '\n\nResource structure:\n---TEACHER INSTRUCTIONS---\nTime: [X min] | Grade: ' + g + ' | Term: ' + t + '\nDoE split: ' + doeRatios + '\nMarks: [K:X RP:X CP:X PS:X = total]\nMaterials: [list] | CAPS: ' + subject + ' Gr' + g + ' T' + t + ' ' + topic + '\nNotes: [2-3 prep notes]' + (numDiag > 0 ? '\nNote to teacher: Diagrams are provided in Addendum A. You may rearrange them after downloading.' : '') + '\n\n---THE RESOURCE ROOM---\n' + subject + ' | Grade ' + g + ' | Term ' + t + ' | ' + language + ' | [X] marks\n\nLearner: _______________________  Date: ________  Class: ______\n\n[Sections with DoE cognitive level label. Min 10 questions. Marks in brackets.]\n\nTOTAL: ___ / [X]\n\n---MEMORANDUM---\n[Numbered answers with marks]\n\nTotal: [X] marks' + rubricNote + '\n\n---EXTENSION---\n[One higher-order challenge with answer]';

  const userText = subject + ' | ' + topic + ' | ' + resourceType + ' | ' + language + ' | Gr' + g + ' T' + t + ' | ' + (duration || '1 hour') + ' | ' + (difficulty || 'on') + ' grade' + (numDiag > 0 ? ' | Include ' + numDiag + ' diagram(s) in Addendum A with DETAILED diagramSpecs in JSON' : '') + (includeRubric ? ' | rubric' : '') + '\n\nApply DoE ratios. SA context. Min 10 questions. JSON only.';

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

  function extractDiagram(raw, figureNum) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch(e) { return null; }
    if (parsed && parsed.svg) return parsed;
    if (parsed && parsed.diagram && parsed.diagram.svg) return parsed.diagram;
    for (const k of Object.keys(parsed)) {
      if (parsed[k] && typeof parsed[k] === 'object' && parsed[k].svg) return parsed[k];
    }
    return null;
  }

  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  try {
    // ═══════════════════════════════════════════════════════════
    // STEP 1: Generate resource text + diagram specifications
    // (same AI writes questions AND describes diagrams = perfect match)
    // ═══════════════════════════════════════════════════════════
    const raw1 = await callAPI(systemText, userText, numDiag > 0 ? 5000 : 4096);

    let resourceContent = '';
    let diagramSpecs = [];

    try {
      const parsed1 = JSON.parse(raw1);
      resourceContent = parsed1.content || raw1;
      if (parsed1.diagramSpecs && Array.isArray(parsed1.diagramSpecs)) {
        diagramSpecs = parsed1.diagramSpecs;
        console.log('Got ' + diagramSpecs.length + ' diagram specs from resource call');
      }
    } catch(e) {
      let cleaned = raw1;
      cleaned = cleaned.replace(/^\s*\{\s*"content"\s*:\s*"/, '');
      cleaned = cleaned.replace(/"\s*\}\s*$/, '');
      cleaned = cleaned.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
      resourceContent = cleaned;
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Generate SVG for each diagram FROM the specs
    // (specs came from same AI that wrote the questions)
    // ═══════════════════════════════════════════════════════════
    let diagramsArray = [];

    if (numDiag > 0 && diagramSpecs.length > 0) {
      const diagSystemText = 'You create educational SVG diagrams for South African CAPS Grade ' + g + ' ' + subject + '. Return ONLY a single flat JSON object — no markdown, no code fences, no explanation.\n\nSVG rules: viewBox="0 0 520 300" width="520" height="300". First element: <rect width="520" height="300" fill="white"/>. font-family="Arial,sans-serif" on all text. Colours: #085041 #1D9E75 #E1F5EE #185FA5 #BA7517 #888780. Grade-appropriate, clear labels, accurate data. No JavaScript.';

      for (let i = 0; i < diagramSpecs.length && i < numDiag; i++) {
        if (i > 0) await delay(1500);

        const spec = diagramSpecs[i];
        const specTitle = spec.title || ('Figure ' + (i+1));
        const specDesc = spec.description || (subject + ' — ' + topic);
        const specType = spec.type || (diagTypeMap[diagramType] || 'suitable');

        const diagUserText = 'Create this EXACT educational diagram for Addendum A:\n\nTitle: ' + specTitle + '\nType: ' + specType + '\nDetailed description: ' + specDesc + '\n\nCREATE THE DIAGRAM EXACTLY AS DESCRIBED. Include all the specific data values, labels, and measurements mentioned above.\n\nReturn a single JSON object:\n{"title":"' + specTitle + '","caption":"[1-2 sentences explaining what the diagram shows]","svg":"[complete SVG code matching the description above]"}';

        let diagramData = null;

        try {
          const rawDiag = await callAPI(diagSystemText, diagUserText, 2500);
          diagramData = extractDiagram(rawDiag, i+1);
          if (diagramData) console.log('Diagram ' + (i+1) + ' OK');
          else console.error('Diagram ' + (i+1) + ': no SVG in response');
        } catch(diagErr) {
          console.error('Diagram ' + (i+1) + ' attempt 1:', diagErr.message);
        }

        if (!diagramData) {
          await delay(2000);
          try {
            const rawDiag = await callAPI(diagSystemText, diagUserText, 2500);
            diagramData = extractDiagram(rawDiag, i+1);
            if (diagramData) console.log('Diagram ' + (i+1) + ' OK on retry');
          } catch(retryErr) {
            console.error('Diagram ' + (i+1) + ' retry:', retryErr.message);
          }
        }

        if (diagramData) {
          diagramsArray.push({ ...diagramData, index: i+1 });
        }
      }
    } else if (numDiag > 0 && diagramSpecs.length === 0) {
      // Fallback: specs weren't in the JSON, generate from topic
      console.error('No diagramSpecs returned, falling back to topic-based generation');
      const diagSystemText = 'You create educational SVG diagrams for South African CAPS Grade ' + g + ' ' + subject + '. Return ONLY a single flat JSON object — no markdown, no code fences.\n\nSVG rules: viewBox="0 0 520 300" width="520" height="300". First element: <rect width="520" height="300" fill="white"/>. font-family="Arial,sans-serif" on all text. Colours: #085041 #1D9E75 #E1F5EE #185FA5 #BA7517 #888780. No JavaScript.';

      for (let i = 1; i <= numDiag; i++) {
        if (i > 1) await delay(1500);
        const diagUserText = 'Create 1 educational ' + (diagTypeMap[diagramType] || 'suitable') + ' diagram for Grade ' + g + ' ' + subject + ' — ' + topic + '.\nThis is Figure ' + i + ' for Addendum A.\n' + (i > 1 ? 'Make it different from previous diagrams — show a different aspect.' : '') + '\n\nReturn JSON:\n{"title":"Figure ' + i + ': [title]","caption":"[description]","svg":"[SVG code]"}';

        try {
          const rawDiag = await callAPI(diagSystemText, diagUserText, 2500);
          const diagramData = extractDiagram(rawDiag, i);
          if (diagramData) diagramsArray.push({ ...diagramData, index: i });
        } catch(err) {
          console.error('Fallback diagram ' + i + ' failed:', err.message);
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
