import { logger as defaultLogger } from '../lib/logger.js';
import { callAnthropic, AnthropicError } from '../lib/anthropic.js';
import { str, int, oneOf, teacherGuidance as vGuidance, buildGuidanceBlock, ValidationError } from '../lib/validate.js';

export default async function handler(req, res) {
  const log = req.log || defaultLogger;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let originalContent, refinementInstruction, subject, topic, resourceType, language, grade, term, guidance;
  try {
    originalContent       = str(req.body?.originalContent,       { field: 'originalContent', max: 100000 });
    refinementInstruction = str(req.body?.refinementInstruction, { field: 'refinementInstruction', max: 1000 });
    subject               = str(req.body?.subject,               { field: 'subject', required: false, max: 200 });
    topic                 = str(req.body?.topic,                 { field: 'topic', required: false, max: 500 });
    resourceType          = str(req.body?.resourceType,          { field: 'resourceType', required: false, max: 50 });
    language              = str(req.body?.language,              { field: 'language', required: false, max: 40 }) || 'English';
    grade                 = int(req.body?.grade, { field: 'grade', required: false, min: 4, max: 7 });
    term                  = int(req.body?.term,  { field: 'term',  required: false, min: 1, max: 4 });
    // Same pre-prompt the teacher set on the Generate call, passed through
    // so refinements stay consistent with the original constraints.
    guidance              = vGuidance(req.body?.teacherGuidance);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }

  const system =
    'You are an experienced South African CAPS teacher who created the resource below. A teacher wants one specific change made.\n\n' +
    'STRICT RULES:\n' +
    '1. Apply ONLY the requested change — nothing else\n' +
    '2. Return the COMPLETE resource with the change applied\n' +
    '3. NEVER include your reasoning, thinking, or explanations in the content field\n' +
    '4. NEVER delete or move existing sections, diagrams, or placeholders like [DIAGRAM_1]\n' +
    '5. Keep ALL diagram placeholders ([DIAGRAM_1], [DIAGRAM_2] etc) exactly where they are\n' +
    '6. Keep CAPS alignment for Grade ' + (grade || '') + ' Term ' + (term || '') + '\n' +
    '7. Write entirely in ' + language + '\n\n' +
    'Respond with valid JSON ONLY — no markdown, no thinking, no explanation outside the JSON:\n' +
    '{"content":"complete updated resource text — resource only, no meta-commentary","changesSummary":"one sentence: what changed"}';

  const user =
    buildGuidanceBlock(guidance) +
    'ORIGINAL RESOURCE:\n\n' + originalContent + '\n\n' +
    '---\nINSTRUCTION: "' + refinementInstruction + '"\n\n' +
    'Return the complete updated resource as JSON. The "content" field must contain ONLY the resource — no reasoning, no explanations, no meta-commentary. Keep all [DIAGRAM_N] placeholders exactly in place.';

  try {
    const raw = await callAnthropic({ system, user, maxTokens: 6000, logger: log });

    const clean = raw.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      parsed = { content: raw, changesSummary: 'Resource updated.' };
    }

    if (parsed.content) {
      parsed.content = parsed.content.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    }

    return res.status(200).json({
      content: parsed.content || '',
      changesSummary: parsed.changesSummary || 'Resource updated.',
    });
  } catch (err) {
    log.error({ err: err?.message || err }, 'Refine error');
    if (err instanceof AnthropicError && err.code === 'TIMEOUT') {
      return res.status(504).json({ error: 'Refinement timed out. Please try a smaller change.' });
    }
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({ error: err?.message || 'Server error' });
  }
}
