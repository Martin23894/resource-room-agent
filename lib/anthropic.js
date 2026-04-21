// Thin wrapper around the Anthropic Messages API.
// Adds a 180s per-call timeout and retry with exponential backoff on
// transient failures (429, 529, 5xx, network errors, timeouts).
//
// Returns the concatenated text from the `content` blocks; callers do their
// own JSON extraction / schema parsing on top of that raw string.

import { logger as defaultLogger } from './logger.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_TIMEOUT_MS = 180000;
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
  if (err.code === 'TIMEOUT' || err.code === 'NETWORK') return true;
  const s = err.status;
  return s === 429 || s === 529 || (typeof s === 'number' && s >= 500 && s < 600);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function oneCall({ system, user, maxTokens, model, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });

    if (r.ok) {
      const data = await r.json();
      return data.content?.map((c) => c.text || '').join('') || '';
    }

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
      throw new AnthropicError('Anthropic request timed out', { code: 'TIMEOUT' });
    }
    // Treat everything else (fetch failures, DNS, TLS) as a network error.
    throw new AnthropicError(err.message || 'Network error', { code: 'NETWORK' });
  } finally {
    clearTimeout(timer);
  }
}

export async function callAnthropic({
  system,
  user,
  maxTokens,
  model = DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = defaultLogger,
} = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AnthropicError('ANTHROPIC_API_KEY is not set', { status: 500 });
  }

  let lastError;
  const maxAttempts = RETRY_DELAYS_MS.length + 1; // first call + N retries
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await oneCall({ system, user, maxTokens, model, timeoutMs });
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === maxAttempts) {
        throw err;
      }
      const delay = RETRY_DELAYS_MS[attempt - 1];
      logger.warn?.(
        { attempt, nextDelayMs: delay, status: err.status, code: err.code, msg: err.message },
        'Anthropic call failed, retrying',
      );
      await sleep(delay);
    }
  }
  throw lastError;
}
