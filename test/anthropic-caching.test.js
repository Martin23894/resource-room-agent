import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  callAnthropic, callAnthropicTool, extractCacheStats, __internals,
} from '../lib/anthropic.js';

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

function captureFetch({ body }) {
  const calls = [];
  const fn = async (_url, opts) => {
    calls.push(JSON.parse(opts.body));
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  fn.calls = calls;
  return fn;
}

describe('normaliseSystem', () => {
  const { normaliseSystem } = __internals;

  test('wraps a string with cache_control when cacheSystem=true', () => {
    const r = normaliseSystem('You are a helpful teacher.', { cacheSystem: true });
    assert.deepEqual(r, [{
      type: 'text',
      text: 'You are a helpful teacher.',
      cache_control: { type: 'ephemeral' },
    }]);
  });

  test('wraps a string WITHOUT cache_control when cacheSystem=false', () => {
    const r = normaliseSystem('hello', { cacheSystem: false });
    assert.deepEqual(r, [{ type: 'text', text: 'hello' }]);
  });

  test('passes array-of-blocks through unchanged — caller owns caching', () => {
    const blocks = [
      { type: 'text', text: 'stable' },
      { type: 'text', text: 'also stable', cache_control: { type: 'ephemeral' } },
    ];
    const r = normaliseSystem(blocks, { cacheSystem: true });
    assert.equal(r, blocks);
  });

  test('returns undefined for null/empty (omits the system field)', () => {
    assert.equal(normaliseSystem(null, { cacheSystem: true }), undefined);
    assert.equal(normaliseSystem('', { cacheSystem: true }), undefined);
    assert.equal(normaliseSystem(undefined, { cacheSystem: true }), undefined);
  });

  test('throws on an unsupported type', () => {
    assert.throws(() => normaliseSystem(42, { cacheSystem: true }));
  });
});

describe('callAnthropic sends cache_control by default', () => {
  test('caches the system prompt on every request', async () => {
    global.fetch = captureFetch({
      body: { content: [{ text: 'ok' }], usage: { input_tokens: 100, output_tokens: 10 } },
    });

    await callAnthropic({
      system: 'stable preamble that is long enough',
      user: 'do a thing',
      maxTokens: 100,
      logger: silentLogger,
    });

    const payload = global.fetch.calls[0];
    assert.ok(Array.isArray(payload.system));
    assert.equal(payload.system.length, 1);
    assert.deepEqual(payload.system[0].cache_control, { type: 'ephemeral' });
  });

  test('caller can opt out with cacheSystem:false', async () => {
    global.fetch = captureFetch({ body: { content: [{ text: 'ok' }] } });

    await callAnthropic({
      system: 'stable preamble',
      user: 'x',
      maxTokens: 100,
      cacheSystem: false,
      logger: silentLogger,
    });

    const payload = global.fetch.calls[0];
    assert.equal(payload.system[0].cache_control, undefined);
  });
});

describe('callAnthropicTool preserves caching + telemetry', () => {
  test('wraps system block with cache_control', async () => {
    global.fetch = captureFetch({
      body: {
        content: [{ type: 'tool_use', name: 'plan', input: { questions: [] } }],
        usage: {
          input_tokens: 200,
          output_tokens: 50,
          cache_creation_input_tokens: 180,
          cache_read_input_tokens: 0,
        },
      },
    });

    const result = await callAnthropicTool({
      system: 'stable plan preamble',
      user: 'plan me a paper',
      tool: { name: 'plan', input_schema: { type: 'object' } },
      maxTokens: 500,
      logger: silentLogger,
    });

    assert.deepEqual(result, { questions: [] });
    const payload = global.fetch.calls[0];
    assert.equal(payload.system[0].cache_control.type, 'ephemeral');
    assert.equal(payload.tool_choice.name, 'plan');
  });
});

describe('extractCacheStats', () => {
  test('returns null when usage is absent', () => {
    assert.equal(extractCacheStats(undefined), null);
    assert.equal(extractCacheStats(null), null);
  });

  test('captures cache read/write and base tokens', () => {
    const r = extractCacheStats({
      input_tokens: 150,
      output_tokens: 80,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 0,
    });
    assert.deepEqual(r, { input: 150, output: 80, cacheWrite: 2000, cacheRead: 0 });
  });

  test('handles cache hit on a subsequent call', () => {
    const r = extractCacheStats({
      input_tokens: 150,
      output_tokens: 80,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 2000,
    });
    assert.equal(r.cacheRead, 2000);
    assert.equal(r.cacheWrite, 0);
  });

  test('tolerates missing cache fields (older API responses)', () => {
    const r = extractCacheStats({ input_tokens: 100, output_tokens: 10 });
    assert.equal(r.cacheRead, 0);
    assert.equal(r.cacheWrite, 0);
  });
});
