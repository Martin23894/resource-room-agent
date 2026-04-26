// Rebuild a Word document from an edited preview. No Claude calls — this
// takes the teacher's edited paper + memo text, runs it through the same
// buildDoc() used by /api/generate, and returns fresh DOCX bytes.
//
// The `preview` body is split into paper + memo on the first
// "MEMORANDUM" heading, matching the shape generate.js emits. If no
// MEMORANDUM line is present the whole text is treated as the paper and
// an empty memo is rendered.

import { Packer } from 'docx';

import { logger as defaultLogger } from '../lib/logger.js';
import { str, int, oneOf, bool, ValidationError } from '../lib/validate.js';
import { countMarks } from '../lib/marks.js';
import { createDocxBuilder } from '../lib/docx-builder.js';
import { localiseLabels } from '../lib/clean-output.js';

function splitPaperAndMemo(text) {
  const lines = String(text || '').split('\n');
  const memoIdx = lines.findIndex((l) => /^\s*\**\s*MEMORANDUM\b/i.test(l));
  if (memoIdx === -1) return { paper: lines.join('\n'), memo: '' };
  return {
    paper: lines.slice(0, memoIdx).join('\n').trimEnd(),
    memo:  lines.slice(memoIdx).join('\n').trimStart(),
  };
}

export default async function handler(req, res) {
  const log = req.log || defaultLogger;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let subject, resourceType, language, duration, grade, term, preview, includeRubric;
  try {
    subject      = str(req.body?.subject,      { field: 'subject',      max: 200 });
    resourceType = str(req.body?.resourceType, { field: 'resourceType', max: 50 });
    language     = str(req.body?.language,     { field: 'language',     max: 40 });
    duration     = int(req.body?.duration,     { field: 'duration',     required: false, min: 10, max: 200 }) || 50;
    grade        = int(req.body?.grade, { field: 'grade', min: 4, max: 7 });
    term         = int(req.body?.term,  { field: 'term',  min: 1, max: 4 });
    preview      = str(req.body?.preview, { field: 'preview', min: 1, max: 100000 });
    includeRubric = bool(req.body?.includeRubric);
    // Validate difficulty too, in case the caller passes it — we don't use
    // it for rebuild but we still want strict validation.
    oneOf(req.body?.difficulty || 'on', ['below', 'on', 'above'], { field: 'difficulty' });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }

  const isWorksheet = resourceType === 'Worksheet';
  const { paper, memo } = splitPaperAndMemo(preview);
  // F6 safety net: re-localise on Afrikaans rebuilds so any English
  // "Answer:"/"Working:" labels the teacher introduced (or that pre-date
  // the F5 broadening) get rewritten before re-rendering.
  const localisedPaper = localiseLabels(paper, language);
  const localisedMemo  = localiseLabels(memo, language);
  const markTotal = countMarks(localisedPaper) || duration;

  try {
    const docx = createDocxBuilder({
      subject, resourceType, language, grade, term, totalMarks: duration, isWorksheet,
    });
    const doc = docx.buildDoc(localisedPaper, localisedMemo, markTotal);
    const buffer = await Packer.toBuffer(doc);
    const docxBase64 = buffer.toString('base64');
    const filename = (subject + '-' + resourceType + '-Grade' + grade + '-Term' + term)
      .replace(/[^a-zA-Z0-9\-]/g, '-') + '.docx';

    log.info({ bytes: buffer.length, markTotal }, 'Rebuild DOCX: success');
    return res.status(200).json({ docxBase64, filename, markTotal });
  } catch (err) {
    log.error({ err: err?.message || err }, 'Rebuild DOCX error');
    return res.status(500).json({ error: 'Could not build the Word document from your edits. ' + (err?.message || '') });
  }
}
