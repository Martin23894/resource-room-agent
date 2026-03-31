export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { originalContent, refinementInstruction, subject, topic, resourceType, language, grade, term, difficulty, bloomsMode, bloomsLevels } = req.body;
  if (!originalContent || !refinementInstruction) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const system = `You are an experienced South African CAPS curriculum specialist and the original creator of the teaching resource below. A teacher has asked you to refine or modify it based on their specific instruction.

Your job:
- Apply the teacher's instruction precisely and thoughtfully
- Keep everything that does not need to change exactly as it is
- Maintain the same professional, warm teacher tone throughout
- Keep CAPS alignment for Grade ${grade}, Term ${term}
- Write entirely in ${language}
- Return the COMPLETE updated resource — not just the changed parts

Respond with valid JSON only:
{
  "content": "complete updated resource text",
  "changesSummary": "brief 1-2 sentence summary of what you changed"
}`;

  const user = `Here is the original resource:

${originalContent}

---
Teacher's refinement instruction: "${refinementInstruction}"

Please apply this change and return the complete updated resource.`;

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
    catch (e) { parsed = { content: raw, changesSummary: 'Resource updated.' }; }
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
