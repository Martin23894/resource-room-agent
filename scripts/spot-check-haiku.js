#!/usr/bin/env node
// Spot-check the Haiku 4.5 swap on /api/refine by exercising the underlying
// handler function directly with synthetic inputs. Prints outputs to stdout
// for eyeball review. No moderator — refine isn't CAPS-paper-shaped so the
// moderator's rubric doesn't apply.

import refineHandler from '../api/refine.js';

const silentLogger = { info: () => {}, warn: () => {}, error: console.error };

function mockReq(body) {
  return { method: 'POST', body, headers: { accept: 'application/json' }, log: silentLogger, on: () => {} };
}
function mockRes() {
  return {
    statusCode: 200, payload: null, headersSent: false,
    setTimeout: () => {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.payload = p; this.headersSent = true; return this; },
  };
}

async function checkRefine() {
  console.log('\n══════ /api/refine (Haiku) ══════');
  const sampleDoc = `MATHEMATICS TEST — GRADE 6 TERM 2

QUESTION 1: Fractions  [10 marks]

1.1 Calculate: 3/4 + 1/8.   [2]
1.2 Express 0.625 as a fraction in its simplest form.   [2]
1.3 List three equivalent fractions to 2/5.   [3]
1.4 Order from smallest to largest: 1/2, 3/8, 5/6, 2/3.   [3]

QUESTION 2: Decimals  [10 marks]

2.1 What is 0.4 + 0.35?   [2]
2.2 Round 12.748 to one decimal place.   [2]
2.3 A learner buys 3 items at R12.50 each. What is the total?   [3]
2.4 Express 7/10 as a decimal.   [3]`;

  const cases = [
    { instruction: 'Make question 1.1 harder by using mixed numbers instead of simple fractions.' },
    { instruction: 'Add a fifth question (Question 2.5) on multiplying decimals worth 3 marks.' },
  ];
  for (const c of cases) {
    const t0 = Date.now();
    const r = mockRes();
    await refineHandler(mockReq({
      originalContent: sampleDoc,
      refinementInstruction: c.instruction,
      subject: 'Mathematics', resourceType: 'Test', language: 'English',
      grade: 6, term: 2,
    }), r);
    console.log(`\n→ "${c.instruction}"  (${Date.now() - t0}ms, status=${r.statusCode})`);
    if (r.statusCode !== 200) { console.log('ERROR:', r.payload); continue; }
    console.log(`  changesSummary: ${r.payload.changesSummary}`);
    console.log(`  content (first 600 chars):`);
    console.log('    ' + (r.payload.content || '').substring(0, 600).replace(/\n/g, '\n    '));
  }
}

(async () => {
  await checkRefine();
})().catch((err) => { console.error(err); process.exit(1); });
