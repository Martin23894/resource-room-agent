// Phase 4 of rebalanceMarks: cross-section paired swaps to enforce
// CAPS-prescribed per-section mark targets. Regression guard for the
// 2026-05 teacher review's English HL Gr6 T2 finding (section marks
// drifted off the CAPS 20/10/5/15 split).
//
// Fixtures use a single-level cognitive framework so Phase 2/3 (cog
// rebalancing) is a no-op and we isolate Phase 4's section-target work.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { rebalanceMarks } from '../lib/rebalance.js';

function leafSum(section) {
  let n = 0;
  const walk = (q) => {
    if (Array.isArray(q.subQuestions)) q.subQuestions.forEach(walk);
    else n += q.marks || 0;
  };
  (section.questions || []).forEach(walk);
  return n;
}

// Build a paper with 4 sections, single-level cog so only Phase 4 fires.
function fixture(sectionLeaves) {
  const all = [];
  const sections = sectionLeaves.map((leaves, sIdx) => {
    const qs = leaves.map((marks, qIdx) => {
      const q = {
        number: `${sIdx + 1}.${qIdx + 1}`,
        type: 'ShortAnswer',
        topic: 'Topic',
        stem: `Q${sIdx + 1}.${qIdx + 1}`,
        marks,
        cognitiveLevel: 'Literal',
        answerSpace: { kind: 'lines', lines: 1 },
      };
      all.push(q);
      return q;
    });
    return {
      letter: ['A', 'B', 'C', 'D'][sIdx],
      title: `Section ${sIdx + 1}`,
      questions: qs,
    };
  });
  const total = all.reduce((a, q) => a + q.marks, 0);
  return {
    meta: {
      schemaVersion: '1.0',
      subject: 'English Home Language', grade: 6, term: 2, language: 'English',
      resourceType: 'Test', totalMarks: total, duration: { minutes: 60 }, difficulty: 'on',
      cognitiveFramework: { name: "Barrett's", levels: [
        { name: 'Literal', percent: 100, prescribedMarks: total },
      ]},
      topicScope: { coversTerms: [1, 2], topics: ['Topic'] },
    },
    cover: {
      resourceTypeLabel: 'TEST', subjectLine: 'EHL',
      gradeLine: 'Grade 6', termLine: 'Term 2',
      learnerInfoFields: [{ kind: 'name', label: 'Name' }],
      instructions: { heading: 'Instructions', items: ['Answer.'] },
    },
    stimuli: [],
    sections,
    memo: { answers: all.map((q) => ({
      questionNumber: q.number, answer: 'A', cognitiveLevel: 'Literal', marks: q.marks,
    })) },
  };
}

test('Phase 4 closes section-mark drift to within ±1 of CAPS prescription', () => {
  // Reproduces the live-failing 24/10/3/13 shape against CAPS 20/10/5/15.
  const r = fixture([
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2], // Section A: 24
    [2, 2, 2, 2, 2],                       // Section B: 10
    [1, 1, 1],                             // Section C: 3
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], // Section D: 13
  ]);
  // Sanity-check the starting shape BEFORE we rebalance.
  assert.deepEqual(r.sections.map(leafSum), [24, 10, 3, 13]);

  const result = rebalanceMarks(r, {
    prescribedSectionMarks: [
      { label: 'Comprehension', marks: 20 },
      { label: 'Visual', marks: 10 },
      { label: 'Summary', marks: 5 },
      { label: 'Language', marks: 15 },
    ],
  });

  const finalSums = r.sections.map(leafSum);
  // Total preserved (Phase 4 swaps are zero-sum).
  assert.equal(finalSums.reduce((a, b) => a + b, 0), 50);
  // Each section within ±1 of the prescribed target.
  for (let i = 0; i < 4; i++) {
    const target = [20, 10, 5, 15][i];
    assert.ok(
      Math.abs(finalSums[i] - target) <= 1,
      `Section ${i} sum ${finalSums[i]} not within ±1 of target ${target}`,
    );
  }
  // Phase 4 adjustments tagged 'section-out' / 'section-in'.
  const phase4 = result.adjustments.filter((a) => a.kind?.startsWith('section-'));
  assert.ok(phase4.length >= 2, `expected ≥2 Phase 4 adjustments, got ${phase4.length}`);
});

test('Phase 4 is a no-op when prescription not provided', () => {
  const r = fixture([
    [2, 2, 2], [2, 2, 2], [2, 2, 2], [2, 2],
  ]);
  // 6 / 6 / 6 / 4 = 22 total
  rebalanceMarks(r); // no prescribedSectionMarks
  // Sums unchanged.
  assert.deepEqual(r.sections.map(leafSum), [6, 6, 6, 4]);
});

test('Phase 4 is a no-op when section count differs from prescription', () => {
  const r = fixture([
    [2, 2, 2], [2, 2, 2], [2, 2, 2], [2, 2],
  ]);
  // Prescription has 5 sections but resource has 4 — can't align.
  rebalanceMarks(r, {
    prescribedSectionMarks: [
      { label: 'A', marks: 5 }, { label: 'B', marks: 5 },
      { label: 'C', marks: 4 }, { label: 'D', marks: 4 }, { label: 'E', marks: 4 },
    ],
  });
  // Sums unchanged from input.
  assert.deepEqual(r.sections.map(leafSum), [6, 6, 6, 4]);
});

test('Phase 4 with sectionTolerance=0 hits the prescribed split exactly (Languages)', () => {
  // The 2026-05 teacher review made Languages section marks a "must be
  // exact" criterion (no ±1 tolerance). Reproduces the live-failing
  // 24/10/3/13 vs CAPS 20/10/5/15 case.
  const r = fixture([
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2], // A: 24
    [2, 2, 2, 2, 2],                       // B: 10
    [1, 1, 1],                             // C: 3
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], // D: 13
  ]);
  rebalanceMarks(r, {
    prescribedSectionMarks: [
      { label: 'A', marks: 20 }, { label: 'B', marks: 10 },
      { label: 'C', marks: 5 },  { label: 'D', marks: 15 },
    ],
    sectionTolerance: 0,
  });
  // EXACT match — no ±1 wiggle.
  assert.deepEqual(r.sections.map(leafSum), [20, 10, 5, 15]);
});

test('Phase 4 preserves cog distribution when same-cog swaps available', () => {
  // Two sections, both single-cog; swap should preserve cog totals.
  const r = fixture([
    [2, 2, 2], // A: 6 (target 4 — over)
    [1, 1],    // B: 2 (target 4 — under)
  ]);
  rebalanceMarks(r, {
    prescribedSectionMarks: [{ label: 'A', marks: 4 }, { label: 'B', marks: 4 }],
  });
  // A within ±1 of 4, B within ±1 of 4. Total preserved at 8.
  assert.ok(Math.abs(leafSum(r.sections[0]) - 4) <= 1);
  assert.ok(Math.abs(leafSum(r.sections[1]) - 4) <= 1);
  assert.equal(leafSum(r.sections[0]) + leafSum(r.sections[1]), 8);
});
