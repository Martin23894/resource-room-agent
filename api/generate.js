export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
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

  // DoE cognitive level ratios
  function getDoERatios(subj, gradeNum) {
    const s = (subj || '').toLowerCase();
    const ph = gradeNum <= 3 ? 'foundation' : 'standard';
    if (s.includes('math') || s.includes('wiskunde')) {
      return ph === 'foundation'
        ? 'Knowledge 25% | Routine Procedures 45% | Complex Procedures 20% | Problem Solving 10%'
        : 'Knowledge 20% | Routine Procedures 35% | Complex Procedures 30% | Problem Solving 15%';
    }
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

  const diffNote = difficulty === 'below'
    ? 'BELOW grade — simplified, scaffolded, introductory Platinum exercises style'
    : difficulty === 'above'
    ? 'ABOVE grade — extension/challenge Platinum exercises style, higher-order focus'
    : 'ON grade — standard Platinum core exercises style';

  const textbookNote = g <= 3
    ? 'Foundation Phase SA resources (Thelma Res / Spot On style)'
    : 'Platinum ' + subject + ' Grade ' + g + ' (Maskew Miller Longman)';

  const ageNote = g <= 3
    ? 'Foundation Phase: very simple language, short sentences, age ' + (5+g) + '-' + (6+g) + '.'
    : g <= 6
    ? 'Intermediate Phase: clear engaging language for age ' + (9+(g-4)) + '-' + (10+(g-4)) + '.'
    : 'Senior Phase: formal academic language for teenagers.';

  let bloomsNote = '';
  if (bloomsMode === 'single' && bloomsLevels && bloomsLevels.length > 0)
    bloomsNote = 'Bloom\'s teacher focus (overrides default): ' + bloomsLevels[0] + ' level — weight questions toward this level.';
  else if (bloomsMode === 'mixed' && bloomsLevels && bloomsLevels.length > 0)
    bloomsNote = 'Bloom\'s teacher focus (overrides default): blend of ' + bloomsLevels.join(', ') + ' — label sections with Bloom\'s level.';

  const diagTypeMap = {
    agent:'most educationally appropriate for this topic',
    bar:'bar graph or pie chart',
    line:'line graph',
    science:'scientific diagram (food chain, plant parts, water cycle etc)',
    flow:'flow diagram',
    map:'map or grid',
    maths:'number line or geometric diagram'
  };

  let diagNote = '';
  if (numDiag > 0) {
    const placement = diagramPlacement === 'beginning' ? 'before Section A' : diagramPlacement === 'end' ? 'after TOTAL line' : 'inline at relevant questions';
    diagNote = 'DIAGRAMS: ' + numDiag + ' x ' + (diagTypeMap[diagramType] || 'suitable') + '. Placement: ' + placement + '. Insert [DIAGRAM_1]' + (numDiag > 1 ? ' [DIAGRAM_2]' : '') + (numDiag > 2 ? ' [DIAGRAM_3]' : '') + ' placeholders at correct positions. Each SVG: viewBox="0 0 520 300" width="520" height="300", white background, Arial font, colours #085041 #1D9E75 #E1F5EE #185FA5 #BA7517, grade-appropriate, topic-specific.';
  }

  const rubricNote = includeRubric ? '\n\n═══════════════════════════════════\nMARKING RUBRIC\n═══════════════════════════════════\n[4-level rubric aligned to DoE cognitive levels. Level 1=not achieved, Level 4=outstanding.]' : '';

  const system = 'You are an expert South African CAPS ' + phase + ' teacher creating resources for The Resource Room. Language: ' + language + ' only.\n\n' + ageNote + '\n\nWRITING STYLE: Warm, professional SA teacher. Use SA context (rands, local names like Sipho/Ayanda/Lerato/Zanele, tuck shops, SA wildlife, local scenarios). Vary question types. Sound like a real experienced teacher.\n\nDOE COGNITIVE LEVELS (MANDATORY): ' + doeRatios + '\nLabel each section with its cognitive level and percentage. Show mark split in teacher instructions. Calculate marks per section from total.\n' + (bloomsNote ? bloomsNote + '\n' : '') + '\nDIFFICULTY: ' + diffNote + '\n\nTEXTBOOK ALIGNMENT: ' + textbookNote + '. Match vocabulary, terminology, worked example format, and difficulty progression. For Grade 4-7: reference the Platinum chapter in teacher instructions.\n\nATP: Grade ' + g + ' Term ' + t + ' ' + subject + ' — topic: ' + topic + '. Stay within this term\'s scope only.\n' + (diagNote ? '\n' + diagNote + '\n' : '') + '\nRESPOND with valid JSON ONLY — no markdown, no preamble:\n{"content":"full resource text","diagrams":' + (numDiag > 0 ? '{"diagram1":{"title":"Figure 1: [title]","caption":"[explanation and instruction]","svg":"[complete SVG element]"}}' : 'null') + '}\n\nCONTENT STRUCTURE:\n\n═══════════════════════════════════\nTEACHER INSTRUCTIONS\n═══════════════════════════════════\nTime: [X min] | Grade: ' + g + ' | Term: ' + t + ' | ' + phase + '\nDifficulty: [level] | Textbook: ' + textbookNote + ' — Chapter/Unit: [X]\nDoE cognitive split: ' + doeRatios + '\nMark allocation: [show e.g. K: 10, RP: 18, CP: 15, PS: 7 = 50 marks]\nMaterials: [list]\nCAPS ref: Grade ' + g + ' | Term ' + t + ' | ' + subject + ' | ' + topic + '\nNotes: [2-3 practical teacher preparation notes]\n\n═══════════════════════════════════\nTHE RESOURCE ROOM — [RESOURCE TYPE]\n[Subject] | Grade ' + g + ' | Term ' + t + ' | ' + language + ' | Total: [X] marks\n═══════════════════════════════════\n\nLearner Name: ___________________________\n\nDate: ________________  Class: ____________\n\n[Sections labelled with DoE cognitive level e.g. SECTION A — Knowledge (20%) — [X] marks. Min 10 questions. Marks per question in brackets. Varied types.]\n\n\nTOTAL: _________ / [X]\n\n═══════════════════════════════════\nMEMORANDUM\n═══════════════════════════════════\n[Numbered answers with marks. Model answers for open questions. Notes on alternatives.]\n\nTotal: [X] marks' + rubricNote + '\n\n═══════════════════════════════════\nEXTENSION ACTIVITY\n═══════════════════════════════════\n[One higher-order challenge at Problem Solving / Higher Order level with full answer]';

  const user = subject + ' | ' + topic + ' | ' + resourceType + ' | ' + language + ' | Grade ' + g + ' Term ' + t + ' | ' + duration + ' | ' + difficulty + ' grade level' + (bloomsMode && bloomsMode !== 'none' ? ' | Blooms: ' + (bloomsLevels || []).join(', ') : '') + (numDiag > 0 ? ' | ' + numDiag + ' diagram(s) ' + (diagramPlacement || 'beginning') : '') + (includeRubric ? ' | Include rubric' : '') + '\n\nApply DoE cognitive level ratios strictly. Align with ' + textbookNote + '. Use SA context throughout. Minimum 10 questions. Return valid JSON only.';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 5000,
        system,
        messages: [{ role: 'user', content: user }]
      })
    });

    const responseText = await response.text();

    if (!response.ok) {
      let errMsg = 'API error ' + response.status;
      try {
        const errData = JSON.parse(responseText);
        errMsg = errData.error?.message || errMsg;
      } catch(e) {
        errMsg = responseText.substring(0, 300) || errMsg;
      }
      return res.status(response.status).json({ error: errMsg });
    }

    let raw = '';
    try {
      const data = JSON.parse(responseText);
      raw = data.content?.map(c => c.text || '').join('') || '';
    } catch(e) {
      return res.status(500).json({ error: 'Failed to parse API response: ' + responseText.substring(0, 200) });
    }

    const clean = raw.replace(/```json|```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch (e) { parsed = { content: raw, diagrams: null }; }

    let diagramsArray = [];
    if (parsed.diagrams && typeof parsed.diagrams === 'object') {
      for (let i = 1; i <= numDiag; i++) {
        const d = parsed.diagrams['diagram' + i];
        if (d) diagramsArray.push({ ...d, index: i });
      }
    }

    return res.status(200).json({
      content: parsed.content || raw,
      diagrams: diagramsArray.length > 0 ? diagramsArray : null,
      diagramPlacement: diagramPlacement || 'beginning'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
