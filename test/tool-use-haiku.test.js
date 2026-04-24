// Phase 3.0b: the three tool-use phases (plan, quality check, memo
// verification) must fire against Haiku 4.5, not Sonnet. Sonnet is ~3×
// more expensive and overkill for these structured-output calls.
//
// These are unit-level checks on the constants + a capture-fetch
// verification that callAnthropicTool actually sends `model: "claude-haiku-4-5"`
// when given `model: TOOL_MODEL`.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  callAnthropicTool, HAIKU_MODEL, TOOL_MODEL,
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

function captureFetch(toolResult) {
  const calls = [];
  const fn = async (_url, opts) => {
    calls.push(JSON.parse(opts.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'tool_use', name: toolResult.name, input: toolResult.input }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
      text: async () => '',
    };
  };
  fn.calls = calls;
  return fn;
}

describe('TOOL_MODEL constant', () => {
  test('resolves to Haiku 4.5 (the cheap tier)', () => {
    assert.equal(TOOL_MODEL, 'claude-haiku-4-5');
    assert.equal(TOOL_MODEL, HAIKU_MODEL);
  });

  test('is a distinct model from the default Sonnet (non-regression check)', () => {
    // If someone later aliases TOOL_MODEL back to Sonnet, this catches it
    // so we have a forced code review moment on the cost reversal.
    assert.notEqual(TOOL_MODEL, 'claude-sonnet-4-6');
  });
});

describe('callAnthropicTool sends the model the caller asked for', () => {
  test('uses Haiku when given model: TOOL_MODEL', async () => {
    global.fetch = captureFetch({
      name: 'plan',
      input: { questions: [] },
    });

    await callAnthropicTool({
      system: 'plan this paper',
      user: 'grade 6 maths',
      tool: { name: 'plan', input_schema: { type: 'object' } },
      maxTokens: 1500,
      model: TOOL_MODEL,
      logger: silentLogger,
    });

    const payload = global.fetch.calls[0];
    assert.equal(payload.model, 'claude-haiku-4-5');
  });

  test('still defaults to Sonnet when model is omitted (free-form generation path)', async () => {
    global.fetch = captureFetch({ name: 't', input: {} });
    await callAnthropicTool({
      system: 'x',
      user: 'y',
      tool: { name: 't', input_schema: { type: 'object' } },
      maxTokens: 100,
      logger: silentLogger,
    });
    assert.equal(global.fetch.calls[0].model, 'claude-sonnet-4-6');
  });
});
