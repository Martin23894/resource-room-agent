import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { callAnthropicTool, AnthropicError } from '../lib/anthropic.js';

const silentLogger = { warn: () => {}, info: () => {}, error: () => {} };

const sampleTool = {
  name: 'submit_thing',
  description: 'submit a thing',
  input_schema: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  },
};

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

describe('callAnthropicTool — happy path', () => {
  test('returns the tool_use input object directly', async () => {
    global.fetch = sequenceFetch([
      {
        ok: true,
        status: 200,
        body: {
          stop_reason: 'tool_use',
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'submit_thing', input: { value: 'hello' } },
          ],
        },
      },
    ]);

    const out = await callAnthropicTool({
      system: 'sys',
      user: 'usr',
      tool: sampleTool,
      maxTokens: 100,
      logger: silentLogger,
    });

    assert.deepEqual(out, { value: 'hello' });
    assert.equal(global.fetch.calls.length, 1);
  });

  test('forces tool_choice to the named tool', async () => {
    global.fetch = sequenceFetch([
      {
        ok: true,
        status: 200,
        body: {
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', name: 'submit_thing', input: { value: 'x' } }],
        },
      },
    ]);

    await callAnthropicTool({ system: 's', user: 'u', tool: sampleTool, maxTokens: 50, logger: silentLogger });

    const body = JSON.parse(global.fetch.calls[0].opts.body);
    assert.deepEqual(body.tool_choice, { type: 'tool', name: 'submit_thing' });
    assert.equal(body.tools.length, 1);
    assert.equal(body.tools[0].name, 'submit_thing');
  });
});

describe('callAnthropicTool — failure modes', () => {
  test('throws if the model returns text instead of calling the tool', async () => {
    global.fetch = sequenceFetch([
      {
        ok: true,
        status: 200,
        body: {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Sorry, I cannot do that.' }],
        },
      },
    ]);

    await assert.rejects(
      callAnthropicTool({ system: 's', user: 'u', tool: sampleTool, maxTokens: 50, logger: silentLogger }),
      (err) => err instanceof AnthropicError && /did not call tool/.test(err.message),
    );
  });

  test('throws if no tool is supplied', async () => {
    await assert.rejects(
      callAnthropicTool({ system: 's', user: 'u', maxTokens: 50, logger: silentLogger }),
      (err) => err instanceof AnthropicError && /requires a tool/.test(err.message),
    );
  });

  test('retries on 529 like the text wrapper does', { timeout: 10000 }, async () => {
    global.fetch = sequenceFetch([
      { ok: false, status: 529, body: { error: { message: 'overloaded' } } },
      {
        ok: true,
        status: 200,
        body: {
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', name: 'submit_thing', input: { value: 'recovered' } }],
        },
      },
    ]);

    const out = await callAnthropicTool({ system: 's', user: 'u', tool: sampleTool, maxTokens: 50, logger: silentLogger });
    assert.deepEqual(out, { value: 'recovered' });
    assert.equal(global.fetch.calls.length, 2);
  });

  test('does NOT retry on 400 client error', async () => {
    global.fetch = sequenceFetch([
      { ok: false, status: 400, body: { error: { message: 'bad input' } } },
    ]);

    await assert.rejects(
      callAnthropicTool({ system: 's', user: 'u', tool: sampleTool, maxTokens: 50, logger: silentLogger }),
      (err) => err instanceof AnthropicError && err.status === 400,
    );
    assert.equal(global.fetch.calls.length, 1);
  });
});
