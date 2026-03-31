export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { subject, topic, resourceType, language, duration, difficulty, includeRubric } = req.body;
  if (!subject || !topic || !resourceType || !language) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const difficultyNote = difficulty === 'below'
    ? 'BELOW grade level — simplified language, smaller numbers, more scaffolding, shorter questions.'
    : difficulty === 'above'
    ? 'ABOVE grade level — extended thinking, multi-step problems, higher-order Bloom\'s taxonomy, stretch tasks.'
    : 'ON grade level — standard CAPS expectations for Grade 6 Term 3.';

  const rubricNote = includeRubric
    ? `\n\nAfter the MEMORANDUM, add a MARKING RUBRIC section:\n═══════════════════════════════════\nMARKING RUBRIC\n═══════════════════════════════════\n[A clear rubric table with criteria, levels (1-4), and descriptors appropriate for the resource type]`
    : '';

  const system = `You are an expert South African CAPS curriculum specialist creating Grade 6 Term 3 teaching resources for The Resource Room. Write entirely in ${language}. Never mix languages.

Difficulty level: ${difficultyNote}

Use this exact structure — keep all separator lines:

═══════════════════════════════════
TEACHER INSTRUCTIONS
═══════════════════════════════════
Time: [duration]
Difficulty: [Below / On / Above grade level]
Materials: [list]
CAPS reference: Grade 6 Term 3 — [subject] — [topic]
Notes: [brief prep notes]

═══════════════════════════════════
THE RESOURCE ROOM — ${resourceType.toUpperCase()}
Subject: [subject] | Grade 6 | Term 3 | ${language}
Difficulty: [level] | Duration: [time] | Total: [X] marks
═══════════════════════════════════

Learner Name: ___________________________ Date: ___________ Class: _______

[Minimum 10 numbered questions or activities with marks in brackets e.g. (2). Organise into SECTION A, SECTION B etc.]

TOTAL: ____/ [X]

═══════════════════════════════════
MEMORANDUM
═══════════════════════════════════
[Numbered answers with marks per question]

TOTAL: [X] marks

═══════════════════════════════════
EXTENSION ACTIVITY
═══════════════════════════════════
[One challenge task with answer]${rubricNote}`;

  const user = `Create a complete teacher pack:
Subject: ${subject}
Topic: ${topic}
Type: ${resourceType}
Language: ${language}
Difficulty: ${difficulty || 'on'} grade level
Grade 6 | Term 3 | ${duration}
${includeRubric ? 'Include a detailed marking rubric.' : ''}
Minimum 10 questions with mark allocations. Genuinely educational for South African Grade 6 learners.`;

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
        max_tokens: 4500,
        system,
        messages: [{ role: 'user', content: user }]
      })
    });
    if (!response.ok) {
      const e = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: e.error?.message || 'API error' });
    }
    const data = await response.json();
    const text = data.content?.map(c => c.text || '').join('') || '';
    return res.status(200).json({ content: text });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
