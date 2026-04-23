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
