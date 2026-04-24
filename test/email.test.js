import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { sendEmail, looksLikeEmail, resetResendClient } from '../lib/email.js';

// Build email literals at runtime so the sandbox's email-obfuscation pass
// (which rewrites word@word.tld into "[email  protected]") doesn't mangle
// the test fixtures. Every source-level email in this file must go through
// this helper or use \x40 for the @.
const em = (local, domain = 'example.com') => local + '\x40' + domain;

let originalProvider;

beforeEach(() => {
  originalProvider = process.env.EMAIL_PROVIDER;
  resetResendClient();
});

afterEach(() => {
  if (originalProvider === undefined) delete process.env.EMAIL_PROVIDER;
  else process.env.EMAIL_PROVIDER = originalProvider;
  resetResendClient();
});

describe('looksLikeEmail', () => {
  test('accepts plausibly-valid addresses', () => {
    assert.equal(looksLikeEmail(em('a', 'b.co')), true);
    assert.equal(looksLikeEmail(em('user.name+tag', 'example.com')), true);
    assert.equal(looksLikeEmail(em('a.b', 'example.co.uk')), true);
  });
  test('rejects obvious junk', () => {
    assert.equal(looksLikeEmail(''), false);
    assert.equal(looksLikeEmail('nope'), false);
    assert.equal(looksLikeEmail(em('a', 'b')), false);
    assert.equal(looksLikeEmail('\x40foo.com'), false);
    assert.equal(looksLikeEmail('foo\x40'), false);
    assert.equal(looksLikeEmail(null), false);
    assert.equal(looksLikeEmail(123), false);
  });
});

describe('sendEmail — console driver (default)', () => {
  test('logs the message and returns an id without throwing', async () => {
    process.env.EMAIL_PROVIDER = 'console';
    const captured = [];
    const logger = { info: (a, b) => captured.push({ a, b }), warn: () => {}, error: () => {} };

    const result = await sendEmail({
      to: em('teacher'), subject: 'Hello', text: 'body text', logger,
    });

    assert.ok(result.id.startsWith('console-'));
    assert.equal(captured.length, 1);
    assert.equal(captured[0].a.to, em('teacher'));
    assert.equal(captured[0].a.subject, 'Hello');
    assert.match(captured[0].a.body, /body text/);
  });
});

describe('sendEmail — disabled driver', () => {
  test('is a no-op but logs a warning', async () => {
    process.env.EMAIL_PROVIDER = 'disabled';
    const warnings = [];
    const logger = { info: () => {}, warn: (a, b) => warnings.push({ a, b }), error: () => {} };

    const result = await sendEmail({
      to: em('teacher'), subject: 'Hi', text: 'x', logger,
    });

    assert.ok(result.id.startsWith('disabled-'));
    assert.equal(warnings.length, 1);
  });
});

describe('sendEmail — validation', () => {
  test('throws when fields are missing', async () => {
    await assert.rejects(sendEmail({}), /requires \{ to, subject, text\|html \}/);
    await assert.rejects(sendEmail({ to: em('teacher') }), /requires/);
    await assert.rejects(sendEmail({ to: em('teacher'), subject: 'x' }), /requires/);
  });
  test('throws on unknown provider', async () => {
    process.env.EMAIL_PROVIDER = 'pigeon';
    await assert.rejects(
      sendEmail({ to: em('teacher'), subject: 's', text: 't' }),
      /Unknown EMAIL_PROVIDER/,
    );
  });
});

describe('sendEmail — resend driver payload shape', () => {
  // Resend SDK v4 drops any per-send field outside its allowlist. Tracking
  // is domain-level only (set in the dashboard). This test verifies we send
  // the transactional tag the backend uses for categorisation.
  let prevKey;

  beforeEach(() => {
    prevKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 're_test_fake';
    process.env.EMAIL_PROVIDER = 'resend';
    resetResendClient();
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
    resetResendClient();
  });

  test('tags transactional sends and targets the Resend API', async () => {
    const captured = [];
    const origFetch = global.fetch;
    global.fetch = async (url, opts) => {
      captured.push({ url: String(url), body: JSON.parse(opts.body) });
      return new Response(JSON.stringify({ id: 'email_mock_1' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };

    try {
      await sendEmail({ to: em('teacher'), subject: 'Sign in', text: 'link' });
    } finally {
      global.fetch = origFetch;
    }

    assert.equal(captured.length, 1, 'resend should have received exactly one call');
    const body = captured[0].body;
    assert.match(captured[0].url, /api\.resend\.com/);
    assert.ok(Array.isArray(body.tags) && body.tags.length >= 1, 'tags must be included');
    assert.equal(body.tags[0].name, 'category');
    assert.equal(body.tags[0].value, 'transactional');
    // SDK silently drops unknown fields on /emails, so these MUST NOT leak
    // onto the wire — prevents anyone adding them thinking they work.
    assert.equal(body.click_tracking, undefined);
    assert.equal(body.open_tracking, undefined);
  });
});
