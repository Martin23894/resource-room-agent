export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { subject, topic, resourceType, language, duration, difficulty, includeRubric, includeDiagram, diagramType } = req.body;
  if (!subject || !topic || !resourceType || !language) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const difficultyNote = difficulty === 'below'
    ? 'BELOW grade level — simplified language, smaller numbers, more scaffolding, shorter questions. Confidence-building tasks.'
    : difficulty === 'above'
    ? 'ABOVE grade level — multi-step problems, higher-order thinking, extended responses, genuine stretch tasks.'
    : 'ON grade level — standard CAPS Grade 6 Term 3 expectations. Balanced knowledge, comprehension and application.';

  const rubricSection = includeRubric ? `

═══════════════════════════════════
MARKING RUBRIC
═══════════════════════════════════
[4-level rubric table (Level 1-4) with specific practical descriptors for this task type.]` : '';

  const diagramTypeMap = {
    'agent': 'Choose the most appropriate diagram type for this topic.',
    'bar': 'Bar graph or pie chart (data handling / statistics)',
    'line': 'Line graph (trends over time)',
    'science': 'Scientific diagram (food chain, plant parts, water cycle, life cycle etc.)',
    'flow': 'Flow diagram (process, cause-and-effect, steps in order)',
    'map': 'Map, grid or compass diagram (Social Sciences / Geography)',
    'maths': 'Number line, geometric shape, or mathematical diagram (Maths)'
  };

  const diagramInstruction = includeDiagram ? `

DIAGRAM REQUIREMENT — CRITICAL:
You must include a diagram in this resource. Type requested: ${diagramTypeMap[diagramType] || diagramTypeMap['agent']}

In your JSON response, the "diagram" object must contain:
- "title": short title for the diagram (e.g. "Figure 1: The Water Cycle")
- "caption": 1-2 sentence explanation of what the diagram shows and what learners must do with it
- "svg": a complete, valid, self-contained SVG element (no external dependencies, no JavaScript)

SVG requirements:
- viewBox="0 0 520 320" width="520" height="320"
- Background: white rectangle covering full area
- All text must use font-family="Arial, sans-serif"
- Use clear labels, clean lines, appropriate colours
- Include a title at the top of the SVG
- For graphs: include axes with labels, gridlines, data points/bars with values
- For science diagrams: clear labelled illustrations with arrows
- For flow diagrams: boxes connected with arrows showing sequence
- For maps/grids: grid lines, compass rose, labels
- For maths diagrams: clear geometric shapes or number lines with markings
- Make it genuinely educational and suitable for Grade 6
- Colours: use #085041 (dark teal), #1D9E75 (mid teal), #E1F5EE (light teal), #185FA5 (blue), #BA7517 (amber), #888780 (grey) — professional palette
- The diagram must relate directly to the topic: ${topic}

The diagram should appear as a question or activity in the resource (e.g. "Study Figure 1 and answer the questions below" or "Complete the diagram by filling in the missing labels").` : '';

  const system = `You are an experienced South African primary school teacher and curriculum developer. You create Grade 6 Term 3 CAPS-aligned resources for The Resource Room.

WRITING STYLE:
- Warm, clear and professional — sounds like a real experienced teacher
- Use South African context: local names, rands, tuck shops, wildlife, familiar SA scenarios
- Vary question types naturally. Never repeat the same pattern
- Instructions to learners are friendly and encouraging
- Write as if you genuinely care about every learner

Language: ${language} only. Never mix languages.
Difficulty: ${difficultyNote}
${diagramInstruction}

RESPONSE FORMAT — you must respond with valid JSON only. No markdown, no preamble. Exactly this structure:
{
  "content": "the full resource text using the structure below",
  "diagram": ${includeDiagram ? '{ "title": "...", "caption": "...", "svg": "..." }' : 'null'}
}

The "content" field must use this exact structure:

═══════════════════════════════════
TEACHER INSTRUCTIONS
═══════════════════════════════════
Time allocation: [X minutes]
Difficulty: [level]
Materials needed: [list]
CAPS reference: Grade 6 | Term 3 | [subject] | [topic]
${includeDiagram ? 'Diagram included: [diagram type and brief description]\n' : ''}Preparation notes: [2-3 genuinely useful sentences]

═══════════════════════════════════
THE RESOURCE ROOM — [RESOURCE TYPE]
[Subject] | Grade 6 | Term 3 | ${language}
Duration: [time] | Total: [X] marks
═══════════════════════════════════

Learner Name: _________________________________

Date: ____________________  Class: ____________

${includeDiagram ? '\n[DIAGRAM PLACEHOLDER — the diagram will appear here]\n\n' : ''}
[SECTION A, SECTION B etc. with brief friendly instructions. Minimum 10 questions. Marks in brackets. Varied question types. ${includeDiagram ? 'Include at least 2-3 questions that refer directly to the diagram.' : ''}]


TOTAL: _________ / [X]

═══════════════════════════════════
MEMORANDUM
═══════════════════════════════════
[Numbered answers with marks. Model answers for open-ended questions. Notes on acceptable alternatives.]

Total: [X] marks${rubricSection}

═══════════════════════════════════
EXTENSION / ENRICHMENT ACTIVITY
═══════════════════════════════════
[One meaningful challenge activity with full answer]`;

  const user = `Create a complete teacher pack:
Subject: ${subject}
Topic: ${topic}
Resource type: ${resourceType}
Language: ${language}
Grade 6 | Term 3 | ${duration}
Difficulty: ${difficulty || 'on'} grade level
${includeRubric ? 'Include marking rubric.' : ''}
${includeDiagram ? `Include a ${diagramTypeMap[diagramType] || 'suitable'} diagram embedded in the resource.` : ''}

Use real South African context. Questions must feel crafted by an experienced teacher. Minimum 10 questions. Return valid JSON only.`;

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

    // Parse JSON response
    const clean = raw.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      // Fallback: treat entire response as content if JSON parse fails
      parsed = { content: raw, diagram: null };
    }

    return res.status(200).json({
      content: parsed.content || raw,
      diagram: parsed.diagram || null
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
