// GET /api/auth/me — return the current user or 401.
// The frontend calls this on every page load to decide whether to show
// the login modal or the main UI, and to render the subscription tier
// badge + upgrade/manage-billing buttons.

import { TIERS, isBillingEnabled } from '../lib/billing.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });

  const now = Date.now();
  const tier = req.user.subscription_tier || null;
  const status = req.user.subscription_status || null;
  const trialEndsAt = req.user.trial_ends_at || null;
  const trialActive = trialEndsAt != null && trialEndsAt > now && !tier;

  // Profile fields are stored as JSON-serialised arrays in SQLite — parse
  // them out for the client. Bad data (corrupted JSON) is treated as null
  // rather than 500ing the whole /me call.
  const safeJson = (s) => {
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  };
  const profile = {
    displayName: req.user.display_name || null,
    school: req.user.school || null,
    role: req.user.role || null,
    gradesTaught: safeJson(req.user.grades_taught) || [],
    subjectsTaught: safeJson(req.user.subjects_taught) || [],
    province: req.user.province || null,
    completedAt: req.user.profile_completed_at || null,
    complete: !!req.user.profile_completed_at,
  };

  return res.status(200).json({
    user: {
      id: req.user.id,
      email: req.user.email,
      created_at: req.user.created_at,
      emailVerified: !!req.user.email_verified_at,
      emailVerifiedAt: req.user.email_verified_at || null,
      hasPassword: !!req.user.password_hash,
      profile,
      subscription: {
        tier,                       // null | 'essential' | 'classroom' | 'pro'
        status,                     // null | 'trialing' | 'active' | 'past_due' | 'canceled'
        currentPeriodEnd: req.user.current_period_end || null,
        trialEndsAt,
        trialActive,
        hasStripeCustomer: !!req.user.stripe_customer_id,
      },
    },
    billing: {
      enabled: isBillingEnabled(),
      tiers: TIERS, // so the frontend can render prices + caps without hard-coding
    },
  });
}
