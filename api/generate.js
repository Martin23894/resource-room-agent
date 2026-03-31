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

  const gradeNum = parseInt(grade) || 6;
  const termNum = parseInt(term) || 3;
  const phase = gradeNum <= 3 ? 'Foundation Phase' : gradeNum <= 6 ? 'Intermediate Phase' : 'Senior Phase';
  const numDiagrams = parseInt(diagramCount) || 0;

  const difficultyNote = difficulty === 'below'
    ? 'BELOW grade level — simplified language, more scaffolding, confidence-building tasks.'
    : difficulty === 'above'
    ? 'ABOVE grade level — multi-step problems, higher-order thinking, genuine stretch tasks.'
    : `ON grade level — standard CAPS expectations for Grade ${gradeNum} Term ${termNum}.`;

  const bloomsDescriptions = {
    remember: 'REMEMBER — recall, define, list, identify, name facts',
    understand: 'UNDERSTAND — explain, describe, summarise, classify',
    apply: 'APPLY — use in new situations, solve, demonstrate, calculate',
    analyse: 'ANALYSE — break down, differentiate, compare and contrast',
    evaluate: 'EVALUATE — judge, justify, critique, defend a position',
    create: 'CREATE — design, construct, plan, produce, compose'
  };

  let bloomsNote = '';
  if (bloomsMode === 'single' && bloomsLevels?.length > 0) {
    bloomsNote = `\nBLOOM'S — Single level: ${bloomsDescriptions[bloomsLevels[0]] || bloomsLevels[0]}`;
  } else if (bloomsMode === 'mixed' && bloomsLevels?.length > 0) {
    const descs = bloomsLevels.map(l => bloomsDescriptions[l] || l).join('; ');
    bloomsNote = `\nBLOOM'S — Mixed levels: ${descs}. Label each section with its Bloom's level. Progress lower → higher order.`;
  }

  const rubricSection = includeRubric
    ? `\n\n═══════════════════════════════════\nMARKING RUBRIC\n═══════════════════════════════════\n[4-level rubric with practical descriptors aligned to Bloom's levels used.]`
    : '';

  const diagramTypeMap = {
    agent: 'Choose the most educationally appropriate diagram type for the topic and grade.',
    bar: 'Bar graph or pie chart (data handling)',
    line: 'Line graph (trends over time)',
    science: 'Scientific diagram (food chain, plant parts, water cycle, life cycle)',
    flow: 'Flow diagram (process, cause-and-effect, steps)',
    map: 'Map, grid or compass rose (Geography)',
    maths: 'Number line, geometric shapes, or mathematical diagram'
  };

  const svgRules = `SVG rules for EVERY diagram:
- viewBox="0 0 520 300" width="520" height="300"
- First element: <rect width="520" height="300" fill="white"/>
- font-family="Arial, sans-serif" on ALL text elements
- Professional colours: #085041 #1D9E75 #E1F5EE #185FA5 #BA7517 #888780 #E6F1FB
- Clear labels, clean lines, grade-appropriate for Grade ${gradeNum}
- Title text at top of SVG
- No JavaScript, no external resources`;

  // Build diagram instruction based on count and placement
  let diagramInstruction = '';
  if (numDiagrams > 0) {
    const placementDesc = diagramPlacement === 'beginning'
      ? 'ALL diagrams appear BEFORE the questions. Place the placeholder(s) right after the learner header (Name/Date/Class line), before SECTION A.'
      : diagramPlacement === 'end'
      ? 'ALL diagrams appear AFTER all questions, before the MEMORANDUM. Place the placeholder(s) after the TOTAL line and before the memorandum separator.'
      : `INLINE placement — each diagram appears at the most relevant question. Place [DIAGRAM_N] placeholder directly below the question it belongs to. The diagram should illustrate exactly what that question is testing.`;

    const diagramObjects = Array.from({length: numDiagrams}, (_, i) => {
      const n = i + 1;
      return `"diagram${n}": {
  "title": "Figure ${n}: [descriptive title]",
  "caption": "[1-2 sentences: what diagram shows and what learner must do]",
  "svg": "[complete self-contained SVG element]"
}`;
    }).join(',\n  ');

    diagramInstruction = `

DIAGRAMS REQUIRED: ${numDiagrams} diagram(s)
Type: ${diagramTypeMap[diagramType] || diagramTypeMap['agent']}
Placement: ${placementDesc}

${diagramPlacement === 'inline' ? `In the "content" field, insert the placeholder [DIAGRAM_1]${numDiagrams > 1 ? ', [DIAGRAM_2]' : ''}${numDiagrams > 2 ? ', [DIAGRAM_3]' : ''} exactly where each diagram should appear inline with questions. Each diagram must have 2-3 questions immediately following it that refer directly to it (e.g. "Study Figure 1 and answer the questions below:").` : `In the "content" field, insert ${numDiagrams === 1 ? 'the placeholder [DIAGRAM_1]' : `the placeholders [DIAGRAM_1]${numDiagrams > 1 ? ' [DIAGRAM_2]' : ''}${numDiagrams > 2 ? ' [DIAGRAM_3]' : ''}`} at the correct position (${diagramPlacement === 'beginning' ? 'after learner details, before Section A' : 'after TOTAL line, before memorandum'}).`}

${svgRules}

Include ${numDiagrams > 1 ? `${numDiagrams} different` : 'a'} diagram${numDiagrams > 1 ? 's' : ''} — each must relate directly to the topic "${topic}" and be genuinely educational for Grade ${gradeNum}.`;
  }

  const ageGuidance = gradeNum <= 3
    ? `Foundation Phase: Very simple language, short sentences, fun and encouraging. Age-appropriate for ${5 + gradeNum}-${6 + gradeNum} year olds.`
    : gradeNum <= 6
    ? `Intermediate Phase: Clear engaging language for ${9 + (gradeNum - 4)}-${10 + (gradeNum - 4)} year olds. Mix of question types. Use SA context.`
    : `Senior Phase: More formal academic language for teenagers. Higher complexity. Challenge critical thinking.`;

  // Build the JSON diagram fields for the response
  const diagramFields = numDiagrams === 0
    ? '"diagrams": null'
    : `"diagrams": {\n  ${Array.from({length: numDiagrams}, (_, i) => {
        const n = i + 1;
        return `"diagram${n}": { "title": "...", "caption": "...", "svg": "..." }`;
      }).join(',\n  ')}\n}`;

  const system = `You are an experienced South African ${phase} teacher and curriculum developer creating CAPS-aligned resources for The Resource Room.

WRITING STYLE:
- Warm, professional — sounds like a real experienced teacher
- Use South African context: rands, local names (Sipho, Ayanda, Lerato, Pieter, Zanele), tuck shops, SA wildlife, local scenarios
- Vary question types naturally. Never repeat the same pattern.
- Friendly and encouraging instructions to learners
Language: ${language} only. Never mix languages.
Difficulty: ${difficultyNote}
${ageGuidance}${bloomsNote}${diagramInstruction}

CRITICAL: Respond with valid JSON ONLY. No markdown, no preamble, no explanation. Exactly this structure:
{
  "content": "complete resource text using the structure below",
  ${diagramFields}
}

The "content" field must use this exact structure:

═══════════════════════════════════
TEACHER INSTRUCTIONS
═══════════════════════════════════
Time allocation: [X minutes]
Grade: ${gradeNum} | Term: ${termNum} | Phase: ${phase}
Difficulty: [level]
${bloomsMode && bloomsLevels?.length ? "Bloom's level(s): [levels]\n" : ''}${numDiagrams > 0 ? `Diagrams: ${numDiagrams} x ${diagramTypeMap[diagramType] || 'diagram'} (placement: ${diagramPlacement})\n` : ''}Materials needed: [list]
CAPS reference: Grade ${gradeNum} | Term ${termNum} | [subject] | [topic]
Preparation notes: [2-3 genuinely useful practical sentences]

═══════════════════════════════════
THE RESOURCE ROOM — [RESOURCE TYPE]
[Subject] | Grade ${gradeNum} | Term ${termNum} | ${language}
Duration: [time] | Total: [X] marks
═══════════════════════════════════

Learner Name: _________________________________

Date: ____________________  Class: ____________

${diagramPlacement === 'beginning' && numDiagrams > 0 ? '[DIAGRAM_1 placeholder here — before Section A]\n' : ''}
[SECTION A, SECTION B etc. Brief friendly instruction per section. Minimum 10 questions. Marks in brackets. Varied types.${diagramPlacement === 'inline' && numDiagrams > 0 ? ' Insert [DIAGRAM_N] placeholders inline at relevant questions.' : ''}]

TOTAL: _________ / [X]
${diagramPlacement === 'end' && numDiagrams > 0 ? '\n[DIAGRAM_1 placeholder here — after TOTAL, before memorandum]\n' : ''}
═══════════════════════════════════
MEMORANDUM
═══════════════════════════════════
[Numbered answers with marks. Model answers for open-ended. Notes on acceptable alternatives.]

Total: [X] marks${rubricSection}

═══════════════════════════════════
EXTENSION / ENRICHMENT ACTIVITY
═══════════════════════════════════
[One meaningful challenge with full answer]`;

  const user = `Create a complete teacher pack:
Subject: ${subject}
Topic: ${topic}
Resource type: ${resourceType}
Language: ${language}
Grade: ${gradeNum} | Term: ${termNum} | ${phase}
Duration: ${duration}
Difficulty: ${difficulty || 'on'} grade level
${bloomsMode ? `Bloom's: ${bloomsMode} | Levels: ${(bloomsLevels || []).join(', ')}` : ''}
${numDiagrams > 0 ? `Diagrams: ${numDiagrams} | Type: ${diagramTypeMap[diagramType] || 'suitable'} | Placement: ${diagramPlacement}` : ''}
${includeRubric ? 'Include marking rubric.' : ''}

Use real SA context. Sound like an experienced teacher. Minimum 10 questions. Return valid JSON ONLY.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 6000,
        system,
        messages: [{ role: 'user', content: user }]
      })
    });

    if (!response.ok) {
      const e = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: e.error?.message || 'API error' });
    }

    const data = await response.json();
    const raw = data.content?.map(c => c.text || '').join('') || '';
    const clean = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(clean); }
    catch (e) { parsed = { content: raw, diagrams: null }; }

    // Normalise diagrams into an array
    let diagramsArray = [];
    if (parsed.diagrams && typeof parsed.diagrams === 'object') {
      for (let i = 1; i <= numDiagrams; i++) {
        const d = parsed.diagrams[`diagram${i}`];
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
