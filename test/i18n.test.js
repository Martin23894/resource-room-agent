import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  i18n,
  resourceTypeLabel,
  subjectDisplayName,
  localiseDuration,
} from '../lib/i18n.js';

describe('i18n()', () => {
  test('English returns English labels', () => {
    const t = i18n('English');
    assert.equal(t.grade, 'Grade');
    assert.equal(t.term, 'Term');
    assert.equal(t.totalLabel, 'TOTAL');
    assert.equal(t.marksWord, 'marks');
    assert.equal(t.memo.cogLevel, 'COGNITIVE LEVEL');
  });

  test('Afrikaans returns Afrikaans labels', () => {
    const t = i18n('Afrikaans');
    assert.equal(t.grade, 'Graad');
    assert.equal(t.term, 'Kwartaal');
    assert.equal(t.name, 'Naam');
    assert.equal(t.surname, 'Van');
    assert.equal(t.totalLabel, 'TOTAAL');
    assert.equal(t.marksWord, 'punte');
    assert.equal(t.memo.no, 'NR.');
    assert.equal(t.memo.cogLevel, 'KOGNITIEWE VLAK');
  });

  test('unknown language falls back to English', () => {
    const t = i18n('Klingon');
    assert.equal(t.grade, 'Grade');
  });

  test('instruction items are translated', () => {
    const en = i18n('English').instructionItems;
    const af = i18n('Afrikaans').instructionItems;
    assert.equal(en.length, af.length);
    assert.match(af[0], /^Lees/);
    assert.match(af[1], /AL die vrae/);
  });
});

describe('resourceTypeLabel()', () => {
  test('returns English uppercase by default', () => {
    assert.equal(resourceTypeLabel('Test', 'English'), 'TEST');
    assert.equal(resourceTypeLabel('Final Exam', 'English'), 'FINAL EXAM');
  });

  test('returns Afrikaans translations', () => {
    assert.equal(resourceTypeLabel('Test', 'Afrikaans'), 'TOETS');
    assert.equal(resourceTypeLabel('Exam', 'Afrikaans'), 'EKSAMEN');
    assert.equal(resourceTypeLabel('Worksheet', 'Afrikaans'), 'WERKBLAD');
    assert.equal(resourceTypeLabel('Project', 'Afrikaans'), 'PROJEK');
    assert.equal(resourceTypeLabel('Final Exam', 'Afrikaans'), 'EINDEKSAMEN');
  });

  test('unknown resource type falls back to uppercased input', () => {
    assert.equal(resourceTypeLabel('Quiz', 'Afrikaans'), 'QUIZ');
  });
});

describe('subjectDisplayName()', () => {
  test('English passes through unchanged', () => {
    assert.equal(
      subjectDisplayName('Natural Sciences and Technology', 'English'),
      'Natural Sciences and Technology',
    );
  });

  test('Afrikaans translates canonical subject names', () => {
    assert.equal(
      subjectDisplayName('Natural Sciences and Technology', 'Afrikaans'),
      'Natuurwetenskappe en Tegnologie',
    );
    assert.equal(subjectDisplayName('Mathematics', 'Afrikaans'), 'Wiskunde');
    assert.equal(
      subjectDisplayName('Social Sciences — History', 'Afrikaans'),
      'Sosiale Wetenskappe — Geskiedenis',
    );
  });

  test('unmapped subject falls back to the input', () => {
    assert.equal(subjectDisplayName('Astrophysics', 'Afrikaans'), 'Astrophysics');
  });
});

describe('localiseDuration()', () => {
  test('English passes through unchanged', () => {
    assert.equal(localiseDuration('1 hour 30 minutes', 'English'), '1 hour 30 minutes');
  });

  test('Afrikaans translates minutes and hours', () => {
    assert.equal(localiseDuration('15 minutes', 'Afrikaans'), '15 minute');
    assert.equal(localiseDuration('1 hour', 'Afrikaans'), '1 uur');
    assert.equal(localiseDuration('2 hours', 'Afrikaans'), '2 uur');
    assert.equal(localiseDuration('1 hour 30 minutes', 'Afrikaans'), '1 uur 30 minute');
  });
});
