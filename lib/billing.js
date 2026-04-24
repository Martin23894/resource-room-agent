// Subscription billing: Stripe wrapper + tier definitions + webhook handling.
//
// Kept intentionally inert when STRIPE_SECRET_KEY is unset — the endpoints
// return 503 "Billing not configured" and the frontend falls back to
// "Upgrade coming soon". That lets us deploy the skeleton on Railway before
// Stripe is fully provisioned without breaking anything.
//
// PHASE 2.4c IS SKELETON-ONLY: we track tier + status on the user row and
// expose them to the frontend, but we DO NOT enforce caps or tier gates
// yet. That's Phase 2.4d — it needs a usage counter first.

import Stripe from 'stripe';

import { getDb } from './cache.js';
import { logger as defaultLogger } from './logger.js';

// ─────────────────────────────────────────────────────────────
// Business rules: tiers, prices, caps
// ─────────────────────────────────────────────────────────────
// These live in code, not env, so they're version-controlled and easy to
// audit. The Stripe PRICE IDs (which differ between test / live modes)
// live in env vars.
export const TIERS = {
  essential: {
    name: 'Essential',
    monthlyPriceZar: 179,
    annualPriceZar: 1719, // 20% discount
    monthlyCap: 15,
    pptCap: 0,
    features: ['core'],
    description: 'Worksheets, tests and exams for one teacher',
  },
  classroom: {
    name: 'Classroom',
    monthlyPriceZar: 349,
    annualPriceZar: 3349,
    monthlyCap: 40,
    pptCap: 5,
    features: ['core', 'refine', 'edit', 'cover', 'ppt'],
    description: 'Everything in Essential plus PowerPoint lessons and priority features',
  },
  pro: {
    name: 'Pro',
    monthlyPriceZar: 599,
    annualPriceZar: 5749,
    monthlyCap: 80,  // presented as "fair use" — hard ceiling at 80
    pptCap: null,    // null = within monthlyCap, no separate PPT sub-cap
    features: ['core', 'refine', 'edit', 'cover', 'ppt', 'priority'],
    description: 'Heavy-use tier for HODs and subject heads — fair use within 80/month',
  },
};

// 14-day trial; 5-generation cap. Consumed in 2.4d.
export const TRIAL_DAYS = 14;
export const TRIAL_GENERATION_CAP = 5;

export function tierRank(tier) {
  return { essential: 1, classroom: 2, pro: 3 }[tier] || 0;
}

/** Map a Stripe price id → our tier name. Undefined env vars are filtered out. */
export function priceToTier() {
  const out = {};
  const add = (envName, tier) => {
    const id = process.env[envName];
    if (id) out[id] = tier;
  };
  add('STRIPE_PRICE_ESSENTIAL', 'essential');
  add('STRIPE_PRICE_ESSENTIAL_ANNUAL', 'essential');
  add('STRIPE_PRICE_CLASSROOM', 'classroom');
  add('STRIPE_PRICE_CLASSROOM_ANNUAL', 'classroom');
  add('STRIPE_PRICE_PRO', 'pro');
  add('STRIPE_PRICE_PRO_ANNUAL', 'pro');
  return out;
}

// ─────────────────────────────────────────────────────────────
// Stripe client — lazy-init, throws when not configured
// ─────────────────────────────────────────────────────────────

export class BillingConfigError extends Error {
  constructor(message = 'Billing not configured') {
    super(message);
    this.name = 'BillingConfigError';
    this.status = 503;
  }
}

let stripeClient = null;

export function getStripe() {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new BillingConfigError();
  stripeClient = new Stripe(key, {
    apiVersion: '2024-06-20',
    // Standard Node user-agent helps Stripe correlate reports back to us.
    appInfo: { name: 'resource-room-agent', url: 'https://resourceroom.co.za' },
  });
  return stripeClient;
}

/** True when enough env is present for the billing endpoints to actually work. */
export function isBillingEnabled() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

// ─────────────────────────────────────────────────────────────
// Checkout + portal sessions
// ─────────────────────────────────────────────────────────────

export async function createCheckoutSession({
  user, priceId, successUrl, cancelUrl, trialDays = TRIAL_DAYS,
}) {
  if (!user) throw new Error('user required');
  if (!priceId) throw new BillingConfigError('STRIPE_PRICE_* env var missing for the requested tier');
  const stripe = getStripe();

  const params = {
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: user.id,
    customer_email: user.stripe_customer_id ? undefined : user.email,
    customer: user.stripe_customer_id || undefined,
    metadata: { user_id: user.id, tier_requested: (priceToTier())[priceId] || 'unknown' },
    subscription_data: trialDays > 0 ? { trial_period_days: trialDays } : undefined,
    allow_promotion_codes: true,
  };

  return stripe.checkout.sessions.create(params);
}

export async function createPortalSession({ customerId, returnUrl }) {
  if (!customerId) throw new Error('No Stripe customer for this user');
  const stripe = getStripe();
  return stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
}

// ─────────────────────────────────────────────────────────────
// Webhook verification + event handling
// ─────────────────────────────────────────────────────────────

export function constructWebhookEvent(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new BillingConfigError('STRIPE_WEBHOOK_SECRET not set');
  const stripe = getStripe();
  // constructEvent throws StripeSignatureVerificationError for invalid sigs.
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

/**
 * Apply a Stripe event to the users table. Idempotent: every event_id is
 * recorded in billing_events so a replay is a no-op. Returns a small
 * summary object for the caller to log.
 */
export function handleSubscriptionEvent(event, { logger = defaultLogger } = {}) {
  const db = getDb();
  const now = Date.now();

  // Idempotency — short-circuit if we've already processed this event.
  const existing = db.prepare('SELECT event_id, processed_at FROM billing_events WHERE event_id = ?').get(event.id);
  if (existing?.processed_at) {
    return { eventId: event.id, type: event.type, replay: true };
  }

  const priceMap = priceToTier();

  let userId = null;
  let updates = null;

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      userId = session.client_reference_id || session.metadata?.user_id || null;
      if (userId) {
        updates = {
          stripe_customer_id: session.customer || null,
          stripe_subscription_id: session.subscription || null,
          subscription_status: 'active',
        };
        // Look up the subscription to derive tier (checkout session doesn't include line items expanded).
        if (session.subscription) {
          try {
            const sub = getStripe().subscriptions.retrieve(session.subscription);
            // NOTE: sub is a Promise — we kick off but don't await here because
            // the real subscription.updated event will arrive within seconds and
            // will set the tier authoritatively. For the idempotency row we
            // just mark the session as processed.
            sub.catch(() => {});
          } catch { /* tolerate */ }
        }
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      userId = findUserIdByCustomerId(sub.customer);
      const priceId = sub.items?.data?.[0]?.price?.id || null;
      const tier = priceId ? priceMap[priceId] : null;
      if (userId) {
        updates = {
          stripe_customer_id: sub.customer,
          stripe_subscription_id: sub.id,
          subscription_status: sub.status, // active | trialing | past_due | unpaid | canceled | incomplete
          subscription_tier: tier || null,
          current_period_end: sub.current_period_end ? sub.current_period_end * 1000 : null,
        };
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      userId = findUserIdByCustomerId(sub.customer);
      if (userId) {
        updates = {
          subscription_status: 'canceled',
          subscription_tier: null,
          stripe_subscription_id: null,
          current_period_end: sub.current_period_end ? sub.current_period_end * 1000 : null,
        };
      }
      break;
    }

    default:
      // Unhandled event types are still recorded so Stripe stops retrying.
      db.prepare(
        `INSERT INTO billing_events (event_id, type, user_id, received_at, processed_at)
         VALUES (?, ?, NULL, ?, ?)`,
      ).run(event.id, event.type, now, now);
      return { eventId: event.id, type: event.type, ignored: true };
  }

  if (updates && userId) {
    applyUserBillingUpdate(userId, updates);
  }

  db.prepare(
    `INSERT INTO billing_events (event_id, type, user_id, received_at, processed_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET processed_at = excluded.processed_at`,
  ).run(event.id, event.type, userId, now, now);

  logger?.info?.({ eventId: event.id, type: event.type, userId, updates: !!updates }, 'Billing event handled');
  return { eventId: event.id, type: event.type, userId, updated: !!updates };
}

function findUserIdByCustomerId(customerId) {
  if (!customerId) return null;
  const row = getDb()
    .prepare('SELECT id FROM users WHERE stripe_customer_id = ?')
    .get(customerId);
  return row?.id || null;
}

function applyUserBillingUpdate(userId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => fields[k]);
  getDb().prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...values, userId);
}

// ─────────────────────────────────────────────────────────────
// Middleware: requireTier (NOT wired yet in 2.4c — available for 2.4d)
// ─────────────────────────────────────────────────────────────

export function requireTier(minTier) {
  const needed = tierRank(minTier);
  return (req, res, next) => {
    const currentTier = req.user?.subscription_tier || null;
    const status = req.user?.subscription_status || null;
    // Active or trialing users get the benefit of their tier.
    if ((status === 'active' || status === 'trialing') && tierRank(currentTier) >= needed) {
      return next();
    }
    return res.status(402).json({
      error: `This feature requires the ${minTier} plan or above.`,
      code: 'TIER_REQUIRED',
      required: minTier,
      current: currentTier,
    });
  };
}
