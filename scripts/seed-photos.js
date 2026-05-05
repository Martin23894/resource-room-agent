#!/usr/bin/env node
//
// scripts/seed-photos.js — Phase D photo-library curation helper.
//
// Fetches candidate stock photos from Unsplash via API, downloads pre-
// cropped 1200×800 JPGs into lib/illustrations/photos/_candidates/<cat>/,
// and writes a _credits.json sibling with photographer + source URL +
// license confirmation. The operator then reviews the candidates,
// picks 8–9 favourites per category, and copies them into the actual
// category directories with sequential NN.jpg names.
//
// USAGE
//   UNSPLASH_ACCESS_KEY=<key> node scripts/seed-photos.js
//   UNSPLASH_ACCESS_KEY=<key> node scripts/seed-photos.js --category=mathematics
//   UNSPLASH_ACCESS_KEY=<key> node scripts/seed-photos.js --candidates=5
//
// Get a free Unsplash API key at https://unsplash.com/oauth/applications
// (free tier: 50 requests/hr — well above what this script needs for a
// full 6-category run).
//
// HOW IT WORKS
//   • For each of the 6 photo categories, runs ~5 search queries chosen
//     to cover the curation guide's content suggestions (kid-appropriate,
//     diverse, mix of literal and abstract).
//   • Pulls N candidates per query (default 3 → ~15 per category).
//   • Uses Unsplash's URL parameters (?w=1200&h=800&fit=crop&q=80&fm=jpg)
//     to request a pre-cropped portrait-friendly JPG — no client-side
//     resize step needed (no sharp / imagemagick dep).
//   • Saves each photo as <unsplash-id>.jpg inside _candidates/<category>/
//     so duplicate runs don't overwrite each other and the operator can
//     trace any photo back to its Unsplash ID.
//   • Calls Unsplash's download-tracking endpoint per photo, as required
//     by their API Terms of Service.
//   • Merges credits across runs — re-running the script after adding new
//     query terms is safe and additive.
//
// LICENSE COMPLIANCE
//   Photos served through the Unsplash API are licensed under the Unsplash
//   License (https://unsplash.com/license) — free for commercial and
//   non-commercial use, no attribution required, modification allowed,
//   no compiling-into-photo-libraries-for-resale.
//   The _credits.json manifest preserves photographer + source URL for
//   each candidate so the trail back to the original is one click away
//   if it's ever needed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:https';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');
const PHOTOS_DIR = path.join(REPO_ROOT, 'lib', 'illustrations', 'photos');
const CANDIDATES_DIR = path.join(PHOTOS_DIR, '_candidates');

const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
if (!ACCESS_KEY) {
  console.error('Error: UNSPLASH_ACCESS_KEY env var required.');
  console.error('Get a free key at https://unsplash.com/oauth/applications');
  process.exit(1);
}

// ── CLI flags ────────────────────────────────────────────────────────
function flag(name, fallback) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : fallback;
}
const ONLY_CATEGORY     = flag('category', null);
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

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      headers: {
        Authorization: `Client-ID ${ACCESS_KEY}`,
        'Accept-Version': 'v1',
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Unsplash API ${res.statusCode}: ${body.slice(0, 200)}`));
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
      // Follow 301/302 redirects (Unsplash's images.unsplash.com CDN does this)
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

// Unsplash API ToS requires us to ping the download_location URL after
// triggering a download — this increments the photographer's download
// counter in their stats. We don't care about the response.
function notifyDownload(downloadLocation) {
  return httpGetJson(downloadLocation).catch(() => null);
}

// ── Core flow ────────────────────────────────────────────────────────

async function searchUnsplash(query, perPage) {
  const url = `https://api.unsplash.com/search/photos`
    + `?query=${encodeURIComponent(query)}`
    + `&per_page=${perPage}`
    + `&content_filter=high`;
  const body = await httpGetJson(url);
  return Array.isArray(body.results) ? body.results : [];
}

async function downloadCandidate(photo, categoryDir) {
  const id = photo.id;
  const targetPath = path.join(categoryDir, `${id}.jpg`);
  if (fs.existsSync(targetPath)) {
    return { skipped: true, id };
  }

  // Use the raw URL with Unsplash's CDN params — pre-cropped to 1200×800,
  // q=80 JPEG, ~120–250 KB depending on image complexity. No client-side
  // resize needed.
  const sourceUrl = `${photo.urls.raw}&w=1200&h=800&fit=crop&q=80&fm=jpg&auto=format`;
  const buf = await httpGetBuffer(sourceUrl);
  fs.writeFileSync(targetPath, buf);

  // Notify Unsplash for the download counter (per API ToS). Fire-and-forget.
  await notifyDownload(photo.links.download_location);

  return {
    skipped: false,
    id,
    file: `${id}.jpg`,
    description: photo.description || photo.alt_description || '',
    photographer: photo.user?.name || null,
    photographer_url: photo.user?.links?.html || null,
    source_url: photo.links?.html || null,
    license: 'Unsplash License (https://unsplash.com/license)',
    bytes: buf.length,
  };
}

async function processCategory(category) {
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
      photos = await searchUnsplash(query, CANDIDATES_PER_QUERY);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      continue;
    }
    let downloaded = 0;
    let skipped = 0;
    for (const photo of photos) {
      if (seenIds.has(photo.id)) continue;
      seenIds.add(photo.id);
      try {
        const res = await downloadCandidate(photo, categoryDir);
        if (res.skipped) { skipped++; continue; }
        credits.push({ ...res, query });
        downloaded++;
      } catch (err) {
        console.log(`\n    [error] ${photo.id}: ${err.message}`);
      }
    }
    console.log(`${downloaded} new, ${skipped} already on disk`);
    // Small pause between searches to be friendly to the API
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
  fs.mkdirSync(CANDIDATES_DIR, { recursive: true });
  const categories = ONLY_CATEGORY ? [ONLY_CATEGORY] : Object.keys(QUERIES);
  console.log(`Seed-photos: fetching candidates for ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'} → ${CANDIDATES_DIR}/`);

  for (const category of categories) {
    try {
      await processCategory(category);
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
