export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { originalContent, refinementInstruction, subject, topic, resourceType, language, grade, term } = req.body;
  if (!originalContent || !refinementInstruction) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const system = 'You are an experienced South African CAPS teacher who created the resource below. A teacher wants one specific change made.\n\nSTRICT RULES:\n1. Apply ONLY the requested change — nothing else\n2. Return the COMPLETE resource with the change applied\n3. NEVER include your reasoning, thinking, or explanations in the content field\n4. NEVER delete or move existing sections, diagrams, or placeholders like [DIAGRAM_1]\n5. Keep ALL diagram placeholders ([DIAGRAM_1], [DIAGRAM_2] etc) exactly where they are\n6. Keep CAPS alignment for Grade ' + (grade||'') + ' Term ' + (term||'') + '\n7. Write entirely in ' + (language||'English') + '\n\nRespond with valid JSON ONLY — no markdown, no thinking, no explanation outside the JSON:\n{"content":"complete updated resource text — resource only, no meta-commentary","changesSummary":"one sentence: what changed"}';

  const user = 'ORIGINAL RESOURCE:\n\n' + originalContent + '\n\n---\nINSTRUCTION: "' + refinementInstruction + '"\n\nReturn the complete updated resource as JSON. The "content" field must contain ONLY the resource — no reasoning, no explanations, no meta-commentary. Keep all [DIAGRAM_N] placeholders exactly in place.';

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
        max_tokens: 3500,
        system,
        messages: [{ role: 'user', content: user }]
      })
    });

    const responseText = await response.text();

    if (!response.ok) {
      let errMsg = 'API error ' + response.status;
      try { const errData = JSON.parse(responseText); errMsg = errData.error?.message || errMsg; }
      catch(e) { errMsg = responseText.substring(0, 200) || errMsg; }
      return res.status(response.status).json({ error: errMsg });
    }

    let raw = '';
    try { const data = JSON.parse(responseText); raw = data.content?.map(c => c.text || '').join('') || ''; }
    catch(e) { return res.status(500).json({ error: 'Failed to parse API response: ' + responseText.substring(0, 200) }); }

    const clean = raw.replace(/```json|```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch(e) {
      parsed = { content: raw, changesSummary: 'Resource updated.' };
    }

    if (parsed.content) {
      parsed.content = parsed.content.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    }

    return res.status(200).json({
      content: parsed.content || '',
      changesSummary: parsed.changesSummary || 'Resource updated.'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
