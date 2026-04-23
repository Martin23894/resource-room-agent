// GET /api/user/settings  → { settings, updatedAt } or { settings: null }
// PUT /api/user/settings  { settings }  → { settings, updatedAt }
//
// Requires auth (gated in server.js). Stores the sidebar configuration for
// the signed-in teacher so it follows them across devices.

import { getUserSettings, setUserSettings } from '../lib/user-state.js';

const MAX_SETTINGS_BYTES = 8 * 1024; // 8 KiB is plenty for our small object

export default function handler(req, res) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required', code: 'UNAUTHENTICATED' });

  if (req.method === 'GET') {
    const stored = getUserSettings(req.user.id);
    return res.status(200).json(stored || { settings: null, updatedAt: null });
  }

  if (req.method === 'PUT') {
    const payload = req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: 'Body must be a JSON object' });
    }
    const settings = payload.settings;
    if (settings === undefined || settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
      return res.status(400).json({ error: 'settings must be an object' });
    }
    const serialised = JSON.stringify(settings);
    if (serialised.length > MAX_SETTINGS_BYTES) {
      return res.status(413).json({ error: 'settings too large' });
    }
    const saved = setUserSettings(req.user.id, settings);
    return res.status(200).json(saved);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
