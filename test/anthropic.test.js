import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { callAnthropic, AnthropicError } from '../lib/anthropic.js';

// Silent logger so retry warnings don't pollute test output.
const silentLogger = { warn: () => {}, info: () => {}, error: () => {} };

let originalFetch;
let originalKey;

beforeEach(() => {
  originalFetch = global.fetch;
  originalKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

function mockResponse({ ok, status, body }) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// Helper: build a fetch mock that yields a sequence of responses / errors.
function sequenceFetch(sequence) {
  let i = 0;
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const step = sequence[Math.min(i, sequence.length - 1)];
    i++;
    if (step instanceof Error) throw step;
    return mockResponse(step);
  };
  fn.calls = calls;
  return fn;
}

// Speed up: patch the retry delays so tests finish in milliseconds, not 30s.
// We override by reading the module's internal constants via dynamic reimport.
// The simplest reliable approach is just to skip the slow delays via test timeout
// tolerance; Node's retry delays here are [2s, 4s, 8s, 16s]. The first attempt
// runs immediately, so a test that only needs to assert the FIRST call's
// behaviour finishes instantly. Tests that need multiple attempts get a longer
// timeout.

describe('callAnthropic happy path', () => {
  test('returns concatenated text from content blocks', async () => {
    global.fetch = sequenceFetch([
      { ok: true, status: 200, body: { content: [{ text: 'Hello ' }, { text: 'world' }] } },
    ]);

    const out = await callAnthropic({
      system: 'sys',
      user: 'usr',
      maxTokens: 100,
      logger: silentLogger,
    });

    assert.equal(out, 'Hello world');
    assert.equal(global.fetch.calls.length, 1);
  });

  test('sends the configured model and version headers', async () => {
    global.fetch = sequenceFetch([
      { ok: true, status: 200, body: { content: [{ text: 'ok' }] } },
    ]);

    await callAnthropic({ system: 's', user: 'u', maxTokens: 10, logger: silentLogger });

    const { opts } = global.fetch.calls[0];
    assert.equal(opts.headers['x-api-key'], 'sk-ant-test');
    assert.equal(opts.headers['anthropic-version'], '2023-06-01');
    const body = JSON.parse(opts.body);
    assert.equal(body.model, 'claude-sonnet-4-6');
    assert.equal(body.max_tokens, 10);
  });
});

describe('callAnthropic retry behaviour', () => {
  test('retries a 529 overload response then succeeds', { timeout: 10000 }, async () => {
    global.fetch = sequenceFetch([
      { ok: false, status: 529, body: { error: { message: 'overloaded' } } },
      { ok: true, status: 200, body: { content: [{ text: 'recovered' }] } },
    ]);

    const out = await callAnthropic({
      system: 's',
      user: 'u',
      maxTokens: 10,
      logger: silentLogger,
    });
    assert.equal(out, 'recovered');
    assert.equal(global.fetch.calls.length, 2);
  });

  test('retries a 500 server error', { timeout: 10000 }, async () => {
    global.fetch = sequenceFetch([
      { ok: false, status: 500, body: { error: { message: 'boom' } } },
      { ok: true, status: 200, body: { content: [{ text: 'ok' }] } },
    ]);

    await callAnthropic({ system: 's', user: 'u', maxTokens: 10, logger: silentLogger });
    assert.equal(global.fetch.calls.length, 2);
  });

  test('does NOT retry on 400 (client error)', async () => {
    global.fetch = sequenceFetch([
      { ok: false, status: 400, body: { error: { message: 'bad input' } } },
    ]);

    await assert.rejects(
      callAnthropic({ system: 's', user: 'u', maxTokens: 10, logger: silentLogger }),
      (err) => err instanceof AnthropicError && err.status === 400,
    );
    assert.equal(global.fetch.calls.length, 1);
  });

  test('does NOT retry on 401 (auth error)', async () => {
    global.fetch = sequenceFetch([
      { ok: false, status: 401, body: { error: { message: 'invalid api key' } } },
    ]);

    await assert.rejects(
      callAnthropic({ system: 's', user: 'u', maxTokens: 10, logger: silentLogger }),
      (err) => err instanceof AnthropicError && err.status === 401,
    );
    assert.equal(global.fetch.calls.length, 1);
  });

  test('retries on network failure (TypeError from fetch)', { timeout: 10000 }, async () => {
    global.fetch = sequenceFetch([
      new TypeError('ECONNRESET'),
      { ok: true, status: 200, body: { content: [{ text: 'ok' }] } },
    ]);

    await callAnthropic({ system: 's', user: 'u', maxTokens: 10, logger: silentLogger });
    assert.equal(global.fetch.calls.length, 2);
  });
});

describe('callAnthropic abort signal', () => {
  test('aborts an in-flight request when the external signal fires', { timeout: 5000 }, async () => {
    // fetch that never resolves until aborted
    global.fetch = (_url, opts) => new Promise((_resolve, reject) => {
      const abort = () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (opts.signal?.aborted) return abort();
      opts.signal?.addEventListener('abort', abort);
    });

    const controller = new AbortController();
    const promise = callAnthropic({
      system: 's', user: 'u', maxTokens: 10, logger: silentLogger, signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);

    await assert.rejects(promise, (err) => err instanceof AnthropicError && err.code === 'ABORTED');
  });

  test('an already-aborted signal short-circuits immediately', { timeout: 5000 }, async () => {
    global.fetch = (_url, opts) => new Promise((_resolve, reject) => {
      const abort = () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (opts.signal?.aborted) return abort();
      opts.signal?.addEventListener('abort', abort);
    });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      callAnthropic({ system: 's', user: 'u', maxTokens: 10, logger: silentLogger, signal: controller.signal }),
      (err) => err instanceof AnthropicError && err.code === 'ABORTED',
    );
  });

  test('ABORTED errors are NOT retried', { timeout: 5000 }, async () => {
    let calls = 0;
    global.fetch = (_url, opts) => new Promise((_resolve, reject) => {
      calls++;
      opts.signal?.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
    const controller = new AbortController();
    const promise = callAnthropic({
      system: 's', user: 'u', maxTokens: 10, logger: silentLogger, signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(promise);
    assert.equal(calls, 1, 'aborted call must not retry');
  });
});

describe('callAnthropic input guards', () => {
  test('throws AnthropicError when API key missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    await assert.rejects(
      callAnthropic({ system: 's', user: 'u', maxTokens: 10, logger: silentLogger }),
      (err) => err instanceof AnthropicError && /ANTHROPIC_API_KEY/.test(err.message),
    );
  });
});
