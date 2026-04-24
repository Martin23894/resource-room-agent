// POST /api/billing/portal  → { url }  (redirect the browser to Stripe
// customer portal — self-serve plan change / cancel / invoice history /
// payment method update).
//
// 503 if billing not configured, 409 if the user has no Stripe customer
// record yet (i.e. they've never subscribed).

import { createPortalSession, isBillingEnabled } from '../lib/billing.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!req.user) return res.status(401).json({ error: 'Sign in required', code: 'UNAUTHENTICATED' });
  if (!isBillingEnabled()) {
    return res.status(503).json({ error: 'Billing is not configured on this deployment yet.' });
  }
  if (!req.user.stripe_customer_id) {
    return res.status(409).json({ error: 'No active subscription to manage yet.' });
  }

  try {
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const session = await createPortalSession({
      customerId: req.user.stripe_customer_id,
      returnUrl: `${base}/`,
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    req.log?.error?.({ err: err?.message }, 'Portal session failed');
    return res.status(500).json({ error: 'Could not open billing portal. Please try again.' });
  }
}
