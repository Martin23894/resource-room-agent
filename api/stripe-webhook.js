// POST /api/stripe/webhook  — Stripe-facing, NOT browser-facing.
//
// Receives raw body + stripe-signature header; verifies the HMAC against
// STRIPE_WEBHOOK_SECRET; hands the parsed event to handleSubscriptionEvent.
//
// IMPORTANT: this route must be mounted with express.raw(), NOT
// express.json() — signature verification requires the exact bytes Stripe
// sent. See server.js for the wiring.

import {
  constructWebhookEvent, handleSubscriptionEvent, isBillingEnabled,
} from '../lib/billing.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isBillingEnabled()) {
    // Return 200 so Stripe doesn't retry forever, but log loud so a
    // misconfigured deploy is obvious.
    req.log?.warn?.('Received Stripe webhook but STRIPE_SECRET_KEY is unset');
    return res.status(200).json({ received: true, ignored: true });
  }

  const signature = req.headers['stripe-signature'];
  if (!signature) return res.status(400).json({ error: 'Missing stripe-signature header' });

  let event;
  try {
    // req.body is a Buffer because of express.raw() on this route.
    event = constructWebhookEvent(req.body, signature);
  } catch (err) {
    req.log?.warn?.({ err: err?.message }, 'Stripe webhook signature verification failed');
    return res.status(400).json({ error: `Invalid signature: ${err?.message}` });
  }

  try {
    const summary = handleSubscriptionEvent(event, { logger: req.log });
    return res.status(200).json({ received: true, ...summary });
  } catch (err) {
    req.log?.error?.({ err: err?.message, eventType: event.type }, 'Webhook handler threw');
    // 500 tells Stripe to retry — which we want for transient DB hiccups.
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
}
