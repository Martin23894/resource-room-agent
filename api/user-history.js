// /api/user/history and /api/user/history/:id
//
//   GET    /api/user/history        → { history: [...newest first] }
//   POST   /api/user/history         { entry }  → { entry }  (inserted row)
//   DELETE /api/user/history          → { cleared: N }
//   DELETE /api/user/history/:id      → 204
//
// Requires auth (gated in server.js). Each entry is small metadata only —
// no DOCX bytes; the server never stores the generated binary.

import {
  listUserHistory,
  addUserHistory,
  deleteUserHistoryEntry,
  clearUserHistory,
} from '../lib/user-state.js';
import { str, int, ValidationError } from '../lib/validate.js';

const ALLOWED_LANG = ['English', 'Afrikaans'];
const ALLOWED_DIFF = ['below', 'on', 'above'];

export default function handler(req, res) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required', code: 'UNAUTHENTICATED' });

  // DELETE /api/user/history/:id — :id is surfaced via req.params.id when
  // the server.js route uses an :id placeholder. If no id is present we
  // fall through to "clear all".
  const id = req.params?.id || null;

  if (req.method === 'GET') {
    const limit = Number(req.query?.limit) || 20;
    const history = listUserHistory(req.user.id, { limit });
    return res.status(200).json({ history });
  }

  if (req.method === 'POST') {
    try {
      const entry = validateEntry(req.body?.entry || req.body);
      const saved = addUserHistory(req.user.id, entry);
      return res.status(201).json({ entry: saved });
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  }

  if (req.method === 'DELETE') {
    if (id) {
      const removed = deleteUserHistoryEntry(req.user.id, id);
      if (!removed) return res.status(404).json({ error: 'Entry not found' });
      return res.status(204).end();
    }
    const cleared = clearUserHistory(req.user.id);
    return res.status(200).json({ cleared });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

function validateEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('entry must be an object');
  }
  return {
    subj: str(raw.subj, { field: 'subj', max: 200 }),
    topic: str(raw.topic, { field: 'topic', required: false, max: 500 }),
    rtype: str(raw.rtype, { field: 'rtype', max: 80 }),
    lang: raw.lang ? str(raw.lang, { field: 'lang', max: 40 }) : 'English',
    diff: raw.diff ? str(raw.diff, { field: 'diff', max: 40 }) : 'on',
    grade: int(raw.grade, { field: 'grade', min: 1, max: 12 }),
    term: int(raw.term, { field: 'term', min: 1, max: 4 }),
    previewSnippet: str(raw.previewSnippet, {
      field: 'previewSnippet',
      required: false,
      max: 2000,
    }),
    ts: raw.ts ? Number(raw.ts) : undefined,
  };
}
