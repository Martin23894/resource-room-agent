// Photo picker — Phase D v1.
//
// Resolves a deterministic photo for a given subject + slot index. The
// picker maps an `meta.subject` string to one of six photo categories
// (mathematics / sciences / geography / languages / history / lifeskills)
// and indexes into the per-category file list with `slot % count` so the
// same Lesson always resolves to the same photo, but different slots
// (e.g. slide #4 vs slide #6 in the same lesson) pick different photos.
//
// Photos are NOT shipped in this repo — `lib/illustrations/photos/<cat>/
// 01.jpg`, `02.jpg`, … are vendored by the curator following
// lib/illustrations/photos/README.md. The picker checks file existence
// and returns `exists: false` for missing slots; callers (the PPTX
// renderer) then either skip the photo embed or render a "ghost frame"
// placeholder so layout previews work before any photos land.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PHOTOS_DIR = path.join(__dirname, 'photos');

// Per-category slot counts. The split favours families with broader
// subject scope (Sciences and Languages each cover multiple subjects).
// Counts are the number of curated photos actually present on disk per
// category — bump as more photos land. The slot-count test in
// test/illustrations.test.js asserts the total stays consistent.
export const PHOTO_CATEGORIES = Object.freeze({
  mathematics: 7,
  sciences:    8,
  geography:   8,
  languages:   9,
  history:     8,
  lifeskills:  8,    // also covers Life Orientation + EMS
});

// Subject → category mapping. Sub-string matched against meta.subject.
// Order matters — the first match wins, so more specific patterns come
// first (Geography before the broad Languages bucket).
const CATEGORY_MAP = [
  { match: /Mathematics/i,                                          category: 'mathematics' },
  { match: /Natural Sciences|Technology/i,                          category: 'sciences' },
  { match: /Geography/i,                                            category: 'geography' },
  { match: /History/i,                                              category: 'history' },
  { match: /Home Language|Additional Language|English|Afrikaans/i,  category: 'languages' },
  { match: /Life Skills|Life Orientation|Economic|Management/i,     category: 'lifeskills' },
];

/** Map a subject string to its photo category. Falls back to lifeskills
 *  for anything we haven't categorised — that bucket carries the most
 *  generic "kids learning" photos so it makes the cleanest fallback. */
export function categoryFor(subject) {
  const s = String(subject || '');
  for (const entry of CATEGORY_MAP) {
    if (entry.match.test(s)) return entry.category;
  }
  return 'lifeskills';
}

/**
 * Pick a deterministic photo for a (subject, slot) pair.
 *
 *   pickPhoto({ subject: 'Mathematics', slot: 4 })
 *     → { category: 'mathematics', fileName: '05.jpg',
 *         path: '…/photos/mathematics/05.jpg', exists: true|false }
 *
 * `slot` is typically the slide ordinal so different slides in the same
 * deck pick different photos. The picker is pure — same inputs always
 * map to the same fileName, regardless of whether the file is present.
 */
export function pickPhoto({ subject, slot = 0 } = {}) {
  const category = categoryFor(subject);
  const total = PHOTO_CATEGORIES[category] || 0;
  if (total === 0) return null;

  const idx = (Math.abs(Number.isFinite(slot) ? slot : 0) % total) + 1;
  const fileName = `${String(idx).padStart(2, '0')}.jpg`;
  const filePath = path.join(PHOTOS_DIR, category, fileName);
  const exists = safeExists(filePath);
  return { path: filePath, exists, category, fileName };
}

/** Read photo bytes from disk. Returns null on any error so callers can
 *  skip the embed without the slide failing. */
export function loadPhotoBuffer(photo) {
  if (!photo || !photo.exists) return null;
  try { return fs.readFileSync(photo.path); }
  catch { return null; }
}

function safeExists(filePath) {
  try { return fs.existsSync(filePath); }
  catch { return false; }
}

// Exposed for tests.
export const __internals = { CATEGORY_MAP, PHOTOS_DIR };
