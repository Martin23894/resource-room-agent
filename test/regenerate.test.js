// Tests for lib/regenerate.js — the pre-delivery regeneration loop.
//
// We test the orchestrator with stub regenerators (no real Claude calls)
// to exercise the cap, phase ordering, ctx merging, error handling, and
// SSE event emission. The prompt builders are tested as pure functions.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runRegenerationLoop,
  buildPaperRegenPrompts,
  buildMemoRegenPrompts,
  buildPlanRegenAddendum,
  makeClaudeRegenerator,
  REGEN_PHASES,
  DEFAULT_REGEN_CAP,
} from '../lib/regenerate.js';
import { buildInvariantContext } from '../lib/invariants.js';

// ─── helpers ────────────────────────────────────────────────────────────

// Minimal valid memo and paper used as "good" baselines; tests that want
// failures override the relevant artefact with broken text.
const GOOD_PAPER = [
  '1.1 What is 2+2? (1)',
  '_______________________________________________',
  '',
  'TOTAL: 1 marks',
].join('\n');

const GOOD_MEMO = [
  '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
  '|---|---|---|---|---|',
  '| 1.1 | 4 | accept four | Knowledge | 1 |',
  '',
  'COGNITIVE LEVEL ANALYSIS',
  '| Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual % |',
  '|---|---|---|---|---|',
  '| Knowledge | 30% | 0 | 1 | 100.0% |',
  '| Routine Procedures | 40% | 1 | 0 | 0.0% |',
  '| Complex Procedures | 20% | 0 | 0 | 0.0% |',
  '| Problem Solving | 10% | 0 | 0 | 0.0% |',
  '| TOTAL | 100% | 1 | 1 | 100% |',
].join('\n');

function ctx(overrides = {}) {
  return buildInvariantContext({
    paper: GOOD_PAPER,
    memo:  GOOD_MEMO,
    plan:  { questions: [] },
    language: 'English',
    subject: 'Mathematics',
    resourceType: 'Test',
    totalMarks: 1,
    grade: 4,
    cog: { levels: ['Knowledge', 'Routine Procedures', 'Complex Procedures', 'Problem Solving'], pcts: [30, 40, 20, 10] },
    cogMarks: [0, 1, 0, 0],
    cogTolerance: 1,
    pipeline: 'standard',
    ...overrides,
  });
}

// SSE channel stub. Records every sendPhase call so tests can inspect the
// telemetry sequence the loop emits.
function makeChannel() {
  const events = [];
  return {
    events,
    sendPhase(name, status, data) { events.push({ name, status, data }); },
  };
}

// ─── prompt builders ────────────────────────────────────────────────────

describe('regenerate — prompt builders', () => {
  test('buildPaperRegenPrompts renders failures and current paper', () => {
    const failures = [
      { id: 'cover_eq_body', feedback: 'body sums to 47, must be 50' },
      { id: 'mcq_options_count_correct', feedback: 'Q3.1 has 3 options' },
    ];
    const { system, user } = buildPaperRegenPrompts(failures, ctx({
      grade: 7, subject: 'EMS', resourceType: 'Exam', language: 'English',
      paper: 'PAPER_BODY',
    }));
    assert.match(system, /Grade 7 EMS Exam/);
    assert.match(system, /English/);
    assert.match(system, /Edit ONLY the parts the failures call out/);
    assert.match(user, /failed 2 pre-delivery invariant/);
    assert.match(user, /\[cover_eq_body\] body sums to 47/);
    assert.match(user, /\[mcq_options_count_correct\] Q3.1 has 3 options/);
    assert.match(user, /CURRENT PAPER:\nPAPER_BODY/);
  });

  test('buildPaperRegenPrompts falls back to message when feedback missing', () => {
    const { user } = buildPaperRegenPrompts(
      [{ id: 'foo', message: 'fallback message' }],
      ctx(),
    );
    assert.match(user, /\[foo\] fallback message/);
  });

  test('buildMemoRegenPrompts puts paper in system, memo in user', () => {
    const { system, user } = buildMemoRegenPrompts(
      [{ id: 'memo_has_answer_table', feedback: 'no answer table' }],
      ctx({ paper: 'PAPER_REF', memo: 'BROKEN_MEMO', language: 'English' }),
    );
    assert.match(system, /PAPER \(for reference — do NOT modify\):\nPAPER_REF/);
    assert.match(system, /\| NO\. \| ANSWER/);
    assert.match(user, /CURRENT MEMORANDUM:\nBROKEN_MEMO/);
  });

  test('buildMemoRegenPrompts switches header for Afrikaans', () => {
    const { system } = buildMemoRegenPrompts(
      [{ id: 'memo_has_answer_table', feedback: 'x' }],
      ctx({ language: 'Afrikaans' }),
    );
    assert.match(system, /\| NR\. \| ANTWOORD \| MERKINGSRIGLYNE/);
    assert.doesNotMatch(system, /\| NO\. \| ANSWER \|/);
  });

  test('buildPlanRegenAddendum lists feedback as numbered correction context', () => {
    const a = buildPlanRegenAddendum([
      { feedback: 'topic X covers 6/10 questions' },
      { feedback: 'no diversity' },
    ]);
    assert.match(a, /CORRECTION CONTEXT/);
    assert.match(a, /1\. topic X covers 6\/10 questions/);
    assert.match(a, /2\. no diversity/);
  });
});

// ─── orchestrator ───────────────────────────────────────────────────────

describe('regenerate — runRegenerationLoop', () => {
  test('returns immediately when initial gate passes', async () => {
    const channel = makeChannel();
    const memoRegen = async () => { throw new Error('should not be called'); };
    const r = await runRegenerationLoop({
      ctx: ctx(),
      regenerators: { memo: memoRegen },
      channel,
    });
    assert.equal(r.gate.passed, true);
    assert.deepEqual(r.attemptsByPhase, { plan: 0, paper: 0, memo: 0 });
    assert.deepEqual(r.capExhausted, []);
    // No regenerate.* events emitted on a clean initial gate.
    assert.equal(channel.events.filter((e) => /^regenerate\./.test(e.name)).length, 0);
  });

  test('memo regenerator runs once and clears the failure', async () => {
    const broken = ctx({ memo: 'no table here at all' });
    const channel = makeChannel();
    let calls = 0;
    const memoRegen = async (failures, c) => {
      calls++;
      assert.ok(failures.some((f) => f.id === 'memo_has_answer_table'));
      assert.equal(c.memo, 'no table here at all');
      // Return the GOOD memo so the gate clears.
      return { memo: GOOD_MEMO };
    };
    const r = await runRegenerationLoop({
      ctx: broken,
      regenerators: { memo: memoRegen },
      channel,
    });
    assert.equal(calls, 1);
    assert.equal(r.gate.passed, true);
    assert.equal(r.attemptsByPhase.memo, 1);
    assert.deepEqual(r.capExhausted, []);
    assert.equal(r.ctx.memo, GOOD_MEMO);
    // SSE: attempt + attempt_done + done emitted.
    const memoEvents = channel.events.filter((e) => e.name === 'regenerate.memo');
    assert.deepEqual(memoEvents.map((e) => e.status), ['attempt', 'attempt_done', 'done']);
    assert.equal(memoEvents[0].data.n, 1);
    assert.equal(memoEvents[0].data.cap, DEFAULT_REGEN_CAP);
  });

  test('cap is enforced — regenerator that never fixes the issue stops at cap', async () => {
    const broken = ctx({ memo: 'still broken' });
    const channel = makeChannel();
    let calls = 0;
    const memoRegen = async () => {
      calls++;
      return { memo: 'still broken too' }; // never fixes anything
    };
    const r = await runRegenerationLoop({
      ctx: broken,
      regenerators: { memo: memoRegen },
      cap: 2,
      channel,
    });
    assert.equal(calls, 2, 'expected exactly 2 regen attempts (cap=2)');
    assert.equal(r.gate.passed, false);
    assert.equal(r.attemptsByPhase.memo, 2);
    assert.deepEqual(r.capExhausted, ['memo']);
    // SSE: cap_exhausted emitted after the 2nd attempt fails to clear.
    const statuses = channel.events
      .filter((e) => e.name === 'regenerate.memo')
      .map((e) => e.status);
    assert.deepEqual(statuses, ['attempt', 'attempt_done', 'attempt', 'attempt_done', 'cap_exhausted']);
  });

  test('cap from env INVARIANT_GATE_MAX_REGEN_ATTEMPTS is honoured', async () => {
    const orig = process.env.INVARIANT_GATE_MAX_REGEN_ATTEMPTS;
    process.env.INVARIANT_GATE_MAX_REGEN_ATTEMPTS = '1';
    try {
      let calls = 0;
      const r = await runRegenerationLoop({
        ctx: ctx({ memo: 'broken' }),
        regenerators: {
          memo: async () => { calls++; return { memo: 'still broken' }; },
        },
      });
      assert.equal(calls, 1);
      assert.equal(r.attemptsByPhase.memo, 1);
    } finally {
      if (orig === undefined) delete process.env.INVARIANT_GATE_MAX_REGEN_ATTEMPTS;
      else process.env.INVARIANT_GATE_MAX_REGEN_ATTEMPTS = orig;
    }
  });

  test('phases run in order: plan → paper → memo', async () => {
    const order = [];
    // resource_type_matches_content fires when resourceType='Investigation'
    // and the paper has no "Investigation" heading — that's a paper-phase
    // REGENERATE failure. Combine with a broken memo for memo-phase. We
    // expect paper to run before memo.
    const broken = ctx({
      resourceType: 'Investigation',
      paper:        GOOD_PAPER, // no "Investigation" heading
      memo:         'no table',
    });
    const r = await runRegenerationLoop({
      ctx: broken,
      regenerators: {
        paper: async () => {
          order.push('paper');
          return { paper: 'Investigation\n' + GOOD_PAPER };
        },
        memo: async () => { order.push('memo'); return { memo: GOOD_MEMO }; },
      },
    });
    assert.deepEqual(order, ['paper', 'memo']);
    assert.equal(r.gate.passed, true);
  });

  test('regenerator throw aborts that phase but does not crash the loop', async () => {
    const channel = makeChannel();
    const r = await runRegenerationLoop({
      ctx: ctx({ memo: 'broken' }),
      regenerators: {
        memo: async () => { throw new Error('boom'); },
      },
      channel,
    });
    assert.equal(r.gate.passed, false);
    assert.equal(r.attemptsByPhase.memo, 1);
    const failed = channel.events.find((e) => e.name === 'regenerate.memo' && e.status === 'failed');
    assert.ok(failed, 'expected regenerate.memo failed event');
    assert.equal(failed.data.error, 'boom');
  });

  test('AbortError is re-thrown so the caller can short-circuit', async () => {
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      runRegenerationLoop({
        ctx: ctx({ memo: 'broken' }),
        regenerators: {
          memo: async () => {
            const e = new Error('aborted');
            e.code = 'ABORTED';
            throw e;
          },
        },
        signal: ac.signal,
      }),
      /aborted/,
    );
  });

  test('updates outside the whitelist are ignored', async () => {
    // A buggy regenerator that returns a forbidden field shouldn't be
    // able to mutate cogMarks or totalMarks on the ctx.
    const broken = ctx({ memo: 'broken' });
    const r = await runRegenerationLoop({
      ctx: broken,
      regenerators: {
        memo: async () => ({ memo: GOOD_MEMO, totalMarks: 999, cogMarks: [99, 99, 99, 99] }),
      },
    });
    assert.equal(r.ctx.totalMarks, broken.totalMarks);
    assert.deepEqual(r.ctx.cogMarks, broken.cogMarks);
    assert.equal(r.ctx.memo, GOOD_MEMO);
  });

  test('REGEN_PHASES exposes the canonical order', () => {
    assert.deepEqual(REGEN_PHASES, ['plan', 'paper', 'memo']);
  });
});

// ─── makeClaudeRegenerator ──────────────────────────────────────────────

describe('regenerate — makeClaudeRegenerator', () => {
  test('paper regenerator wires through callClaude + cleanFn', async () => {
    let receivedSys, receivedUsr, receivedTok;
    const callClaude = async (sys, usr, tok) => {
      receivedSys = sys; receivedUsr = usr; receivedTok = tok;
      return '  RAW_CLAUDE_OUTPUT  ';
    };
    const cleanFn = (raw) => raw.trim().toLowerCase();
    const regen = makeClaudeRegenerator({ callClaude, cleanFn, maxTokens: 4000, phase: 'paper' });
    const result = await regen(
      [{ id: 'cover_eq_body', feedback: 'fix the marks' }],
      ctx({ paper: 'PAPER_TEXT' }),
    );
    assert.match(receivedSys, /correcting specific verified flaws.*question paper/);
    assert.match(receivedUsr, /CURRENT PAPER:\nPAPER_TEXT/);
    assert.equal(receivedTok, 4000);
    assert.deepEqual(result, { paper: 'raw_claude_output' });
  });

  test('memo regenerator returns { memo } shape', async () => {
    const callClaude = async () => 'MEMO_OUTPUT';
    const regen = makeClaudeRegenerator({ callClaude, phase: 'memo' });
    const r = await regen([{ id: 'memo_has_answer_table', feedback: 'x' }], ctx());
    assert.deepEqual(r, { memo: 'MEMO_OUTPUT' });
  });

  test('rejects unsupported phases', () => {
    assert.throws(
      () => makeClaudeRegenerator({ callClaude: async () => '', phase: 'plan' }),
      /unsupported phase/,
    );
  });
});
