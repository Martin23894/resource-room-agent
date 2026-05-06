// Wrapper around the Anthropic Messages API.
//
// Two entry points share the same retry / timeout machinery:
//   callAnthropic     — returns the model's text response (concatenated
//                       content blocks). Use for free-form output.
//   callAnthropicTool — forces a tool call and returns the parsed JSON
//                       object the model passed as the tool's input.
//                       Use whenever the response shape is fixed.
//
// Both retry on transient failures (429, 529, 5xx, network errors, timeouts)
// with exponential backoff [2s, 4s, 8s, 16s] and use a 180s per-call timeout.
//
// ── PROMPT CACHING ────────────────────────────────────────────
// When `cacheSystem: true` (default when the system prompt is a non-empty
// string), we wrap it as a single content block with
// `cache_control: {type: 'ephemeral'}`. Anthropic's prefix cache then
// serves subsequent identical-prefix calls at ~10% of input cost.
//
// Cache is a prefix match: any byte change anywhere in the prefix
// invalidates everything after it. So:
//   - Stable content (ATP topics, CAPS rules, cognitive framework, output
//     format) belongs in `system`.
//   - Volatile content (teacher guidance, per-call instructions) belongs
//     in the user message — it sits after the breakpoint and doesn't
//     affect cache validity.
//
// Verify cache hits via the `_meta.cache` object on the response or the
// pino log lines we emit per call. `cache_read_input_tokens: 0` on repeat
// calls means a silent invalidator is at work — audit system-prompt
// construction for `Date.now()`, UUIDs, unsorted JSON, etc.

import { logger as defaultLogger } from './logger.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
// Haiku 4.5 for structured-output / validation calls — 3× cheaper than
// Sonnet on input, 3× cheaper on output, and its tool-use reliability on
// shallow schemas (pick an enum, count marks, list errors) is excellent.
// Use it wherever the response shape is fixed and the content is mechanical.
export const HAIKU_MODEL = 'claude-haiku-4-5';
// Short alias for "the model we use on tool-use validation calls". Having
// a named constant lets us swap to Sonnet per-call if quality regresses.
export const TOOL_MODEL = HAIKU_MODEL;
const DEFAULT_TIMEOUT_MS = 240000;
const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000];

export class AnthropicError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'AnthropicError';
    this.status = status;
    this.code = code;
  }
}

function isRetryable(err) {
  // ABORTED = the caller explicitly cancelled; don't retry that.
  if (err.code === 'ABORTED') return false;
  if (err.code === 'TIMEOUT' || err.code === 'NETWORK') return true;
  const s = err.status;
  return s === 429 || s === 529 || (typeof s === 'number' && s >= 500 && s < 600);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Normalise a `system` argument into the array-of-blocks form the API
 * accepts, adding a cache_control breakpoint on the last block when
 * requested. Accepts:
 *   - string            → wrap as [{type:'text', text, cache_control?}]
 *   - array of blocks   → pass through (caller has full control; if they
 *                         want caching they've already added cache_control)
 *   - undefined/null    → undefined (don't send `system` at all)
 */
function normaliseSystem(system, { cacheSystem }) {
  if (system == null || system === '') return undefined;
  if (Array.isArray(system)) return system;
  if (typeof system !== 'string') {
    throw new AnthropicError('system must be a string or an array of content blocks', { status: 500 });
  }
  const block = { type: 'text', text: system };
  if (cacheSystem) block.cache_control = { type: 'ephemeral' };
  return [block];
}

// Single API call: build the body, fire the request, parse 4xx/5xx into an
// AnthropicError. Returns the raw response data on 2xx; the caller decides
// how to extract content from it.
async function oneRequest(body, { timeoutMs, externalSignal }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  // Merge an optional external signal (e.g. client disconnect) so callers
  // can cancel a call in flight. If it's already aborted, short-circuit.
  const onExternalAbort = () => controller.abort(externalSignal?.reason ?? new Error('aborted'));
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (r.ok) return await r.json();

    const bodyText = await r.text();
    let apiMessage;
    try {
      apiMessage = JSON.parse(bodyText)?.error?.message;
    } catch {
      apiMessage = bodyText.substring(0, 200);
    }
    throw new AnthropicError(apiMessage || `HTTP ${r.status}`, { status: r.status });
  } catch (err) {
    if (err instanceof AnthropicError) throw err;
    if (err.name === 'AbortError') {
      // Distinguish client-triggered cancel from internal timeout so the
      // retry layer doesn't retry user-initiated cancellations.
      if (externalSignal?.aborted) {
        throw new AnthropicError('Request aborted by caller', { code: 'ABORTED' });
      }
      throw new AnthropicError('Anthropic request timed out', { code: 'TIMEOUT' });
    }
    // Treat everything else (fetch failures, DNS, TLS) as a network error.
    throw new AnthropicError(err.message || 'Network error', { code: 'NETWORK' });
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener?.('abort', onExternalAbort);
  }
}

// Generic retry loop. `attempt()` is invoked up to maxAttempts times;
// only retryable errors trigger a wait + retry. The external signal is
// checked between attempts so that an outer abort (e.g. our 5-min hard
// timeout in /api/generate) breaks the cascade instead of letting the
// retries fire instantly back-to-back as the signal aborts.
async function withRetries(attempt, logger, externalSignal) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AnthropicError('ANTHROPIC_API_KEY is not set', { status: 500 });
  }

  // Already aborted before we even start — short-circuit.
  if (externalSignal?.aborted) {
    throw new AnthropicError('Request aborted by caller', { code: 'ABORTED' });
  }

  let lastError;
  const maxAttempts = RETRY_DELAYS_MS.length + 1; // first call + N retries
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err;
      // External abort during a request — stop retrying immediately.
      if (externalSignal?.aborted) {
        throw new AnthropicError('Request aborted by caller', { code: 'ABORTED' });
      }
      if (!isRetryable(err) || i === maxAttempts) throw err;
      const delay = RETRY_DELAYS_MS[i - 1];
      logger.warn?.(
        { attempt: i, nextDelayMs: delay, status: err.status, code: err.code, msg: err.message },
        'Anthropic call failed, retrying',
      );
      await sleep(delay);
      // Abort during the back-off sleep is the most common cascade case.
      if (externalSignal?.aborted) {
        throw new AnthropicError('Request aborted by caller', { code: 'ABORTED' });
      }
    }
  }
  throw lastError;
}

/**
 * Extract cache + usage telemetry from a response.usage block. Returns a
 * small summary object ready to hand to the logger or attach to an SSE
 * phase event.
 */
export function extractCacheStats(usage) {
  if (!usage) return null;
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
  };
}

/**
 * Call the Messages API and return the model's free-form text response.
 * Use this for outputs that are not constrained to a fixed JSON shape
 * (question paper text, memo content, refinements).
 */
export async function callAnthropic({
  system,
  user,
  maxTokens,
  model = DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = defaultLogger,
  signal,          // optional AbortSignal — caller can cancel in flight
  cacheSystem = true, // prefix-cache the system prompt by default
  phase,           // optional label used only in log lines
} = {}) {
  return withRetries(async () => {
    const data = await oneRequest({
      model,
      max_tokens: maxTokens,
      system: normaliseSystem(system, { cacheSystem }),
      messages: [{ role: 'user', content: user }],
    }, { timeoutMs, externalSignal: signal });
    const stats = extractCacheStats(data.usage);
    if (stats) logger.info?.({ phase, model, ...stats }, 'Anthropic call usage');
    const text = data.content?.map((c) => c.text || '').join('') || '';
    return { text, usage: stats };
  }, logger, signal).then((r) => r.text);
}

/**
 * Call the Messages API with a single tool and force the model to call it.
 * Returns the parsed `input` object the model passed to the tool — guaranteed
 * to match the tool's `input_schema`.
 *
 * @param {object} args
 * @param {string} args.system
 * @param {string} args.user
 * @param {object} args.tool       Anthropic tool definition (name, description, input_schema)
 * @param {number} args.maxTokens
 */
export async function callAnthropicTool({
  system,
  user,
  tool,
  maxTokens,
  model = DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = defaultLogger,
  signal,
  cacheSystem = true,
  phase,
  onUsage,
} = {}) {
  if (!tool || !tool.name || !tool.input_schema) {
    throw new AnthropicError('callAnthropicTool requires a tool with { name, input_schema }', { status: 500 });
  }

  return withRetries(async () => {
    const data = await oneRequest({
      model,
      max_tokens: maxTokens,
      system: normaliseSystem(system, { cacheSystem }),
      messages: [{ role: 'user', content: user }],
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
    }, { timeoutMs, externalSignal: signal });

    const stats = extractCacheStats(data.usage);
    if (stats) logger.info?.({ phase, model, tool: tool.name, ...stats }, 'Anthropic tool call usage');
    if (stats && typeof onUsage === 'function') onUsage({ phase, model, ...stats });

    const toolUseBlock = data.content?.find((c) => c.type === 'tool_use' && c.name === tool.name);
    if (!toolUseBlock) {
      throw new AnthropicError(
        `Model did not call tool "${tool.name}" (stop_reason=${data.stop_reason})`,
        { status: 502 },
      );
    }
    return toolUseBlock.input;
  }, logger, signal);
}

// Exposed for tests — they inspect the normalised shape without hitting the API.
export const __internals = { normaliseSystem };
