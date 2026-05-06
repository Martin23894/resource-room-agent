// Targeted regression tests for stripMarkAssertions.
//
// Live moderation found that after the rebalancer bumps a question's
// `marks`, the memo guidance still contains the model's original
// per-step mark phrasing (e.g. "Award one mark per region, up to two
// marks") which contradicts the new authoritative total. The strip
// pass is supposed to remove these phrases — but the digit-only regex
// missed any phrasing that used English/Afrikaans number words.
//
// These tests lock in coverage for the specific shapes the moderator
// flagged on Geo Q9.1, Maths Test Q13.2/Q15.3, Lesson Q4.2, etc.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { __internals } from '../lib/rebalance.js';

const { stripMarkAssertions, reconcileMarkingGuidance } = __internals;

describe('stripMarkAssertions — English number words', () => {
  test('drops "Award one mark per X"', () => {
    const out = stripMarkAssertions('Award one mark per correctly named region. Accept any common name.');
    assert.equal(out, 'Accept any common name.');
  });

  test('drops "up to two marks"', () => {
    const out = stripMarkAssertions('Award one mark per region, up to two marks. Spelling counts.');
    assert.equal(out, 'Spelling counts.');
  });

  test('drops "Award two marks for X" mid-sentence', () => {
    const out = stripMarkAssertions('Award two marks for showing all working. Then check the final answer.');
    assert.equal(out, 'Then check the final answer.');
  });

  test('drops "Maximum three marks"', () => {
    const out = stripMarkAssertions('Maximum three marks. Look for evidence of comparison.');
    assert.equal(out, 'Look for evidence of comparison.');
  });

  test('handles ALL CAPS counts ("ONE", "TWO")', () => {
    const out = stripMarkAssertions('Award ONE mark per correct example. ');
    assert.equal(out, '');
  });
});

describe('stripMarkAssertions — Afrikaans number words', () => {
  test('drops "Ken twee punte toe vir X" (whole sentence)', () => {
    // Afrikaans "Ken N punte toe" is a mark-allocation directive parallel to
    // English "Award N marks for"; both strip to the next sentence end.
    const out = stripMarkAssertions('Ken twee punte toe vir korrekte spelling. Spelling tel.');
    assert.equal(out, 'Spelling tel.');
  });

  test('drops "Tot en met drie punte"', () => {
    const out = stripMarkAssertions('Tot en met drie punte vir volledige antwoord.');
    assert.equal(out, 'Vir volledige antwoord.');
  });
});

describe('stripMarkAssertions — preserves rationale', () => {
  test('keeps the criterion text after stripping the count', () => {
    const out = stripMarkAssertions('Award two marks for explaining cause and effect. Look for at least one historical reason.');
    assert.equal(out, 'Look for at least one historical reason.');
  });

  test('does not strip when no count phrase present', () => {
    const out = stripMarkAssertions('Accept paraphrased answers. Spelling counts.');
    assert.equal(out, 'Accept paraphrased answers. Spelling counts.');
  });

  test('idempotent — running twice gives same output', () => {
    const once = stripMarkAssertions('Award one mark per region. Accept common names.');
    const twice = stripMarkAssertions(once);
    assert.equal(once, twice);
  });
});

describe('reconcileMarkingGuidance — full integration on the moderator-flagged shape', () => {
  test('Geo Q9.1 case: "Award one mark per region, up to two marks" with rebalanced marks=4', () => {
    const answer = {
      questionNumber: '9.1',
      answer: 'Savanna, Fynbos',
      markingGuidance: 'Award one mark per correctly named region, up to two marks. Accept common names used in CAPS textbooks.',
    };
    reconcileMarkingGuidance(answer, 4);
    assert.equal(
      answer.markingGuidance,
      '[Marks awarded: 4 marks] Accept common names used in CAPS textbooks.',
      'must drop both "one mark per" and "two marks" phrases — they contradict the 4-mark prefix',
    );
  });

  test('does not stack prefixes on repeated calls', () => {
    const answer = { markingGuidance: 'Award two marks for working.' };
    reconcileMarkingGuidance(answer, 3);
    reconcileMarkingGuidance(answer, 3);
    assert.equal((answer.markingGuidance.match(/\[Marks awarded:/g) || []).length, 1);
  });
});
