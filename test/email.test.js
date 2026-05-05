import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  sendEmail, looksLikeEmail, resetResendClient,
  resolveFrom, isUsingSandbox, checkEmailConfig, __resetSandboxWarning,
} from '../lib/email.js';

// Build email literals at runtime so the sandbox's email-obfuscation pass
// (which rewrites word@word.tld into "[email  protected]") doesn't mangle
// the test fixtures. Every source-level email in this file must go through
// this helper or use \x40 for the @.
const em = (local, domain = 'example.com') => local + '\x40' + domain;

let originalProvider;
let originalFrom;
let originalReplyTo;
let originalKey;

beforeEach(() => {
  originalProvider = process.env.EMAIL_PROVIDER;
  originalFrom = process.env.EMAIL_FROM;
  originalReplyTo = process.env.EMAIL_REPLY_TO;
  originalKey = process.env.RESEND_API_KEY;
  resetResendClient();
  __resetSandboxWarning();
});

afterEach(() => {
  if (originalProvider === undefined) delete process.env.EMAIL_PROVIDER;
  else process.env.EMAIL_PROVIDER = originalProvider;
  if (originalFrom === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = originalFrom;
  if (originalReplyTo === undefined) delete process.env.EMAIL_REPLY_TO;
  else process.env.EMAIL_REPLY_TO = originalReplyTo;
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;
  resetResendClient();
  __resetSandboxWarning();
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

  test('sets reply_to from EMAIL_REPLY_TO when set', async () => {
    process.env.EMAIL_FROM = 'The Resource Room <no-reply\x40theresourceroom.co.za>';
    process.env.EMAIL_REPLY_TO = 'support\x40theresourceroom.co.za';
    const captured = [];
    const origFetch = global.fetch;
    global.fetch = async (_url, opts) => {
      captured.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({ id: 'm' }), { status: 200 });
    };
    try {
      await sendEmail({ to: em('teacher'), subject: 's', text: 't' });
    } finally {
      global.fetch = origFetch;
    }
    assert.equal(captured[0].reply_to, 'support\x40theresourceroom.co.za');
    assert.equal(captured[0].from, 'The Resource Room <no-reply\x40theresourceroom.co.za>');
  });

  test('reply_to falls back to from when EMAIL_REPLY_TO is unset', async () => {
    process.env.EMAIL_FROM = 'no-reply\x40theresourceroom.co.za';
    delete process.env.EMAIL_REPLY_TO;
    const captured = [];
    const origFetch = global.fetch;
    global.fetch = async (_url, opts) => {
      captured.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({ id: 'm' }), { status: 200 });
    };
    try {
      await sendEmail({ to: em('teacher'), subject: 's', text: 't' });
    } finally {
      global.fetch = origFetch;
    }
    assert.equal(captured[0].reply_to, 'no-reply\x40theresourceroom.co.za');
  });

  test('logs a sandbox-deliverability warning the FIRST time we send via the sandbox sender', async () => {
    delete process.env.EMAIL_FROM;
    const warnings = [];
    const logger = { info: () => {}, warn: (a, b) => warnings.push({ a, b }), error: () => {} };
    const origFetch = global.fetch;
    global.fetch = async () => new Response(JSON.stringify({ id: 'm' }), { status: 200 });
    try {
      await sendEmail({ to: em('teacher'), subject: 's', text: 't', logger });
      await sendEmail({ to: em('teacher'), subject: 's', text: 't', logger });
    } finally {
      global.fetch = origFetch;
    }
    // Once-per-process gate: warning fires on first send only
    const sandboxWarnings = warnings.filter((w) =>
      typeof w.b === 'string' && /sandbox/i.test(w.b),
    );
    assert.equal(sandboxWarnings.length, 1);
  });
});

describe('resolveFrom + isUsingSandbox', () => {
  test('uses EMAIL_FROM when set', () => {
    process.env.EMAIL_FROM = 'Brand <hello\x40example.com>';
    assert.equal(resolveFrom(), 'Brand <hello\x40example.com>');
    assert.equal(isUsingSandbox(), false);
  });

  test('falls back to the Resend sandbox when EMAIL_FROM is unset', () => {
    delete process.env.EMAIL_FROM;
    assert.match(resolveFrom(), /onboarding\x40resend\.dev/);
    assert.equal(isUsingSandbox(), true);
  });

  test('detects sandbox even when wrapped in a friendly name', () => {
    assert.equal(isUsingSandbox('Whatever <onboarding\x40resend.dev>'), true);
    assert.equal(isUsingSandbox('Whatever <hello\x40example.com>'), false);
  });
});

describe('checkEmailConfig — startup warning', () => {
  test('silent when EMAIL_PROVIDER is not resend', () => {
    process.env.EMAIL_PROVIDER = 'console';
    const warns = [];
    checkEmailConfig({ logger: { warn: (a, b) => warns.push({ a, b }) } });
    assert.equal(warns.length, 0);
  });

  test('warns when EMAIL_PROVIDER=resend but EMAIL_FROM is unset', () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test_fake';
    delete process.env.EMAIL_FROM;
    const warns = [];
    checkEmailConfig({ logger: { warn: (a, b) => warns.push({ a, b }) } });
    assert.ok(warns.some((w) => /sandbox/i.test(typeof w.b === 'string' ? w.b : w.a)));
  });

  test('warns when EMAIL_PROVIDER=resend but RESEND_API_KEY is unset', () => {
    process.env.EMAIL_PROVIDER = 'resend';
    delete process.env.RESEND_API_KEY;
    process.env.EMAIL_FROM = 'Brand <hello\x40example.com>';
    const warns = [];
    checkEmailConfig({ logger: { warn: (a, b) => warns.push({ a, b }) } });
    // No-key warning is the .warn(string) shape (no leading bindings object).
    assert.ok(warns.some((w) => /RESEND_API_KEY/.test(typeof w.a === 'string' ? w.a : '')));
  });

  test('silent when production-ready (provider=resend, key set, branded EMAIL_FROM)', () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test_fake';
    process.env.EMAIL_FROM = 'Brand <hello\x40example.com>';
    const warns = [];
    checkEmailConfig({ logger: { warn: (a, b) => warns.push({ a, b }) } });
    assert.equal(warns.length, 0);
  });
});
