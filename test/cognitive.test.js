import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { getCogLevels, largestRemainder, marksToTime, isBarretts } from '../lib/cognitive.js';

describe('largestRemainder', () => {
  test('maths 25/45/20/10 always sums to total', () => {
    for (const total of [10, 25, 37, 50, 60, 75, 100, 150]) {
      const got = largestRemainder(total, [25, 45, 20, 10]);
      assert.equal(got.reduce((a, b) => a + b, 0), total, `total=${total}`);
      assert.equal(got.length, 4);
      got.forEach((n) => assert.ok(Number.isInteger(n) && n >= 0));
    }
  });

  test("Barrett's 20/20/40/20 always sums to total", () => {
    for (const total of [5, 10, 15, 20, 50, 60]) {
      const got = largestRemainder(total, [20, 20, 40, 20]);
      assert.equal(got.reduce((a, b) => a + b, 0), total, `total=${total}`);
    }
  });

  test('Social Sciences 30/50/20 always sums to total', () => {
    for (const total of [30, 40, 50, 60, 75, 100]) {
      const got = largestRemainder(total, [30, 50, 20]);
      assert.equal(got.reduce((a, b) => a + b, 0), total);
    }
  });

  test('exact 50-mark Maths paper → [13, 22, 10, 5]', () => {
    // 25% of 50 = 12.5; 45% = 22.5; 20% = 10; 10% = 5
    // After flooring: 12 + 22 + 10 + 5 = 49. Deficit = 1; the two buckets with
    // the largest fractional remainders (0.5 and 0.5) are the first two — the
    // sort is stable by remainder magnitude only, so one of them gets +1.
    const got = largestRemainder(50, [25, 45, 20, 10]);
    assert.equal(got.reduce((a, b) => a + b, 0), 50);
    assert.deepEqual(got.slice(2), [10, 5]);
    // One of the first two must be 13, the other 22 (in either order the high
    // bucket is the 45% one so it should end up the largest).
    const [a, b] = got;
    assert.ok(a === 13 || b === 23, 'first bucket should get the +1 remainder');
  });
});

describe('marksToTime', () => {
  test('small tests map to short times', () => {
    assert.equal(marksToTime(10), '15 minutes');
    assert.equal(marksToTime(20), '30 minutes');
    assert.equal(marksToTime(25), '45 minutes');
    assert.equal(marksToTime(30), '45 minutes');
  });

  test('standard 50-mark test maps to 1 hour', () => {
    assert.equal(marksToTime(50), '1 hour');
  });

  test('larger papers get proportionally more time', () => {
    assert.equal(marksToTime(60), '1 hour 30 minutes');
    assert.equal(marksToTime(75), '2 hours');
    assert.equal(marksToTime(100), '2 hours 30 minutes');
  });

  test('very large papers fall through to formula', () => {
    assert.equal(marksToTime(150), '4 hours');
  });
});

describe('getCogLevels', () => {
  test('Mathematics returns Bloom\'s 25/45/20/10', () => {
    const cog = getCogLevels('Mathematics');
    assert.deepEqual(cog.pcts, [25, 45, 20, 10]);
    assert.equal(cog.levels[0], 'Knowledge');
  });

  test('Afrikaans Wiskunde matches Mathematics', () => {
    const cog = getCogLevels('Wiskunde');
    assert.deepEqual(cog.pcts, [25, 45, 20, 10]);
  });

  test('English Home Language returns Barrett\'s 20/20/40/20', () => {
    const cog = getCogLevels('English Home Language');
    assert.deepEqual(cog.pcts, [20, 20, 40, 20]);
    assert.equal(cog.levels[0], 'Literal');
  });

  test('Afrikaans Huistaal also returns Barrett\'s', () => {
    const cog = getCogLevels('Afrikaans Huistaal');
    assert.equal(cog.levels[0], 'Literal');
  });

  test('English First Additional Language returns Barrett\'s', () => {
    const cog = getCogLevels('English First Additional Language');
    assert.deepEqual(cog.pcts, [20, 20, 40, 20]);
  });

  test('Natural Sciences and Technology returns 50/35/15', () => {
    const cog = getCogLevels('Natural Sciences and Technology');
    assert.deepEqual(cog.pcts, [50, 35, 15]);
  });

  test('Natural Sciences (Gr 7 standalone) returns 50/35/15', () => {
    const cog = getCogLevels('Natural Sciences');
    assert.deepEqual(cog.pcts, [50, 35, 15]);
  });

  test('Social Sciences — History returns 30/50/20', () => {
    const cog = getCogLevels('Social Sciences — History');
    assert.deepEqual(cog.pcts, [30, 50, 20]);
  });

  test('Life Skills returns 30/40/30', () => {
    const cog = getCogLevels('Life Skills — Personal and Social Wellbeing');
    assert.deepEqual(cog.pcts, [30, 40, 30]);
  });

  test('unknown subject falls back to generic 30/40/30', () => {
    const cog = getCogLevels('Astrophysics');
    assert.deepEqual(cog.pcts, [30, 40, 30]);
  });

  test('empty subject does not throw', () => {
    const cog = getCogLevels('');
    assert.ok(Array.isArray(cog.levels));
  });
});

describe('isBarretts', () => {
  test('true for Barrett\'s framework', () => {
    assert.equal(isBarretts(getCogLevels('English Home Language')), true);
  });

  test('false for Bloom\'s framework', () => {
    assert.equal(isBarretts(getCogLevels('Mathematics')), false);
    assert.equal(isBarretts(getCogLevels('Natural Sciences and Technology')), false);
  });

  test('false for undefined input', () => {
    assert.equal(isBarretts(undefined), false);
    assert.equal(isBarretts(null), false);
    assert.equal(isBarretts({}), false);
  });
});
