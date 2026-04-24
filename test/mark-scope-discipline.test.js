// Regression tests for the "MARK vs SCOPE DISCIPLINE" rule in qSys.
//
// Pattern observed across multiple generated papers: the plan correctly
// assigns a high cognitive level to a low-mark question, and the paper
// writer compresses several instruction verbs ("identify X, explain Y,
// evaluate Z, justify W") into a single 2-mark prompt. Impossible to mark
// fairly and pedagogically wrong.
//
// Fix is in the system prompt — this test verifies the rule is present
// and covers the specific verbs / mark floors we care about, so a future
// prompt edit can't silently remove them.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompts } from '../lib/prompts.js';

function qSysFor(overrides = {}) {
  const ctx = {
    subject: 'Mathematics', topic: 'Fractions',
    resourceType: 'Test', language: 'English',
    grade: 6, term: 3, totalMarks: 50,
    phase: 'Intermediate',
    difficulty: 'on', diffNote: 'On grade level', includeRubric: false,
    isWorksheet: false, isTest: true, isExamType: false,
    cog: { levels: ['Knowledge', 'Routine Procedures', 'Complex Procedures', 'Problem Solving'], pcts: [25, 45, 20, 10] },
    cogMarks: [13, 22, 10, 5], cogTolerance: 1,
    isBarretts: false,
    atpTopicList: 'Fractions\n- Decimals\n- Whole numbers',
    atpTopics: ['Fractions', 'Decimals', 'Whole numbers', 'Ratio'],
    topicInstruction: 'Use Term 3 topics only.',
    ...overrides,
  };
  const { qSys } = buildPrompts(ctx);
  return qSys();
}

describe('qSys MARK vs SCOPE DISCIPLINE rule', () => {
  test('rule header is present', () => {
    const qs = qSysFor();
    assert.match(qs, /MARK vs SCOPE DISCIPLINE/);
  });

  test('declares the one-mark-per-action principle', () => {
    const qs = qSysFor();
    assert.match(qs, /Each mark[\s\S]*one discrete markable action/i);
  });

  test('lists instruction-verb → mark floors', () => {
    const qs = qSysFor();
    // Key verbs that should set specific mark minimums.
    assert.match(qs, /"Name/i);
    assert.match(qs, /"Explain"/i);
    assert.match(qs, /"Compare"/i);
    assert.match(qs, /"Evaluate"/i);
    assert.match(qs, /"Justify/i);
    assert.match(qs, /"Discuss"/i);
  });

  test('states Compare / Analyse / Evaluate / Justify are ≥ 3 marks', () => {
    const qs = qSysFor();
    // The rule line must mention "3 marks" near the higher-order verbs.
    const slice = qs.split('MARK vs SCOPE DISCIPLINE')[1];
    assert.ok(slice, 'discipline section should exist');
    assert.match(slice, /at least 3 marks/);
  });

  test('tells Claude to split 3+ mark questions into (a) (b) (c) when multi-task', () => {
    const qs = qSysFor();
    assert.match(qs, /BREAK IT INTO LABELLED SUB-PARTS/);
    assert.match(qs, /\(a\).*\(b\).*\(c\)/s);
    assert.match(qs, /SUM to the parent question/);
  });

  test('shows the compressed-4-verbs-in-2-marks anti-pattern', () => {
    const qs = qSysFor();
    // The "NEVER write" example is the single most important bit for
    // Claude — a concrete negative example Claude will pattern-match
    // against its own drafts.
    assert.match(qs, /NEVER write/i);
    assert.match(qs, /4 tasks for 2 marks/);
  });

  test('still honours the plan\'s mark values and cog levels', () => {
    // The new rule must NOT contradict the existing "follow the plan
    // exactly" rule — we still trust the plan's numbers; the discipline
    // just shapes HOW a high-cog-level question at N marks is written.
    const qs = qSysFor();
    assert.match(qs, /Follow the question plan EXACTLY/);
    assert.match(qs, /The cognitive LEVEL is set by HOW the/i);
  });

  test('present for every subject / grade combination (not a Maths-specific rule)', () => {
    // Quick sanity: swap subject + grade + cog levels and confirm the
    // rule still renders. Covers the "it only fires for one subject"
    // regression risk.
    const history = qSysFor({
      subject: 'Social Sciences — History',
      grade: 6, term: 2, totalMarks: 40,
      cog: { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30, 50, 20] },
      cogMarks: [12, 20, 8],
      atpTopics: ['Berlin Conference', 'Impact of colonisation'],
      atpTopicList: 'Berlin Conference\n- Impact of colonisation',
    });
    assert.match(history, /MARK vs SCOPE DISCIPLINE/);
    assert.match(history, /at least 3 marks/);

    const nst = qSysFor({
      subject: 'Natural Sciences and Technology',
      grade: 6, term: 2, totalMarks: 20,
      cog: { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [50, 35, 15] },
      cogMarks: [10, 7, 3],
    });
    assert.match(nst, /MARK vs SCOPE DISCIPLINE/);
    assert.match(nst, /NEVER write/i);
  });
});
