// GET /api/user/profile  → { profile }
// PUT /api/user/profile  { displayName, school, role, gradesTaught[], subjectsTaught[], province }
//   → { profile }
//
// Auth-gated in server.js. Stores the teacher's profile (name, school, role,
// what they teach) on the users row. The first successful PUT also sets
// profile_completed_at, which the frontend reads from /api/auth/me to decide
// whether to show the onboarding modal.

import { getDb } from '../lib/cache.js';

const MAX_TEXT = 200;
const VALID_GRADES = new Set([4, 5, 6, 7]);
const VALID_PROVINCES = new Set([
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
  'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape',
]);

function clean(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.slice(0, MAX_TEXT);
}

function cleanGrades(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  for (const g of arr) {
    const n = Number(g);
    if (VALID_GRADES.has(n)) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

function cleanSubjects(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const s of arr) {
    const t = clean(s);
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    if (out.length >= 20) break;
  }
  return out;
}

function readProfile(userId) {
  const db = getDb();
  const row = db.prepare(
    `SELECT display_name, school, role, grades_taught, subjects_taught,
            province, profile_completed_at
     FROM users WHERE id = ?`,
  ).get(userId);
  if (!row) return null;
  const safeJson = (s) => {
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  };
  return {
    displayName: row.display_name || null,
    school: row.school || null,
    role: row.role || null,
    gradesTaught: safeJson(row.grades_taught) || [],
    subjectsTaught: safeJson(row.subjects_taught) || [],
    province: row.province || null,
    completedAt: row.profile_completed_at || null,
    complete: !!row.profile_completed_at,
  };
}

export default function handler(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: 'Sign in required', code: 'UNAUTHENTICATED' });
  }

  if (req.method === 'GET') {
    const profile = readProfile(req.user.id);
    return res.status(200).json({ profile });
  }

  if (req.method === 'PUT') {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Body must be a JSON object' });
    }

    const displayName = clean(body.displayName);
    if (!displayName) {
      return res.status(400).json({ error: 'displayName is required' });
    }

    const school = clean(body.school);
    const role = clean(body.role);
    const province = clean(body.province);
    if (province && !VALID_PROVINCES.has(province)) {
      return res.status(400).json({ error: 'Invalid province' });
    }

    const gradesTaught = cleanGrades(body.gradesTaught);
    const subjectsTaught = cleanSubjects(body.subjectsTaught);

    const db = getDb();
    const now = Date.now();
    // Only set profile_completed_at on the first successful save — once a
    // teacher has been onboarded we don't want to keep flipping the flag.
    db.prepare(
      `UPDATE users
       SET display_name = ?, school = ?, role = ?,
           grades_taught = ?, subjects_taught = ?, province = ?,
           profile_completed_at = COALESCE(profile_completed_at, ?)
       WHERE id = ?`,
    ).run(
      displayName,
      school,
      role,
      JSON.stringify(gradesTaught),
      JSON.stringify(subjectsTaught),
      province,
      now,
      req.user.id,
    );

    return res.status(200).json({ profile: readProfile(req.user.id) });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
