export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Check 1: Is API key set?
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      status: 'ERROR',
      problem: 'ANTHROPIC_API_KEY environment variable is NOT set in Vercel',
      fix: 'Go to Vercel → Settings → Environment Variables → Add ANTHROPIC_API_KEY'
    });
  }

  // Check 2: Does the key look valid?
  if (!apiKey.startsWith('sk-ant-')) {
    return res.status(200).json({
      status: 'ERROR',
      problem: 'API key does not look valid (should start with sk-ant-)',
      keyPreview: apiKey.substring(0, 10) + '...'
    });
  }

  // Check 3: Make a minimal test call to Anthropic
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say OK' }]
      })
    });

    const text = await response.text();

    if (response.ok) {
      return res.status(200).json({
        status: 'SUCCESS',
        message: 'API key is valid and working correctly',
        httpStatus: response.status,
        keyPreview: apiKey.substring(0, 12) + '...'
      });
    } else {
      return res.status(200).json({
        status: 'ERROR',
        problem: 'API call failed',
        httpStatus: response.status,
        apiResponse: text.substring(0, 300),
        keyPreview: apiKey.substring(0, 12) + '...'
      });
    }
  } catch (err) {
    return res.status(200).json({
      status: 'ERROR',
      problem: 'Network error connecting to Anthropic',
      error: err.message
    });
  }
}
