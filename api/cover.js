import { logger as defaultLogger } from '../lib/logger.js';
import { callAnthropic, AnthropicError } from '../lib/anthropic.js';
import { str, int, oneOf, ValidationError } from '../lib/validate.js';

export default async function handler(req, res) {
  const log = req.log || defaultLogger;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let subject, topic, resourceType, language, difficulty, grade, term;
  try {
    subject      = str(req.body?.subject,      { field: 'subject',      max: 200 });
    topic        = str(req.body?.topic,        { field: 'topic',        max: 500 });
    resourceType = str(req.body?.resourceType, { field: 'resourceType', max: 50 });
    language     = str(req.body?.language,     { field: 'language', required: false, max: 40 }) || 'English';
    difficulty   = oneOf(req.body?.difficulty || 'on', ['below', 'on', 'above'], { field: 'difficulty' });
    grade        = int(req.body?.grade, { field: 'grade', required: false, min: 4, max: 7 }) || 6;
    term         = int(req.body?.term,  { field: 'term',  required: false, min: 1, max: 4 }) || 3;
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
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
Grade: ${grade}
Term: ${term}
Difficulty: ${difficulty} grade level

The product title should be compelling and searchable. The description should be 3-4 sentences explaining value to SA teachers. whatIncluded should list 4-6 bullet points of what's in the pack. suggestedPrice should be in ZAR (R30-R120 range depending on resource type). Keywords should include 6-8 search terms SA teachers would use.`;

  try {
    const raw = await callAnthropic({ system, user, maxTokens: 1000, logger: log });

    const clean = raw.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      log.error({ err: parseErr.message, preview: clean.substring(0, 200) }, 'Cover JSON parse error');
      return res.status(500).json({ error: 'AI returned malformed data. Please try again.' });
    }
    return res.status(200).json(parsed);
  } catch (err) {
    log.error({ err: err?.message || err }, 'Cover error');
    if (err instanceof AnthropicError && err.code === 'TIMEOUT') {
      return res.status(504).json({ error: 'Listing generation timed out. Please try again.' });
    }
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({ error: err?.message || 'Server error' });
  }
}
