// Tests for lib/auto-fix.js — deterministic AUTO_FIX repairs run
// before the pre-delivery gate.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  shuffleMcqLabels,
  stripPhantomMemoRows,
  repairMemoMarks,
  runAutoFixes,
  _FIXES,
} from '../lib/auto-fix.js';
import { runPreDeliveryGate, buildInvariantContext } from '../lib/invariants.js';

// ─── helpers ────────────────────────────────────────────────────────────

function gateCtx(overrides = {}) {
  return buildInvariantContext({
    paper: '',
    memo:  '',
    plan: { questions: [] },
    language: 'English',
    subject: 'Mathematics',
    resourceType: 'Test',
    totalMarks: 5,
    grade: 4,
    cog: { levels: ['Knowledge', 'Routine Procedures', 'Complex Procedures', 'Problem Solving'], pcts: [30, 40, 20, 10] },
    cogMarks: [2, 2, 1, 0],
    cogTolerance: 1,
    pipeline: 'standard',
    ...overrides,
  });
}

// Build a 5-question MCQ paper with a known correct option per question.
function buildMcqPaper() {
  return [
    '1.1 What is 2+2? (1)', 'a. one', 'b. two', 'c. four', 'd. eight',
    '2.1 What is 3+3? (1)', 'a. five', 'b. six', 'c. seven', 'd. nine',
    '3.1 What is 4+4? (1)', 'a. seven', 'b. eight', 'c. nine', 'd. ten',
    '4.1 What is 5+5? (1)', 'a. nine', 'b. ten', 'c. eleven', 'd. twelve',
    '5.1 What is 6+6? (1)', 'a. ten', 'b. eleven', 'c. twelve', 'd. fourteen',
  ].join('\n');
}

function buildMcqMemo(letters) {
  // letters is e.g. ['C','C','C','C','C'] — one per question 1.1..5.1
  const rows = [
    '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
    '|---|---|---|---|---|',
  ];
  for (let i = 0; i < letters.length; i++) {
    rows.push(`| ${i + 1}.1 | ${letters[i]} | accept | Knowledge | 1 |`);
  }
  return rows.join('\n');
}

// ─── shuffleMcqLabels ───────────────────────────────────────────────────

describe('auto-fix — shuffleMcqLabels', () => {
  test('does nothing when there are fewer than 4 MCQ questions', () => {
    const paper = '1.1 q? (1)\na. x\nb. y\nc. z\nd. w';
    const memo  = '| 1.1 | A | g | Knowledge | 1 |';
    assert.equal(shuffleMcqLabels({ paper, memo }), null);
  });

  test('does nothing when distribution is already balanced', () => {
    const paper = buildMcqPaper();
    const memo  = buildMcqMemo(['A', 'B', 'C', 'D', 'A']);
    assert.equal(shuffleMcqLabels({ paper, memo }), null);
  });

  test('redistributes when one letter dominates', () => {
    const paper = buildMcqPaper();
    const memo  = buildMcqMemo(['C', 'C', 'C', 'C', 'C']);
    const r = shuffleMcqLabels({ paper, memo });
    assert.ok(r, 'expected shuffle to fire on 5/5 same-letter');

    // Re-derive the new answer letters from the updated memo and assert
    // no letter takes more than 60% of the questions.
    const newLetters = [...r.memo.matchAll(/^\s*\|\s*\d+\.\d+\s*\|\s*([A-D])\b/gm)].map((m) => m[1]);
    assert.equal(newLetters.length, 5);
    const counts = { A: 0, B: 0, C: 0, D: 0 };
    for (const L of newLetters) counts[L]++;
    const max = Math.max(...Object.values(counts));
    assert.ok(max <= Math.ceil(5 * 0.6), `still skewed after shuffle: ${JSON.stringify(counts)}`);
  });

  test('preserves option text content (only labels swap)', () => {
    const paper = buildMcqPaper();
    const memo  = buildMcqMemo(['C', 'C', 'C', 'C', 'C']);
    const r = shuffleMcqLabels({ paper, memo });
    // The set of option texts per question must be unchanged.
    const before = paper.split('\n').filter((l) => /^[a-d]\./.test(l)).map((l) => l.slice(2).trim()).sort();
    const after  = r.paper.split('\n').filter((l) => /^[a-d]\./.test(l)).map((l) => l.slice(2).trim()).sort();
    assert.deepEqual(after, before);
  });

  test('clears mcq_distribution_balanced gate failure end-to-end', () => {
    const paper = buildMcqPaper();
    const memo  = buildMcqMemo(['C', 'C', 'C', 'C', 'C']);
    const before = runPreDeliveryGate(gateCtx({ paper, memo, totalMarks: 5 }));
    assert.ok(before.failures.some((f) => f.id === 'mcq_distribution_balanced'));
    const r = shuffleMcqLabels({ paper, memo });
    const after = runPreDeliveryGate(gateCtx({ paper: r.paper, memo: r.memo, totalMarks: 5 }));
    assert.equal(after.failures.some((f) => f.id === 'mcq_distribution_balanced'), false);
  });

  test('memo answer letters are updated to match swapped paper labels', () => {
    const paper = buildMcqPaper();
    const memo  = buildMcqMemo(['C', 'C', 'C', 'C', 'C']);
    const r = shuffleMcqLabels({ paper, memo });
    // Cross-check: each memo answer letter must point at an option that
    // now exists in the corresponding paper question with the SAME text
    // it had before the shuffle.
    const oldOptions = new Map(); // q → { A: text, ... }
    for (const block of paper.split(/\n(?=\d+\.\d+\s)/)) {
      const m = /^(\d+\.\d+)/.exec(block);
      if (!m) continue;
      const opts = {};
      for (const L of ['a', 'b', 'c', 'd']) {
        const om = new RegExp(`^${L}\\.\\s+(.+)$`, 'm').exec(block);
        if (om) opts[L.toUpperCase()] = om[1].trim();
      }
      oldOptions.set(m[1], opts);
    }
    const memoAnswers = new Map(
      [...r.memo.matchAll(/^\s*\|\s*(\d+\.\d+)\s*\|\s*([A-D])\b/gm)].map((m) => [m[1], m[2]]),
    );
    for (const [q, newLetter] of memoAnswers) {
      // The text under the new letter in the SHUFFLED paper must equal
      // the text that was under C in the ORIGINAL paper (since memo
      // said C for every question).
      const newPaperOptionRe = new RegExp(`^${newLetter.toLowerCase()}\\.\\s+(.+)$`, 'm');
      const block = r.paper.split(/\n(?=\d+\.\d+\s)/).find((b) => b.startsWith(q));
      const newText = newPaperOptionRe.exec(block)[1].trim();
      assert.equal(newText, oldOptions.get(q).C);
    }
  });
});

// ─── stripPhantomMemoRows ───────────────────────────────────────────────

describe('auto-fix — stripPhantomMemoRows', () => {
  test('removes rows whose number is not in the paper', () => {
    const paper = '1.1 q (5)\n1.2 q (5)';
    const memo  = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | a | g | Knowledge | 5 |',
      '| 9.9 | phantom | g | Knowledge | 0 |',
      '| 1.2 | a | g | Knowledge | 5 |',
    ].join('\n');
    const r = stripPhantomMemoRows({ paper, memo });
    assert.ok(r);
    assert.doesNotMatch(r.memo, /9\.9/);
    assert.match(r.memo, /\| 1\.1 \|/);
    assert.match(r.memo, /\| 1\.2 \|/);
  });

  test('removes apology rows even if their number is valid', () => {
    const paper = '1.1 q (5)';
    const memo  = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | I cannot generate this | g | Knowledge | 5 |',
    ].join('\n');
    const r = stripPhantomMemoRows({ paper, memo });
    assert.ok(r);
    assert.doesNotMatch(r.memo, /I cannot generate/);
  });

  test('does not strip valid sub-letter rows (1.1a) when 1.1 exists in paper', () => {
    const paper = '1.1 q (5)';
    const memo  = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1a | a | g | Knowledge | 3 |',
      '| 1.1b | b | g | Knowledge | 2 |',
    ].join('\n');
    assert.equal(stripPhantomMemoRows({ paper, memo }), null);
  });

  test('preserves Content Point rows (RTT Section C)', () => {
    const paper = '1.1 q (5)';
    const memo  = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| Content Point 1 | x | g | Reorganisation | 1 |',
      '| Content Point 2 | y | g | Reorganisation | 1 |',
    ].join('\n');
    assert.equal(stripPhantomMemoRows({ paper, memo }), null);
  });

  test('returns null when the memo has no phantom or apology rows', () => {
    const paper = '1.1 q (5)';
    const memo  = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | a | g | Knowledge | 5 |',
    ].join('\n');
    assert.equal(stripPhantomMemoRows({ paper, memo }), null);
  });
});

// ─── repairMemoMarks ────────────────────────────────────────────────────

describe('auto-fix — repairMemoMarks', () => {
  test('snaps memo mark cell to paper (X) when they disagree', () => {
    const paper = '1.1 q (5)\n1.2 q (3)';
    const memo  = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | a | g | Knowledge | 4 |',
      '| 1.2 | a | g | Knowledge | 2 |',
    ].join('\n');
    const r = repairMemoMarks({ paper, memo });
    assert.ok(r);
    assert.match(r.memo, /\| 1\.1 \| a \| g \| Knowledge \| 5 \|/);
    assert.match(r.memo, /\| 1\.2 \| a \| g \| Knowledge \| 3 \|/);
  });

  test('returns null when every memo mark already matches', () => {
    const paper = '1.1 q (5)\n1.2 q (3)';
    const memo  = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | a | g | Knowledge | 5 |',
      '| 1.2 | a | g | Knowledge | 3 |',
    ].join('\n');
    assert.equal(repairMemoMarks({ paper, memo }), null);
  });

  test('matches sub-letter memo rows to their parent paper sub-question', () => {
    const paper = '1.1 q (5)';
    const memo  = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1a | a | g | Knowledge | 9 |',
    ].join('\n');
    const r = repairMemoMarks({ paper, memo });
    assert.ok(r);
    assert.match(r.memo, /\| 1\.1a \| a \| g \| Knowledge \| 5 \|/);
  });
});

// ─── runAutoFixes orchestrator ──────────────────────────────────────────

describe('auto-fix — runAutoFixes', () => {
  test('returns empty applied list when nothing fires', () => {
    const r = runAutoFixes({ paper: '1.1 q (5)', memo: '| 1.1 | a | g | Knowledge | 5 |' });
    assert.deepEqual(r.applied, []);
  });

  test('applies multiple fixes in order, accumulating updates', () => {
    const paper = '1.1 q (5)\n1.2 q (3)';
    const memo  = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | a | g | Knowledge | 9 |',  // wrong mark
      '| 9.9 | phantom | g | Knowledge | 0 |',  // phantom
      '| 1.2 | a | g | Knowledge | 3 |',
    ].join('\n');
    const r = runAutoFixes({ paper, memo });
    assert.ok(r.applied.includes('phantom_memo_rows'));
    assert.ok(r.applied.includes('memo_marks'));
    assert.doesNotMatch(r.ctx.memo, /9\.9/);
    assert.match(r.ctx.memo, /\| 1\.1 \| a \| g \| Knowledge \| 5 \|/);
  });

  test('fix that throws is logged and skipped (does not abort the runner)', () => {
    const warns = [];
    const logger = { warn: (...a) => warns.push(a), info: () => {} };
    // Pass a ctx that crashes one of the fixes: a non-string memo.
    // (The fixes themselves guard against this, so we synthesise a
    // malformed shape instead — null paper + a memo with a getter.)
    const evilCtx = { paper: '1.1 q (5)' };
    Object.defineProperty(evilCtx, 'memo', {
      get() { throw new Error('boom'); },
      configurable: true,
    });
    const r = runAutoFixes(evilCtx, { logger });
    // The runner should not throw; applied may be empty since every
    // fix sees the throwing getter.
    assert.ok(Array.isArray(r.applied));
    assert.ok(warns.length >= 1, 'expected at least one warn from a thrown fix');
  });

  test('FIXES array exposes ordering for fuzz/diagnostic introspection', () => {
    const ids = _FIXES.map((f) => f.id);
    assert.deepEqual(ids, ['section_brackets', 'paper_footer', 'phantom_memo_rows', 'memo_marks', 'cog_analysis_actuals', 'mcq_label_shuffle']);
  });
});

// ─── end-to-end gate integration ────────────────────────────────────────

describe('auto-fix — end-to-end with the gate', () => {
  test('runAutoFixes followed by gate clears phantom_memo_rows + paper_marks_match_memo_marks', () => {
    const paper = '1.1 q (5)\n1.2 q (3)';
    const memo  = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | a | g | Knowledge | 9 |',
      '| 9.9 | phantom | g | Knowledge | 0 |',
      '| 1.2 | a | g | Knowledge | 3 |',
      '',
      'COGNITIVE LEVEL ANALYSIS',
      '| Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual % |',
      '|---|---|---|---|---|',
      '| Knowledge | 30% | 2 | 8 | 100.0% |',
      '| Routine Procedures | 40% | 2 | 0 | 0.0% |',
      '| Complex Procedures | 20% | 1 | 0 | 0.0% |',
      '| Problem Solving | 10% | 0 | 0 | 0.0% |',
      '| TOTAL | 100% | 5 | 8 | 100.0% |',
    ].join('\n');
    const before = runPreDeliveryGate(gateCtx({ paper, memo, totalMarks: 8 }));
    const ids0 = before.failures.map((f) => f.id);
    assert.ok(ids0.includes('no_phantom_memo_rows'));
    assert.ok(ids0.includes('paper_marks_match_memo_marks'));

    const r = runAutoFixes({ paper, memo });
    const after = runPreDeliveryGate(gateCtx({ paper: r.ctx.paper, memo: r.ctx.memo, totalMarks: 8 }));
    const ids1 = after.failures.map((f) => f.id);
    assert.equal(ids1.includes('no_phantom_memo_rows'), false, `still failing: ${ids1.join(', ')}`);
    assert.equal(ids1.includes('paper_marks_match_memo_marks'), false);
  });
});
