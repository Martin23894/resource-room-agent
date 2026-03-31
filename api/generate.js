export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    subject, topic, resourceType, language, duration, difficulty,
    includeRubric, includeDiagram, diagramType,
    grade, term,
    bloomsMode, bloomsLevels
  } = req.body;

  if (!subject || !topic || !resourceType || !language) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const gradeNum = parseInt(grade) || 6;
  const termNum = parseInt(term) || 3;
  const phase = gradeNum <= 3 ? 'Foundation Phase' : gradeNum <= 6 ? 'Intermediate Phase' : 'Senior Phase';

  const difficultyNote = difficulty === 'below'
    ? 'BELOW grade level — simplified language, smaller numbers, more scaffolding, confidence-building tasks.'
    : difficulty === 'above'
    ? 'ABOVE grade level — multi-step problems, higher-order thinking, extended responses, genuine stretch tasks.'
    : `ON grade level — standard CAPS expectations for Grade ${gradeNum} Term ${termNum}.`;

  // Bloom's Taxonomy guidance
  const bloomsDescriptions = {
    remember: 'REMEMBER — recall, define, list, identify, name, recognise facts and basic concepts',
    understand: 'UNDERSTAND — explain, describe, summarise, classify, compare in own words',
    apply: 'APPLY — use knowledge in new situations, solve problems, demonstrate, calculate',
    analyse: 'ANALYSE — break down, differentiate, organise, examine, compare and contrast',
    evaluate: 'EVALUATE — judge, justify, critique, argue, assess, defend a position',
    create: 'CREATE — design, construct, plan, produce, compose, devise something new'
  };

  let bloomsNote = '';
  if (bloomsMode === 'single' && bloomsLevels && bloomsLevels.length > 0) {
    const level = bloomsLevels[0];
    bloomsNote = `\nBLOOM'S TAXONOMY — Single level focus: ${bloomsDescriptions[level] || level}\nAll questions and tasks must target this specific cognitive level. Use appropriate action verbs for this level throughout.`;
  } else if (bloomsMode === 'mixed' && bloomsLevels && bloomsLevels.length > 0) {
    const levelDescs = bloomsLevels.map(l => bloomsDescriptions[l] || l).join('\n  • ');
    bloomsNote = `\nBLOOM'S TAXONOMY — Mixed cognitive levels:\n  • ${levelDescs}\nDistribute questions across these levels. Label each section or question type with its Bloom's level in brackets e.g. (Remember) (Apply). Progress from lower to higher order thinking.`;
  }

  const rubricSection = includeRubric ? `

═══════════════════════════════════
MARKING RUBRIC
═══════════════════════════════════
[4-level rubric (Level 1-4) with specific, practical descriptors aligned to the Bloom's levels used in this resource.]` : '';

  const diagramTypeMap = {
    agent: 'Choose the most educationally appropriate diagram type for this specific topic and grade level.',
    bar: 'Bar graph or pie chart (data handling)',
    line: 'Line graph (trends over time)',
    science: 'Scientific diagram (food chain, plant parts, water cycle, life cycle, body systems)',
    flow: 'Flow diagram (process, cause-and-effect, sequence of steps)',
    map: 'Map, grid or compass rose (Geography / Social Sciences)',
    maths: 'Number line, geometric shapes, or mathematical diagram'
  };

  const diagramInstruction = includeDiagram ? `

DIAGRAM REQUIREMENT:
Include a diagram. Type: ${diagramTypeMap[diagramType] || diagramTypeMap['agent']}

In your JSON response the "diagram" object must contain:
- "title": e.g. "Figure 1: The Water Cycle"
- "caption": 1-2 sentences explaining what the diagram shows and what learners must do with it
- "svg": complete self-contained SVG (no external dependencies, no JavaScript)

SVG rules:
- viewBox="0 0 520 320" width="520" height="320"
- White background rectangle covering full area
- font-family="Arial, sans-serif" on all text
- Clear labels, clean lines, professional colours
- Colours: #085041, #1D9E75, #E1F5EE, #185FA5, #BA7517, #888780
- Grade-appropriate content for Grade ${gradeNum}
- Relate directly to topic: ${topic}
- Include at least 2-3 questions referring to this diagram in the resource` : '';

  const ageGuidance = gradeNum <= 3
    ? `Foundation Phase (Grade ${gradeNum}): Use very simple language, short sentences, large clear text, pictures/diagrams where possible, fun and encouraging tone. Questions must be age-appropriate for ${5 + gradeNum}-${6 + gradeNum} year olds.`
    : gradeNum <= 6
    ? `Intermediate Phase (Grade ${gradeNum}): Clear, engaging language appropriate for ${9 + gradeNum - 4}-${10 + gradeNum - 4} year olds. Mix of question types. Use South African context freely.`
    : `Senior Phase (Grade ${gradeNum}): More formal academic language appropriate for teenagers. Higher complexity expected. Challenge learners to think critically.`;

  const system = `You are an experienced South African ${phase} teacher and curriculum developer. You create CAPS-aligned teaching resources for The Resource Room — a professional educational publishing brand trusted by SA teachers.

WRITING STYLE:
- Warm, professional, sounds like a real experienced teacher wrote this
- Use South African context: rands, local names (Sipho, Ayanda, Lerato, Pieter, Zanele), tuck shops, load-shedding, wildlife, SA sport, familiar local scenarios
- Vary question types naturally — never repeat the same pattern
- Instructions are friendly and encouraging
- Write as if you genuinely care about every learner
${ageGuidance}

Language: ${language} only. Never mix languages.
Difficulty: ${difficultyNote}${bloomsNote}
${diagramInstruction}

RESPONSE: valid JSON only. No markdown, no preamble:
{
  "content": "full resource text using structure below",
  "diagram": ${includeDiagram ? '{ "title": "...", "caption": "...", "svg": "..." }' : 'null'}
}

Use this exact structure in the "content" field:

═══════════════════════════════════
TEACHER INSTRUCTIONS
═══════════════════════════════════
Time allocation: [X minutes]
Grade: ${gradeNum} | Term: ${termNum} | Phase: ${phase}
Difficulty: [level]
${bloomsMode && bloomsLevels?.length ? 'Bloom\'s level(s): [levels]\n' : ''}Materials needed: [list]
CAPS reference: Grade ${gradeNum} | Term ${termNum} | [subject] | [topic]
${includeDiagram ? 'Diagram included: [type and description]\n' : ''}Preparation notes: [2-3 genuinely useful practical sentences]

═══════════════════════════════════
THE RESOURCE ROOM — [RESOURCE TYPE]
[Subject] | Grade ${gradeNum} | Term ${termNum} | ${language}
Duration: [time] | Total: [X] marks
═══════════════════════════════════

Learner Name: _________________________________

Date: ____________________  Class: ____________

[SECTION A, SECTION B etc. Brief friendly instruction per section. Minimum 10 questions/activities. Marks in brackets. Varied question types.${bloomsMode === 'mixed' ? ' Label each section with its Bloom\'s level.' : ''}]

TOTAL: _________ / [X]

═══════════════════════════════════
MEMORANDUM
═══════════════════════════════════
[Numbered answers with marks. Model answers for open-ended questions. Notes on acceptable alternatives.]

Total: [X] marks${rubricSection}

═══════════════════════════════════
EXTENSION / ENRICHMENT ACTIVITY
═══════════════════════════════════
[One meaningful challenge activity with full answer — target the highest Bloom's level where appropriate]`;

  const user = `Create a complete teacher pack:
Subject: ${subject}
Topic: ${topic}
Resource type: ${resourceType}
Language: ${language}
Grade: ${gradeNum} | Term: ${termNum} | ${phase}
Duration: ${duration}
Difficulty: ${difficulty || 'on'} grade level
${bloomsMode ? `Bloom's mode: ${bloomsMode} | Levels: ${(bloomsLevels || []).join(', ')}` : ''}
${includeRubric ? 'Include marking rubric.' : ''}
${includeDiagram ? `Include a ${diagramTypeMap[diagramType] || 'suitable'} diagram.` : ''}

Use real South African context. Sound like an experienced teacher. Minimum 10 questions. Return valid JSON only.`;

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
        max_tokens: 5000,
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
    catch (e) { parsed = { content: raw, diagram: null }; }
    return res.status(200).json({ content: parsed.content || raw, diagram: parsed.diagram || null });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
