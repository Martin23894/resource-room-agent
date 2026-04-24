// POST /api/billing/checkout  { tier: 'essential'|'classroom'|'pro', billing?: 'monthly'|'annual' }
//   → { url }  (redirect the browser there)
//
// Returns 503 if billing is not configured on this deployment.

import {
  createCheckoutSession, isBillingEnabled, TIERS, TRIAL_DAYS,
} from '../lib/billing.js';
import { oneOf, ValidationError } from '../lib/validate.js';

const PRICE_ENV = {
  essential: { monthly: 'STRIPE_PRICE_ESSENTIAL', annual: 'STRIPE_PRICE_ESSENTIAL_ANNUAL' },
  classroom: { monthly: 'STRIPE_PRICE_CLASSROOM', annual: 'STRIPE_PRICE_CLASSROOM_ANNUAL' },
  pro:       { monthly: 'STRIPE_PRICE_PRO',       annual: 'STRIPE_PRICE_PRO_ANNUAL' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!req.user) return res.status(401).json({ error: 'Sign in required', code: 'UNAUTHENTICATED' });
  if (!isBillingEnabled()) {
    return res.status(503).json({ error: 'Billing is not configured on this deployment yet.' });
  }

  try {
    const tier = oneOf(req.body?.tier, Object.keys(TIERS), { field: 'tier' });
    const billing = oneOf(req.body?.billing || 'monthly', ['monthly', 'annual'], { field: 'billing' });
    const priceEnv = PRICE_ENV[tier][billing];
    const priceId = process.env[priceEnv];
    if (!priceId) {
      return res.status(503).json({ error: `${priceEnv} not set — ask the admin to configure this tier.` });
    }

    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const session = await createCheckoutSession({
      user: req.user,
      priceId,
      successUrl: `${base}/?checkout=success`,
      cancelUrl: `${base}/?checkout=cancelled`,
      trialDays: req.user.stripe_customer_id ? 0 : TRIAL_DAYS, // no trial on repeat checkouts
    });

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err?.status === 503) return res.status(503).json({ error: err.message });
    req.log?.error?.({ err: err?.message }, 'Checkout session failed');
    return res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
}
