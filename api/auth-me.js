// GET /api/auth/me — return the current user or 401.
// The frontend calls this on every page load to decide whether to show
// the login modal or the main UI.

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  return res.status(200).json({
    user: {
      id: req.user.id,
      email: req.user.email,
      created_at: req.user.created_at,
    },
  });
}
