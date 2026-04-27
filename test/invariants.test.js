// Tests for lib/invariants.js — the pre-delivery gate runner.
//
// Coverage strategy: for each invariant, exercise BOTH a pass case (a
// known-good fragment that should not trigger) and a fail case (a
// minimal known-bad fragment that should trigger with the right id).
// We don't assert on every detail field; just on the failure id and the
// presence of `feedback` (since the regeneration plumbing depends on it).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  INVARIANTS,
  CATEGORIES,
  SCOPES,
  runInvariants,
  runPreDeliveryGate,
  buildInvariantContext,
  InvariantGateError,
} from '../lib/invariants.js';

// ─── helpers ────────────────────────────────────────────────────────────

function findFailure(failures, id) {
  return failures.find((f) => f.id === id) || null;
}

function ctx(overrides = {}) {
  return buildInvariantContext({
    paper: '',
    memo: '',
    plan: { questions: [] },
    language: 'English',
    subject: 'Mathematics',
    resourceType: 'Test',
    totalMarks: 50,
    cog: { levels: ['Knowledge', 'Routine Procedures', 'Complex Procedures', 'Problem Solving'], pcts: [30, 40, 20, 10] },
    cogMarks: [15, 20, 10, 5],
    cogTolerance: 1,
    pipeline: 'standard',
    ...overrides,
  });
}

// ─── runner & gate ───────────────────────────────────────────────────────

describe('Invariants — runner core', () => {
  test('all 6 AUTO_FIX, 26 REGENERATE, 3 DEV_ONLY invariants registered', () => {
    const byCat = INVARIANTS.reduce((a, i) => { a[i.category] = (a[i.category] || 0) + 1; return a; }, {});
    assert.equal(byCat[CATEGORIES.AUTO_FIX], 6);
    assert.equal(byCat[CATEGORIES.REGENERATE], 26);
    assert.equal(byCat[CATEGORIES.DEV_ONLY], 3);
  });

  test('every invariant has stable id, valid category, valid scope', () => {
    const ids = new Set();
    for (const inv of INVARIANTS) {
      assert.ok(inv.id && typeof inv.id === 'string', `bad id: ${JSON.stringify(inv)}`);
      assert.ok(!ids.has(inv.id), `duplicate id ${inv.id}`);
      ids.add(inv.id);
      assert.ok(Object.values(CATEGORIES).includes(inv.category), `bad category on ${inv.id}`);
      assert.ok(Object.values(SCOPES).includes(inv.scope), `bad scope on ${inv.id}`);
      assert.equal(typeof inv.check, 'function');
    }
  });

  test('every REGENERATE invariant declares regeneratePhase', () => {
    for (const inv of INVARIANTS) {
      if (inv.category !== CATEGORIES.REGENERATE) continue;
      assert.ok(['plan', 'paper', 'memo'].includes(inv.regeneratePhase),
        `${inv.id} must declare regeneratePhase`);
    }
  });

  test('empty context yields zero failures', () => {
    const failures = runInvariants(ctx());
    assert.equal(failures.length, 0, `unexpected failures: ${failures.map((f) => f.id).join(', ')}`);
  });

  test('runPreDeliveryGate report-mode never throws', () => {
    const r = runPreDeliveryGate(ctx({ paper: 'broken' }), { mode: 'report' });
    assert.equal(typeof r.passed, 'boolean');
    assert.equal(r.mode, 'report');
  });

  test('runPreDeliveryGate enforce-mode throws InvariantGateError on blocking failure', () => {
    // Memo missing answer table → REGENERATE failure → blocking in enforce.
    const c = ctx({
      paper: '1.1 What is 2+2? (1)\n_______________________________________________\n',
      memo: 'Some memo without an answer table',
      totalMarks: 1,
    });
    assert.throws(
      () => runPreDeliveryGate(c, { mode: 'enforce' }),
      (err) => err instanceof InvariantGateError && err.code === 'INVARIANT_GATE_BLOCKED',
    );
  });

  test('runPreDeliveryGate enforce-mode does NOT throw on DEV_ONLY-only failures', () => {
    // mark_scope_discipline is DEV_ONLY — even if it triggers, gate passes.
    // We craft a paper that ONLY trips mark_scope_discipline.
    const paper = [
      '1.1 List five reasons. (1)',
      '_______________________________________________',
      '',
      'TOTAL: 1 marks',
    ].join('\n');
    const memo = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | reasons | accept any reasonable | Knowledge | 1 |',
      '',
      'COGNITIVE LEVEL ANALYSIS',
      '| Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual % |',
      '|---|---|---|---|---|',
      '| Knowledge | 30% | 0 | 1 | 100.0% |',
      '| Routine Procedures | 40% | 1 | 0 | 0.0% |',
      '| Complex Procedures | 20% | 0 | 0 | 0.0% |',
      '| Problem Solving | 10% | 0 | 0 | 0.0% |',
      '| TOTAL | 100% | 1 | 1 | 100.0% |',
    ].join('\n');
    const r = runPreDeliveryGate(ctx({ paper, memo, totalMarks: 1, cogMarks: [0, 1, 0, 0] }), { mode: 'enforce' });
    assert.equal(r.passed, true, `unexpected blocking: ${r.blocking.map((f) => f.id).join(', ')}`);
  });

  test('check exceptions are caught and surfaced as synthetic failures', () => {
    // Inject a getter that throws when an invariant reads ctx.paper.
    // Object.defineProperty avoids triggering the getter at construction
    // time (which Object.assign + spread would do).
    const evilCtx = ctx();
    Object.defineProperty(evilCtx, 'paper', {
      get() { throw new Error('boom'); },
      configurable: true,
    });
    const failures = runInvariants(evilCtx);
    assert.ok(Array.isArray(failures));
    // At least one failure should carry the synthetic `error: true` flag.
    assert.ok(failures.some((f) => f.error === true), 'expected synthetic-error failure');
  });

  test('skipIds option filters out specific invariants', () => {
    const c = ctx({ memo: 'no answer table here', paper: '1.1 q (1)' });
    const all = runInvariants(c);
    const skipped = runInvariants(c, { skipIds: ['memo_has_answer_table'] });
    assert.ok(all.some((f) => f.id === 'memo_has_answer_table'));
    assert.ok(!skipped.some((f) => f.id === 'memo_has_answer_table'));
  });
});

// ─── mark arithmetic ─────────────────────────────────────────────────────

describe('Invariants — mark arithmetic', () => {
  test('cover_eq_body fails when body sums to wrong total', () => {
    const paper = '1.1 q (3)\n1.2 q (3)\nTOTAL: 10 marks';
    const f = findFailure(runInvariants(ctx({ paper, totalMarks: 10 })), 'cover_eq_body');
    assert.ok(f, 'expected cover_eq_body to fail');
    assert.equal(f.counted, 6);
    assert.ok(f.feedback.includes('exactly 10'));
  });

  test('cover_eq_body passes when body matches', () => {
    const paper = '1.1 q (5)\n1.2 q (5)\nTOTAL: 10 marks';
    assert.equal(findFailure(runInvariants(ctx({ paper, totalMarks: 10 })), 'cover_eq_body'), null);
  });

  test('footer_matches_cover fails when footer != cover', () => {
    const paper = '1.1 q (10)\nTOTAL: 47 marks';
    const f = findFailure(runInvariants(ctx({ paper, totalMarks: 50 })), 'footer_matches_cover');
    assert.ok(f);
    assert.equal(f.footer, 47);
  });

  test('section_brackets_sum_to_total fails when blocks misalign', () => {
    const paper = 'SECTION A\n1.1 q (10)\n[10]\nSECTION B\n2.1 q (5)\n[10]\nTOTAL: 50 marks';
    const f = findFailure(runInvariants(ctx({ paper, totalMarks: 50 })), 'section_brackets_sum_to_total');
    assert.ok(f);
    assert.equal(f.sum, 20);
  });

  test('section_brackets_sum_to_total does not double-count [N] in section headers', () => {
    // "SECTION A [10]" has [10] embedded — must not be counted alongside the
    // standalone [10] block-total line that follows the section body.
    const paper = 'SECTION A [10]\n1.1 q (5)\n1.2 q (5)\n[10]\nTOTAL: 10 marks';
    assert.equal(findFailure(runInvariants(ctx({ paper, totalMarks: 10 })), 'section_brackets_sum_to_total'), null);
  });

  test('paper_marks_match_memo_marks fails when memo total ≠ paper total', () => {
    const paper = '1.1 q (5)\n1.2 q (5)\nTOTAL: 10 marks';
    const memo = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | a | g | Knowledge | 5 |',
      '| 1.2 | a | g | Knowledge | 4 |',
    ].join('\n');
    const f = findFailure(runInvariants(ctx({ paper, memo, totalMarks: 10 })), 'paper_marks_match_memo_marks');
    assert.ok(f);
    assert.equal(f.memoSum, 9);
    assert.equal(f.paperCount, 10);
  });
});

// ─── structure ────────────────────────────────────────────────────────────

describe('Invariants — structure', () => {
  test('section_letters_sequential flags A → C gap', () => {
    const paper = 'SECTION A: x\n1.1 q (5)\n[5]\nSECTION C: y\n2.1 q (5)\n[5]';
    const f = findFailure(runInvariants(ctx({ paper, totalMarks: 10 })), 'section_letters_sequential');
    assert.ok(f);
    assert.deepEqual(f.replacements, [{ from: 'C', to: 'B' }]);
  });

  test('single_memorandum_banner flags duplicate banners', () => {
    const memo = 'MEMORANDUM\n\nMEMORANDUM\n\n| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |\n|---|---|---|---|---|\n| 1.1 | a | g | Knowledge | 1 |';
    const f = findFailure(runInvariants(ctx({ memo })), 'single_memorandum_banner');
    assert.ok(f);
    assert.equal(f.count, 2);
  });

  test('no_phantom_memo_rows flags memo rows for missing paper questions', () => {
    const paper = '1.1 q (5)\nTOTAL: 5 marks';
    const memo = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | a | g | Knowledge | 5 |',
      '| 9.9 | phantom | g | Knowledge | 0 |',
    ].join('\n');
    const f = findFailure(runInvariants(ctx({ paper, memo, totalMarks: 5 })), 'no_phantom_memo_rows');
    assert.ok(f);
    assert.deepEqual(f.phantoms, ['9.9']);
  });

  test('answer_space_present flags sub-questions with no space', () => {
    const paper = [
      '1.1 What is the capital of South Africa? (1)',
      '1.2 Explain the water cycle. (4)',
      '_______________________________________________',
      '_______________________________________________',
    ].join('\n');
    const f = findFailure(runInvariants(ctx({ paper, totalMarks: 5 })), 'answer_space_present');
    assert.ok(f);
    assert.deepEqual(f.offenders, ['1.1']);
  });
});

// ─── language / hygiene ───────────────────────────────────────────────────

describe('Invariants — language and hygiene', () => {
  test('no_english_labels_on_afrikaans fires on Afrikaans paper with "Answer:"', () => {
    const paper = '1.1 vraag (1)\nAnswer: _______________________________________________';
    const f = findFailure(runInvariants(ctx({ paper, language: 'Afrikaans' })), 'no_english_labels_on_afrikaans');
    assert.ok(f);
  });

  test('no_english_labels_on_afrikaans does not fire on English papers', () => {
    const paper = '1.1 q (1)\nAnswer: _______________________________________________';
    assert.equal(findFailure(runInvariants(ctx({ paper })), 'no_english_labels_on_afrikaans'), null);
  });

  test('memo_column_headers_match_language flags wrong-language headers', () => {
    const memo = '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |\n|---|---|---|---|---|\n| 1.1 | a | g | Knowledge | 1 |';
    const f = findFailure(runInvariants(ctx({ memo, language: 'Afrikaans' })), 'memo_column_headers_match_language');
    assert.ok(f);
    assert.match(f.feedback, /NR\. \| ANTWOORD/);
  });

  test('no_meta_commentary_leak catches "I cannot" and "Note:"', () => {
    const paper = "SECTION A\n1.1 q (1)\nI cannot generate this question.\nNote: this paper is hard.";
    const f = findFailure(runInvariants(ctx({ paper })), 'no_meta_commentary_leak');
    assert.ok(f);
    assert.ok(f.offenders.length >= 2);
  });

  test('no_meta_commentary_leak catches leaked arithmetic workings', () => {
    const paper = '1.1 q (5)\n1.2 q (5)\nTotal: 5+5+5+5+5=25\nTOTAL: 25 marks';
    const f = findFailure(runInvariants(ctx({ paper, totalMarks: 25 })), 'no_meta_commentary_leak');
    assert.ok(f, 'expected no_meta_commentary_leak to fire on arithmetic workings');
    assert.ok(f.offenders.some((o) => /\d+\+\d+/.test(o)));
  });

  test('no_phantom_apology_rows fires on apology in memo cell', () => {
    const memo = '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |\n|---|---|---|---|---|\n| 1.1 | I cannot generate this | g | Knowledge | 1 |';
    const f = findFailure(runInvariants(ctx({ memo })), 'no_phantom_apology_rows');
    assert.ok(f);
  });

  test('no_in_cell_meta_commentary catches [Note: …] inside cells', () => {
    const memo = '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |\n|---|---|---|---|---|\n| 1.1 | a | [Note: revise wording] | Knowledge | 1 |';
    const f = findFailure(runInvariants(ctx({ memo })), 'no_in_cell_meta_commentary');
    assert.ok(f);
  });

  test('no_in_cell_meta_commentary catches unbracketed NOTE TO MARKER in cells', () => {
    const memo = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | a | NOTE TO MARKER: accept equivalent | Knowledge | 1 |',
    ].join('\n');
    const f = findFailure(runInvariants(ctx({ memo })), 'no_in_cell_meta_commentary');
    assert.ok(f, 'expected no_in_cell_meta_commentary to fire on NOTE TO MARKER');
  });

  test('no_in_cell_meta_commentary catches "appears to be incomplete" in cells', () => {
    const memo = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 2.3 | This question appears to be incomplete | — | Knowledge | 1 |',
    ].join('\n');
    const f = findFailure(runInvariants(ctx({ memo })), 'no_in_cell_meta_commentary');
    assert.ok(f, 'expected no_in_cell_meta_commentary to fire on "appears to be incomplete"');
  });
});

// ─── REGENERATE ──────────────────────────────────────────────────────────

describe('Invariants — REGENERATE', () => {
  test('memo_has_answer_table fires when missing', () => {
    const f = findFailure(runInvariants(ctx({ memo: 'no table here' })), 'memo_has_answer_table');
    assert.ok(f);
    assert.equal(f.category, CATEGORIES.REGENERATE);
    assert.ok(f.feedback);
  });

  test('memo_has_cog_analysis fires when only answer table is present', () => {
    const memo = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | a | g | Knowledge | 1 |',
    ].join('\n');
    const f = findFailure(runInvariants(ctx({ memo })), 'memo_has_cog_analysis');
    assert.ok(f);
  });

  test('memo_row_count_matches_paper fires on big drift', () => {
    const paper = ['1.1 q (1)', '1.2 q (1)', '1.3 q (1)', '1.4 q (1)', '1.5 q (1)'].join('\n');
    const memo = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | a | g | Knowledge | 1 |',
    ].join('\n');
    const f = findFailure(runInvariants(ctx({ paper, memo, totalMarks: 5 })), 'memo_row_count_matches_paper');
    assert.ok(f);
    assert.equal(f.paperRows, 5);
    assert.equal(f.memoRows, 1);
  });

  test('mcq_options_count_correct fires on 3-option MCQ', () => {
    const paper = [
      '1.1 Pick one. (1)',
      'a. apple',
      'b. banana',
      'c. carrot',
      'Answer: ___',
    ].join('\n');
    const f = findFailure(runInvariants(ctx({ paper })), 'mcq_options_count_correct');
    assert.ok(f);
  });

  test('mcq_options_count_correct passes on standard 4-option MCQ', () => {
    const paper = [
      '1.1 Pick one. (1)',
      'a. apple',
      'b. banana',
      'c. carrot',
      'd. date',
      'Answer: ___',
    ].join('\n');
    assert.equal(findFailure(runInvariants(ctx({ paper })), 'mcq_options_count_correct'), null);
  });

  test('mcq_answer_letter_in_options catches answer outside option set', () => {
    const paper = [
      '1.1 Pick one. (1)',
      'a. apple',
      'b. banana',
      'c. carrot',
      'd. date',
    ].join('\n');
    const memo = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | E | g | Knowledge | 1 |',
    ].join('\n');
    const f = findFailure(runInvariants(ctx({ paper, memo })), 'mcq_answer_letter_in_options');
    assert.ok(f);
  });

  test('mcq_no_duplicate_options catches identical option text', () => {
    const paper = [
      '1.1 Pick one. (1)',
      'a. apple',
      'b. apple',
      'c. carrot',
      'd. date',
    ].join('\n');
    const f = findFailure(runInvariants(ctx({ paper })), 'mcq_no_duplicate_options');
    assert.ok(f);
  });
});

// ─── DEV_ONLY ────────────────────────────────────────────────────────────

describe('Invariants — DEV_ONLY', () => {
  test('mark_scope_discipline flags ratio outside [0.5, 2.5]', () => {
    const paper = '1.1 List eight reasons. (1)';
    const f = findFailure(runInvariants(ctx({ paper })), 'mark_scope_discipline');
    assert.ok(f);
    assert.equal(f.category, CATEGORIES.DEV_ONLY);
  });

  test('DEV_ONLY failures never block in enforce mode', () => {
    // Paper must trip mark_scope_discipline (DEV_ONLY) but nothing else.
    // We provide an answer line so answer_space_present passes, and use
    // totalMarks=0 to short-circuit the mark-arithmetic invariants.
    const paper = [
      '1.1 Name eight reasons. (1)',
      '_______________________________________________',
    ].join('\n');
    const r = runPreDeliveryGate(ctx({ paper, totalMarks: 0 }), { mode: 'enforce' });
    assert.equal(r.passed, true, `unexpected blocking: ${r.blocking.map((f) => f.id).join(', ')}`);
    // Confirm the DEV_ONLY check did fire — it just didn't block.
    assert.ok(r.failures.some((f) => f.id === 'mark_scope_discipline'));
  });
});
