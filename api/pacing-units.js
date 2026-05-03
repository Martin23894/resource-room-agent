// Slim Unit list for the Lesson-generator Unit picker.
//
// GET /api/pacing-units?subject=...&grade=...&term=...
//
// Returns [{ id, topic, capsStrand, subStrand, weeks, hours, durationLabel,
// isRevision }]. Empty array when no pacing data exists for that slot —
// the frontend treats that as "Lesson type unavailable for this subject".

import { getPacingUnitsSlim } from '../lib/atp.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const subject = String(req.query?.subject || '').trim();
  const grade = parseInt(req.query?.grade, 10);
  const term = parseInt(req.query?.term, 10);

  if (!subject || !Number.isInteger(grade) || !Number.isInteger(term)) {
    return res.status(400).json({ error: 'subject, grade and term are required' });
  }
  if (grade < 4 || grade > 7 || term < 1 || term > 4) {
    return res.status(400).json({ error: 'grade must be 4-7 and term must be 1-4' });
  }

  const units = getPacingUnitsSlim(subject, grade, term);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(200).json({ units });
}
