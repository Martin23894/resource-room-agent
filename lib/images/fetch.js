// HTTP fetcher for catalogue images, with an in-memory LRU cache.
//
// First request for a given URL hits the network (~1–3s for typical
// photos). Subsequent requests inside the same process serve from the
// in-memory cache (~0ms). Railway containers restart occasionally so
// the cache is best-effort, but within a single instance's lifetime
// the same image is fetched at most once.
//
// Limits:
//   MAX_BYTES per image — rejects pathologically large downloads
//   CACHE_MAX entries  — simple LRU; oldest evicted when full
//   FETCH_TIMEOUT_MS   — abort slow responses so generation isn't blocked

const MAX_BYTES       = 4 * 1024 * 1024;   // 4 MB per image
const CACHE_MAX       = 64;                // entries in memory
const FETCH_TIMEOUT_MS = 8000;             // 8 s per fetch

const cache = new Map();   // url -> Buffer (insertion order = LRU oldest first)

export async function fetchImageBytes(url, { logger } = {}) {
  if (!url || typeof url !== 'string') throw new Error('fetchImageBytes: url required');

  if (cache.has(url)) {
    // Touch — re-insert at the end so it's "newest" again.
    const buf = cache.get(url);
    cache.delete(url);
    cache.set(url, buf);
    return buf;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('image fetch timeout')), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`image fetch ${res.status} for ${url}`);
    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength > MAX_BYTES) {
      throw new Error(`image too large (${arrayBuf.byteLength} bytes) for ${url}`);
    }
    const buf = Buffer.from(arrayBuf);

    // Evict oldest if at capacity.
    if (cache.size >= CACHE_MAX) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
    cache.set(url, buf);

    logger?.info?.({ url, bytes: buf.length }, 'image fetched and cached');
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

// Test helper — clears the cache so unit tests start clean.
export function __resetImageCacheForTests() {
  cache.clear();
}
