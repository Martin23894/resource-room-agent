#!/usr/bin/env node
// Paired-call cache verification: run the same cell twice in succession.
// Call #1 should be a cache WRITE (cR=0, cW>0). Call #2 should be a
// cache HIT (cR>0, cW=0 or small). If we don't see cR>0 on call #2,
// there IS an invalidator in the prompt-build path despite the
// determinism tests passing — and we need to keep digging.
//
// Costs ~$0.40 per run, takes ~3-4 min. Use sparingly.
//
//   ANTHROPIC_API_KEY=... node scripts/verify-cache-hit.js
//
// Cell can be overridden via flags but the defaults are a typical Test.

import { generate } from '../api/generate.js';

const cell = {
  subject: 'Mathematics',
  grade: 5,
  term: 2,
  language: 'English',
  resourceType: 'Test',
  totalMarks: 40,
};

function fmt(u) {
  return `input=${u.input} cacheWrite=${u.cacheWrite} cacheRead=${u.cacheRead} output=${u.output}`;
}

console.log('Cell:', JSON.stringify(cell));
console.log('\nCall #1 (expected: cache WRITE)');
const t1 = Date.now();
const r1 = await generate({ ...cell }, { maxRetries: 0 });
console.log(`  ${Date.now() - t1}ms, attempts=${r1.attempts}, valid=${r1.validation.ok}`);
const u1 = r1.usageByAttempt?.[0];
if (u1) console.log('  ' + fmt(u1));

console.log('\nCall #2 (expected: cache HIT — same prefix as call #1)');
const t2 = Date.now();
const r2 = await generate({ ...cell }, { maxRetries: 0 });
console.log(`  ${Date.now() - t2}ms, attempts=${r2.attempts}, valid=${r2.validation.ok}`);
const u2 = r2.usageByAttempt?.[0];
if (u2) console.log('  ' + fmt(u2));

if (u1 && u2) {
  console.log('\n=== Result ===');
  if (u2.cacheRead > 0) {
    const cachedBytes = u2.cacheRead;
    const inputBytes = u2.input;
    const ratio = cachedBytes / (cachedBytes + inputBytes);
    console.log(`✓ CACHE HIT — call #2 read ${u2.cacheRead} cached tokens (${(ratio * 100).toFixed(1)}% of input prefix served from cache)`);
    // Cost comparison.
    const usdNoCache = (u1.input + u1.cacheWrite) * 3 / 1_000_000;
    const usdCache = u2.input * 3 / 1_000_000 + u2.cacheRead * 0.30 / 1_000_000;
    console.log(`Input cost call #1: $${usdNoCache.toFixed(4)}  (no cache yet)`);
    console.log(`Input cost call #2: $${usdCache.toFixed(4)}  (cache active)`);
    console.log(`Saving on input portion: ${((1 - usdCache / usdNoCache) * 100).toFixed(1)}%`);
  } else {
    console.log(`✗ CACHE MISS on call #2. Cache write ${u2.cacheWrite}, cache read ${u2.cacheRead}.`);
    console.log('There IS an invalidator in the prompt-build path. Investigate further.');
    process.exit(1);
  }
}
