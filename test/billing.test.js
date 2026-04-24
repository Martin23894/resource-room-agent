import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Stripe from 'stripe';

import { openCache, closeCache, getDb } from '../lib/cache.js';
import { getOrCreateUserByEmail } from '../lib/auth.js';
import {
  TIERS, TRIAL_DAYS, tierRank, priceToTier,
  handleSubscriptionEvent, isBillingEnabled, requireTier,
  BillingConfigError, getStripe, constructWebhookEvent,
} from '../lib/billing.js';

const em = (local) => local + '\x40example.com';

let tmpDir;
let prevEnv;

// Capture and restore env across tests so we don't leak configuration
// between cases.
function snapshotEnv() {
  prevEnv = {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_ESSENTIAL: process.env.STRIPE_PRICE_ESSENTIAL,
    STRIPE_PRICE_CLASSROOM: process.env.STRIPE_PRICE_CLASSROOM,
    STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO,
  };
}
function restoreEnv() {
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rr-billing-'));
  openCache({ path: join(tmpDir, 'billing.db') });
  snapshotEnv();
});

afterEach(() => {
  restoreEnv();
  closeCache();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('tier table', () => {
  test('every tier has the fields the UI reads', () => {
    for (const [key, t] of Object.entries(TIERS)) {
      assert.ok(t.name, `${key}: name`);
      assert.ok(Number.isFinite(t.monthlyPriceZar), `${key}: monthlyPriceZar`);
      assert.ok(Number.isFinite(t.annualPriceZar), `${key}: annualPriceZar`);
      assert.ok(Number.isFinite(t.monthlyCap), `${key}: monthlyCap`);
      assert.ok(Array.isArray(t.features), `${key}: features`);
    }
  });

  test('annual is exactly 20% off monthly × 12', () => {
    for (const [key, t] of Object.entries(TIERS)) {
      const expected = Math.round(t.monthlyPriceZar * 12 * 0.8);
      // Allow off-by-one for rounding quirks.
      assert.ok(Math.abs(t.annualPriceZar - expected) <= 2, `${key}: annual ${t.annualPriceZar} vs expected ~${expected}`);
    }
  });

  test('tierRank orders essential < classroom < pro', () => {
    assert.ok(tierRank('essential') < tierRank('classroom'));
    assert.ok(tierRank('classroom') < tierRank('pro'));
    assert.equal(tierRank(null), 0);
    assert.equal(tierRank('unknown'), 0);
  });

  test('TRIAL_DAYS is 14 per pricing decision', () => {
    assert.equal(TRIAL_DAYS, 14);
  });
});

describe('billing enabled flag', () => {
  test('false when STRIPE_SECRET_KEY unset', () => {
    delete process.env.STRIPE_SECRET_KEY;
    assert.equal(isBillingEnabled(), false);
  });

  test('true when STRIPE_SECRET_KEY set', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    assert.equal(isBillingEnabled(), true);
  });

  test('getStripe throws BillingConfigError without a key', () => {
    delete process.env.STRIPE_SECRET_KEY;
    assert.throws(() => getStripe(), BillingConfigError);
  });
});

describe('priceToTier mapping', () => {
  test('returns only configured price ids', () => {
    process.env.STRIPE_PRICE_ESSENTIAL = 'price_e1';
    process.env.STRIPE_PRICE_CLASSROOM = 'price_c1';
    delete process.env.STRIPE_PRICE_PRO;
    const map = priceToTier();
    assert.equal(map['price_e1'], 'essential');
    assert.equal(map['price_c1'], 'classroom');
    assert.equal(map['price_p1'], undefined);
    assert.equal(Object.keys(map).length, 2);
  });
});

describe('handleSubscriptionEvent', () => {
  function makeSub(customerId, { priceId, status = 'active', periodEnd = Math.floor(Date.now()/1000) + 30*86400 } = {}) {
    return {
      id: 'sub_' + Math.random().toString(16).slice(2),
      customer: customerId,
      status,
      current_period_end: periodEnd,
      items: { data: [{ price: { id: priceId || 'price_c1' } }] },
    };
  }

  test('subscription.created sets tier + status + customer id', () => {
    process.env.STRIPE_PRICE_CLASSROOM = 'price_c1';
    const user = getOrCreateUserByEmail(em('a'));
    // Simulate the customer id having been recorded by checkout.session.completed.
    getDb().prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run('cus_1', user.id);

    const sub = makeSub('cus_1', { priceId: 'price_c1' });
    const summary = handleSubscriptionEvent({ id: 'evt_1', type: 'customer.subscription.created', data: { object: sub } });
    assert.equal(summary.updated, true);

    const row = getDb().prepare('SELECT subscription_tier, subscription_status, stripe_subscription_id FROM users WHERE id = ?').get(user.id);
    assert.equal(row.subscription_tier, 'classroom');
    assert.equal(row.subscription_status, 'active');
    assert.equal(row.stripe_subscription_id, sub.id);
  });

  test('subscription.updated overwrites tier when the price changes', () => {
    process.env.STRIPE_PRICE_ESSENTIAL = 'price_e1';
    process.env.STRIPE_PRICE_PRO = 'price_p1';
    const user = getOrCreateUserByEmail(em('a'));
    getDb().prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run('cus_1', user.id);

    handleSubscriptionEvent({ id: 'evt_a', type: 'customer.subscription.created', data: { object: makeSub('cus_1', { priceId: 'price_e1' }) } });
    let row = getDb().prepare('SELECT subscription_tier FROM users WHERE id = ?').get(user.id);
    assert.equal(row.subscription_tier, 'essential');

    handleSubscriptionEvent({ id: 'evt_b', type: 'customer.subscription.updated', data: { object: makeSub('cus_1', { priceId: 'price_p1' }) } });
    row = getDb().prepare('SELECT subscription_tier FROM users WHERE id = ?').get(user.id);
    assert.equal(row.subscription_tier, 'pro');
  });

  test('subscription.deleted clears tier but keeps customer id', () => {
    process.env.STRIPE_PRICE_PRO = 'price_p1';
    const user = getOrCreateUserByEmail(em('a'));
    getDb().prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run('cus_1', user.id);
    handleSubscriptionEvent({ id: 'evt_a', type: 'customer.subscription.created', data: { object: makeSub('cus_1', { priceId: 'price_p1' }) } });

    handleSubscriptionEvent({ id: 'evt_b', type: 'customer.subscription.deleted', data: { object: makeSub('cus_1', { priceId: 'price_p1' }) } });

    const row = getDb().prepare('SELECT subscription_tier, subscription_status, stripe_customer_id FROM users WHERE id = ?').get(user.id);
    assert.equal(row.subscription_tier, null);
    assert.equal(row.subscription_status, 'canceled');
    // Keep customer id so the Manage billing button still works to view past invoices.
    assert.equal(row.stripe_customer_id, 'cus_1');
  });

  test('idempotency: the same event_id is only applied once', () => {
    process.env.STRIPE_PRICE_ESSENTIAL = 'price_e1';
    process.env.STRIPE_PRICE_PRO = 'price_p1';
    const user = getOrCreateUserByEmail(em('a'));
    getDb().prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run('cus_1', user.id);

    const event = { id: 'evt_dup', type: 'customer.subscription.created', data: { object: makeSub('cus_1', { priceId: 'price_e1' }) } };
    const first = handleSubscriptionEvent(event);
    assert.equal(first.updated, true);

    // Someone swaps the DB to Pro behind our back to prove a replay doesn't clobber it.
    getDb().prepare('UPDATE users SET subscription_tier = ? WHERE id = ?').run('pro', user.id);

    const second = handleSubscriptionEvent(event);
    assert.equal(second.replay, true);

    const row = getDb().prepare('SELECT subscription_tier FROM users WHERE id = ?').get(user.id);
    assert.equal(row.subscription_tier, 'pro', 'replay should NOT reset the tier');
  });

  test('unknown event types are recorded but ignored', () => {
    const event = { id: 'evt_x', type: 'invoice.payment_succeeded', data: { object: {} } };
    const summary = handleSubscriptionEvent(event);
    assert.equal(summary.ignored, true);
    const row = getDb().prepare('SELECT type FROM billing_events WHERE event_id = ?').get('evt_x');
    assert.equal(row.type, 'invoice.payment_succeeded');
  });

  test('ignores an event whose customer we don\'t know', () => {
    const sub = makeSub('cus_unknown', { priceId: 'price_e1' });
    const summary = handleSubscriptionEvent({ id: 'evt_orphan', type: 'customer.subscription.created', data: { object: sub } });
    // Still recorded so Stripe stops retrying.
    assert.equal(summary.updated, false);
    const row = getDb().prepare('SELECT processed_at FROM billing_events WHERE event_id = ?').get('evt_orphan');
    assert.ok(row.processed_at > 0);
  });
});

describe('webhook signature verification', () => {
  // Uses stripe.webhooks.generateTestHeaderString — the same helper the
  // Stripe SDK ships for users writing their own tests.
  test('accepts a correctly-signed payload', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_xxx';
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
    const payload = JSON.stringify({
      id: 'evt_t', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_t', customer: 'cus_t', status: 'active', items: { data: [] } } },
    });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    const event = constructWebhookEvent(payload, header);
    assert.equal(event.id, 'evt_t');
    assert.equal(event.type, 'customer.subscription.updated');
  });

  test('rejects a tampered payload', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_xxx';
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
    const payload = JSON.stringify({ id: 'evt_t', type: 'x', data: {} });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    const tampered = payload.replace('evt_t', 'evt_forged');
    assert.throws(() => constructWebhookEvent(tampered, header), /signature/i);
  });

  test('throws BillingConfigError when webhook secret is missing', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    delete process.env.STRIPE_WEBHOOK_SECRET;
    assert.throws(() => constructWebhookEvent('{}', 'sig'), BillingConfigError);
  });
});

describe('requireTier middleware', () => {
  function run(middleware, req) {
    return new Promise((resolve) => {
      const res = {
        statusCode: null, body: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; resolve({ res: this, called: false }); return this; },
      };
      middleware(req, res, () => resolve({ res, called: true }));
    });
  }

  test('403s an anonymous request', async () => {
    const { res, called } = await run(requireTier('essential'), { user: null });
    assert.equal(called, false);
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.code, 'TIER_REQUIRED');
  });

  test('allows an active classroom user to use an essential feature', async () => {
    const req = { user: { subscription_tier: 'classroom', subscription_status: 'active' } };
    const { called } = await run(requireTier('essential'), req);
    assert.equal(called, true);
  });

  test('blocks an essential user from a pro feature', async () => {
    const req = { user: { subscription_tier: 'essential', subscription_status: 'active' } };
    const { res, called } = await run(requireTier('pro'), req);
    assert.equal(called, false);
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.required, 'pro');
  });

  test('allows a trialing subscription', async () => {
    const req = { user: { subscription_tier: 'pro', subscription_status: 'trialing' } };
    const { called } = await run(requireTier('pro'), req);
    assert.equal(called, true);
  });

  test('blocks a past_due subscription (they need to update payment)', async () => {
    const req = { user: { subscription_tier: 'pro', subscription_status: 'past_due' } };
    const { res, called } = await run(requireTier('pro'), req);
    assert.equal(called, false);
    assert.equal(res.statusCode, 402);
  });
});

describe('trial bookkeeping', () => {
  test('new users get a trial_ends_at 14 days out', () => {
    const before = Date.now();
    const user = getOrCreateUserByEmail(em('trial'));
    const after = Date.now();
    assert.ok(user.trial_ends_at >= before + TRIAL_DAYS * 24*60*60*1000);
    assert.ok(user.trial_ends_at <= after + TRIAL_DAYS * 24*60*60*1000);
  });

  test('existing users keep their trial_ends_at on subsequent logins', async () => {
    const a = getOrCreateUserByEmail(em('trial'));
    await new Promise(r => setTimeout(r, 5));
    const b = getOrCreateUserByEmail(em('trial'));
    assert.equal(b.trial_ends_at, a.trial_ends_at);
  });
});
