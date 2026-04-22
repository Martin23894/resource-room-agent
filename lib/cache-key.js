// Deterministic cache-key builder for generation requests.
//
// Two requests with the same generation parameters must produce the exact
// same key regardless of field ordering. SHA-256 over a canonical JSON
// representation (keys sorted alphabetically, undefined stripped) gives us
// a short, collision-resistant key.

import { createHash } from 'node:crypto';

// Only these fields influence the generated resource. Anything else in the
// request body (timing, client metadata, debug flags, …) is ignored so
// cosmetic differences don't cause spurious cache misses.
const CACHE_FIELDS = [
  'subject',
  'topic',
  'resourceType',
  'language',
  'duration',
  'difficulty',
  'includeRubric',
  'grade',
  'term',
];

function canonicalize(params) {
  const picked = {};
  for (const f of CACHE_FIELDS) {
    if (params[f] !== undefined && params[f] !== null) picked[f] = params[f];
  }
  const sortedKeys = Object.keys(picked).sort();
  const sorted = {};
  for (const k of sortedKeys) sorted[k] = picked[k];
  return JSON.stringify(sorted);
}

/**
 * Build a cache key for a /api/generate request. The namespace prefix makes
 * it easy to reason about keys in the SQLite table if we ever add caches for
 * other endpoints alongside this one.
 */
export function generateCacheKey(params) {
  const canonical = canonicalize(params);
  const hash = createHash('sha256').update(canonical).digest('hex');
  return `gen:${hash}`;
}

/** Exposed for tests so we can assert on the canonical string directly. */
export function canonicalizeForTest(params) {
  return canonicalize(params);
}
