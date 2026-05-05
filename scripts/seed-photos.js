#!/usr/bin/env node
//
// scripts/seed-photos.js — Phase D photo-library curation helper.
//
// Fetches candidate stock photos from either Pexels or Unsplash (whichever
// API key is set) and downloads them into
// lib/illustrations/photos/_candidates/<cat>/<photo-id>.jpg, with a
// _credits.json sibling tying each candidate back to its photographer
// and source URL. The operator reviews the candidates, picks 8–9
// favourites per category, and copies them into the actual category
// directories with sequential NN.jpg names.
//
// PROVIDER SELECTION
//   • PEXELS_API_KEY        → use Pexels (200 req/hr free tier — preferred)
//   • UNSPLASH_ACCESS_KEY   → use Unsplash (50 req/hr Demo, 5000 Production)
//   • Both set              → Pexels wins (higher limits, no approval gate)
//   • Neither set           → script exits with an error
//
// USAGE
//   PEXELS_API_KEY=<key>      node scripts/seed-photos.js
//   UNSPLASH_ACCESS_KEY=<key> node scripts/seed-photos.js --category=mathematics
//   PEXELS_API_KEY=<key>      node scripts/seed-photos.js --candidates=5
//
// Get a free API key at:
//   • Pexels:   https://www.pexels.com/api/                  (instant)
//   • Unsplash: https://unsplash.com/oauth/applications      (instant Demo)
//
// LICENSE COMPLIANCE
//   Both Pexels and Unsplash provide their photos under licenses that
//   permit free commercial use, modification, and redistribution without
//   attribution. The _credits.json manifest preserves photographer +
//   source URL per candidate so the trail back to the original is one
//   click away if it's ever needed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:https';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');
const PHOTOS_DIR = path.join(REPO_ROOT, 'lib', 'illustrations', 'photos');
const CANDIDATES_DIR = path.join(PHOTOS_DIR, '_candidates');

// ── CLI flags ────────────────────────────────────────────────────────
function flag(name, fallback) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : fallback;
}
const ONLY_CATEGORY        = flag('category', null);
const CANDIDATES_PER_QUERY = parseInt(flag('candidates', '3'), 10);

// ── Per-category search queries ──────────────────────────────────────
// Drawn from lib/illustrations/photos/README.md — mix of literal subject
// matter, abstract / hands-on, and SA-leaning terms where natural.
const QUERIES = {
  mathematics: [
    'kids math counting',
    'numbers blocks classroom',
    'geometry shapes',
    'abacus learning',
    'measuring ruler children',
  ],
  sciences: [
    'kids science experiment',
    'magnifying glass nature',
    'plants growing classroom',
    'microscope school',
    'children outdoors discovering',
  ],
  geography: [
    'globe map child',
    'cape town landscape',
    'african savanna wildlife',
    'compass map outdoor',
    'mountains rivers earth',
  ],
  languages: [
    'child reading book',
    'library reading children',
    'kids writing pencil paper',
    'storytelling children',
    'open book pages',
  ],
  history: [
    'old map historic',
    'museum artifacts',
    'parchment manuscript old',
    'historic building south africa',
    'vintage objects sepia',
  ],
  lifeskills: [
    'children playing outside',
    'kids team sports',
    'family meal together',
    'helping hands community',
    'healthy food children',
  ],
};

// ── HTTP helpers ─────────────────────────────────────────────────────

function httpGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 429 || res.statusCode === 403) {
          const retryAfter = res.headers['retry-after'] || res.headers['x-ratelimit-reset'] || '~1 hour';
          reject(new Error(
            `${res.statusCode} rate-limited — wait ${retryAfter} and re-run. ` +
            `(Re-runs are safe; the script skips files already on disk.) ` +
            `Body: ${body.slice(0, 120)}`,
          ));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpGetBuffer(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        return httpGetBuffer(res.headers.location, redirectsLeft - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Provider abstractions ────────────────────────────────────────────
// Each provider exposes the same surface so the curation flow doesn't
// care which API is upstream. Add a new provider by writing one of these
// objects + extending resolveProvider() below.

function makePexels(apiKey) {
  return {
    name: 'Pexels',
    license: 'Pexels License (https://www.pexels.com/license/)',
    rateLimit: '200 req/hr (free tier)',
    search: async (query, perPage) => {
      const url = `https://api.pexels.com/v1/search`
        + `?query=${encodeURIComponent(query)}`
        + `&per_page=${perPage}`;
      const body = await httpGetJson(url, { Authorization: apiKey });
      return Array.isArray(body.photos) ? body.photos : [];
    },
    photoId:  (photo) => String(photo.id),
    photoUrl: (photo) => photo.src?.large2x || photo.src?.large || photo.src?.original,
    photoCredit: (photo) => ({
      id: String(photo.id),
      description: photo.alt || '',
      photographer: photo.photographer || null,
      photographer_url: photo.photographer_url || null,
      source_url: photo.url || null,
      license: 'Pexels License (https://www.pexels.com/license/)',
    }),
    // Pexels doesn't require a download-tracking ping like Unsplash does.
    notifyDownload: () => Promise.resolve(),
  };
}

function makeUnsplash(accessKey) {
  return {
    name: 'Unsplash',
    license: 'Unsplash License (https://unsplash.com/license)',
    rateLimit: '50 req/hr (Demo) / 5000 (Production)',
    search: async (query, perPage) => {
      const url = `https://api.unsplash.com/search/photos`
        + `?query=${encodeURIComponent(query)}`
        + `&per_page=${perPage}`
        + `&content_filter=high`;
      const body = await httpGetJson(url, {
        Authorization: `Client-ID ${accessKey}`,
        'Accept-Version': 'v1',
      });
      return Array.isArray(body.results) ? body.results : [];
    },
    photoId:  (photo) => photo.id,
    // Unsplash CDN URL params pre-crop to 1200×800 so we save a clean
    // ready-to-render JPG — no client-side resize step needed.
    photoUrl: (photo) =>
      `${photo.urls.raw}&w=1200&h=800&fit=crop&q=80&fm=jpg&auto=format`,
    photoCredit: (photo) => ({
      id: photo.id,
      description: photo.description || photo.alt_description || '',
      photographer: photo.user?.name || null,
      photographer_url: photo.user?.links?.html || null,
      source_url: photo.links?.html || null,
      license: 'Unsplash License (https://unsplash.com/license)',
    }),
    // Per the Unsplash API ToS — increments the photographer's stats
    // counter. Fire-and-forget; failures don't matter for the candidate.
    notifyDownload: (photo) => httpGetJson(photo.links.download_location, {
      Authorization: `Client-ID ${accessKey}`,
      'Accept-Version': 'v1',
    }).catch(() => null),
  };
}

function resolveProvider() {
  const pexels = process.env.PEXELS_API_KEY?.trim();
  const unsplash = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (pexels)   return makePexels(pexels);
  if (unsplash) return makeUnsplash(unsplash);
  console.error('Error: set either PEXELS_API_KEY or UNSPLASH_ACCESS_KEY env var.');
  console.error('Get a free key at:');
  console.error('  • Pexels:   https://www.pexels.com/api/   (instant, 200/hr)');
  console.error('  • Unsplash: https://unsplash.com/oauth/applications   (instant Demo, 50/hr)');
  process.exit(1);
}

// ── Core flow ────────────────────────────────────────────────────────

async function downloadCandidate(photo, categoryDir, provider) {
  const id = provider.photoId(photo);
  const targetPath = path.join(categoryDir, `${id}.jpg`);
  if (fs.existsSync(targetPath)) return { skipped: true, id };

  const url = provider.photoUrl(photo);
  if (!url) throw new Error(`no usable image URL for photo ${id}`);
  const buf = await httpGetBuffer(url);
  fs.writeFileSync(targetPath, buf);

  await provider.notifyDownload(photo);

  const credit = provider.photoCredit(photo);
  return {
    skipped: false,
    ...credit,
    file: `${id}.jpg`,
    bytes: buf.length,
  };
}

async function processCategory(category, provider) {
  const queries = QUERIES[category];
  if (!queries) {
    console.error(`  unknown category: ${category}`);
    return;
  }
  const categoryDir = path.join(CANDIDATES_DIR, category);
  fs.mkdirSync(categoryDir, { recursive: true });
  console.log(`\n[${category}] running ${queries.length} queries × up to ${CANDIDATES_PER_QUERY} candidates`);

  const credits = [];
  const seenIds = new Set();
  for (const query of queries) {
    process.stdout.write(`  "${query}" ... `);
    let photos;
    try {
      photos = await provider.search(query, CANDIDATES_PER_QUERY);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      continue;
    }
    let downloaded = 0;
    let skipped = 0;
    for (const photo of photos) {
      const id = provider.photoId(photo);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      try {
        const res = await downloadCandidate(photo, categoryDir, provider);
        if (res.skipped) { skipped++; continue; }
        credits.push({ ...res, query });
        downloaded++;
      } catch (err) {
        console.log(`\n    [error] ${id}: ${err.message}`);
      }
    }
    console.log(`${downloaded} new, ${skipped} already on disk`);
    await new Promise((r) => setTimeout(r, 400));
  }

  // Merge with any existing credits manifest
  const creditsPath = path.join(categoryDir, '_credits.json');
  let existing = [];
  if (fs.existsSync(creditsPath)) {
    try { existing = JSON.parse(fs.readFileSync(creditsPath, 'utf8')); }
    catch { existing = []; }
  }
  const seenInExisting = new Set(existing.map((c) => c.id));
  const merged = existing.concat(credits.filter((c) => !seenInExisting.has(c.id)));
  fs.writeFileSync(creditsPath, JSON.stringify(merged, null, 2) + '\n');
  console.log(`  → ${credits.length} new candidates · ${merged.length} total in _credits.json`);
}

async function main() {
  const provider = resolveProvider();
  fs.mkdirSync(CANDIDATES_DIR, { recursive: true });
  const categories = ONLY_CATEGORY ? [ONLY_CATEGORY] : Object.keys(QUERIES);
  console.log(`Seed-photos: provider=${provider.name} (${provider.rateLimit})`);
  console.log(`Fetching candidates for ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'} → ${CANDIDATES_DIR}/`);

  for (const category of categories) {
    try {
      await processCategory(category, provider);
    } catch (err) {
      console.error(`[${category}] failed: ${err.message}`);
    }
  }

  console.log(`\nDone. Review candidates in:`);
  console.log(`  ${CANDIDATES_DIR}/`);
  console.log(`\nNext steps:`);
  console.log(`  1. Browse each category folder; the _credits.json file lists photographer + source URL per photo.`);
  console.log(`  2. Pick 8–9 favourites per category that match the curation guide's content rules.`);
  console.log(`  3. Copy chosen JPGs into lib/illustrations/photos/<category>/ as 01.jpg, 02.jpg, …`);
  console.log(`  4. Generate a Lesson and eyeball the deck.`);
  console.log(`  5. The _candidates/ tree is gitignored — leave the rejects on disk for reference, or delete to reclaim space.`);
}

main().catch((err) => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
