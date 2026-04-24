import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openCache, closeCache } from '../lib/cache.js';
import { getOrCreateUserByEmail } from '../lib/auth.js';
import authMeHandler from '../api/auth-me.js';
import billingPortalHandler from '../api/billing-portal.js';
import billingCheckoutHandler from '../api/billing-checkout.js';
import stripeWebhookHandler from '../api/stripe-webhook.js';

const em = (local) => local + '\x40example.com';

function makeReq({ method = 'POST', body = null, user = null, headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.body = body;
  req.user = user;
  req.headers = headers;
  req.query = {};
  req.params = {};
  req.protocol = 'http';
  req.get = () => 'localhost:3000';
  req.log = { info: () => {}, warn: () => {}, error: () => {} };
  return req;
}

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = null;
  res.jsonBody = null;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.jsonBody = b; return res; };
  res.end = () => res;
  return res;
}

let tmpDir;
let user;
let prevEnv;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rr-bill-ep-'));
  openCache({ path: join(tmpDir, 'be.db') });
  user = getOrCreateUserByEmail(em('teacher'));
  prevEnv = { ...process.env };
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in prevEnv)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(prevEnv)) process.env[k] = v;
  closeCache();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('/api/auth/me with billing', () => {
  test('unauth returns 401', async () => {
    const req = makeReq({ method: 'GET', user: null });
    const res = makeRes();
    await authMeHandler(req, res);
    assert.equal(res.statusCode, 401);
  });

  test('returns user + subscription block + tiers config', async () => {
    const req = makeReq({ method: 'GET', user });
    const res = makeRes();
    await authMeHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.user.email, em('teacher'));
    assert.equal(res.jsonBody.user.subscription.tier, null);
    assert.equal(res.jsonBody.user.subscription.trialActive, true);
    assert.ok(res.jsonBody.billing.tiers.essential);
    assert.ok(res.jsonBody.billing.tiers.classroom);
    assert.ok(res.jsonBody.billing.tiers.pro);
  });

  test('billing.enabled reflects STRIPE_SECRET_KEY', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res1 = makeRes();
    await authMeHandler(makeReq({ method: 'GET', user }), res1);
    assert.equal(res1.jsonBody.billing.enabled, false);

    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    const res2 = makeRes();
    await authMeHandler(makeReq({ method: 'GET', user }), res2);
    assert.equal(res2.jsonBody.billing.enabled, true);
  });
});

describe('/api/billing/checkout', () => {
  test('401 when not signed in', async () => {
    const req = makeReq({ body: { tier: 'essential' } });
    const res = makeRes();
    await billingCheckoutHandler(req, res);
    assert.equal(res.statusCode, 401);
  });

  test('503 when Stripe not configured', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const req = makeReq({ body: { tier: 'essential' }, user });
    const res = makeRes();
    await billingCheckoutHandler(req, res);
    assert.equal(res.statusCode, 503);
  });

  test('400 when tier is missing or invalid', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    const req = makeReq({ body: { tier: 'nonsense' }, user });
    const res = makeRes();
    await billingCheckoutHandler(req, res);
    assert.equal(res.statusCode, 400);
  });

  test('503 when the tier price id env var is missing', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    delete process.env.STRIPE_PRICE_ESSENTIAL;
    const req = makeReq({ body: { tier: 'essential', billing: 'monthly' }, user });
    const res = makeRes();
    await billingCheckoutHandler(req, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.jsonBody.error, /STRIPE_PRICE_ESSENTIAL/);
  });

  test('405 on GET', async () => {
    const req = makeReq({ method: 'GET', user });
    const res = makeRes();
    await billingCheckoutHandler(req, res);
    assert.equal(res.statusCode, 405);
  });
});

describe('/api/billing/portal', () => {
  test('401 when not signed in', async () => {
    const req = makeReq();
    const res = makeRes();
    await billingPortalHandler(req, res);
    assert.equal(res.statusCode, 401);
  });

  test('503 when Stripe not configured', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const req = makeReq({ user });
    const res = makeRes();
    await billingPortalHandler(req, res);
    assert.equal(res.statusCode, 503);
  });

  test('409 when user has no Stripe customer yet', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    const req = makeReq({ user });
    const res = makeRes();
    await billingPortalHandler(req, res);
    assert.equal(res.statusCode, 409);
  });
});

describe('/api/stripe/webhook', () => {
  test('405 on GET', async () => {
    const req = makeReq({ method: 'GET' });
    const res = makeRes();
    await stripeWebhookHandler(req, res);
    assert.equal(res.statusCode, 405);
  });

  test('200 + ignored when STRIPE_SECRET_KEY unset (keeps Stripe from retrying)', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const req = makeReq({ body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig' } });
    const res = makeRes();
    await stripeWebhookHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.ignored, true);
  });

  test('400 when the signature header is missing', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    const req = makeReq({ body: Buffer.from('{}') });
    const res = makeRes();
    await stripeWebhookHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.jsonBody.error, /signature/i);
  });

  test('400 when the signature fails verification', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    const req = makeReq({ body: Buffer.from('{}'), headers: { 'stripe-signature': 'bogus' } });
    const res = makeRes();
    await stripeWebhookHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.jsonBody.error, /signature/i);
  });
});
