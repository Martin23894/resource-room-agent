export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { subject, topic, resourceType, language, difficulty, grade, term } = req.body;
  if (!subject || !topic || !resourceType) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const system = `You are a professional educational product copywriter for The Resource Room, a South African CAPS-aligned teaching resources brand. Write compelling, teacher-focused product listings for the Teacha Resources marketplace.

Always respond in JSON only — no preamble, no markdown fences. Return exactly this structure:
{
  "productTitle": "...",
  "tagline": "...",
  "description": "...",
  "whatIncluded": ["...", "...", "..."],
  "suitableFor": "...",
  "keywords": ["...", "...", "..."],
  "suggestedPrice": "..."
}`;

  const user = `Create a Teacha Resources product listing for:
Subject: ${subject}
Topic: ${topic}
Resource type: ${resourceType}
Language: ${language}
Grade: ${grade || 6}
Term: ${term || 3}
Difficulty: ${difficulty || 'on'} grade level

The product title should be compelling and searchable. The description should be 3-4 sentences explaining value to SA teachers. whatIncluded should list 4-6 bullet points of what's in the pack. suggestedPrice should be in ZAR (R30-R120 range depending on resource type). Keywords should include 6-8 search terms SA teachers would use.`;

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
        max_tokens: 1000,
        system,
        messages: [{ role: 'user', content: user }]
      })
    });
    if (!response.ok) {
      const e = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: e.error?.message || 'API error' });
    }
    const data = await response.json();
    const raw = data.content?.map(c => c.text || '').join('') || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
