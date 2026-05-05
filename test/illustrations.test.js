// Tests for lib/illustrations/ — Phase C v1.
//
// Covers picker determinism (same input → same output), the per-subject
// icon mapping, the junior/senior split for hero + stamp, and the raster
// pipeline's PNG output. End-to-end embed assertions live in
// test/lesson.test.js so they share the makeLesson fixture.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  pickHero, pickIcon, pickStamp, pickSubjectIcon,
  illustrationToPng, mascotWavingSvg, wellDoneStampSvg,
  pickPhoto, loadPhotoBuffer, photoCategoryFor, PHOTO_CATEGORIES,
} from '../lib/illustrations/index.js';
import { __internals as iconInternals } from '../lib/illustrations/subject-icons.js';

describe('pickSubjectIcon — subject → icon mapping', () => {
  test('Mathematics → calculator', () => {
    const { name } = pickSubjectIcon('Mathematics', '#000');
    assert.equal(name, 'calculator');
  });

  test('Natural Sciences and Technology → flask', () => {
    const { name } = pickSubjectIcon('Natural Sciences and Technology', '#000');
    assert.equal(name, 'flask');
  });

  test('English Home Language → book', () => {
    const { name } = pickSubjectIcon('English Home Language', '#000');
    assert.equal(name, 'book');
  });

  test('Afrikaans First Additional Language → book', () => {
    const { name } = pickSubjectIcon('Afrikaans First Additional Language', '#000');
    assert.equal(name, 'book');
  });

  test('Social Sciences — History → scroll', () => {
    const { name } = pickSubjectIcon('Social Sciences — History', '#000');
    assert.equal(name, 'scroll');
  });

  test('Social Sciences — Geography → globe', () => {
    const { name } = pickSubjectIcon('Social Sciences — Geography', '#000');
    assert.equal(name, 'globe');
  });

  test('Life Skills — Personal and Social Wellbeing → heart', () => {
    const { name } = pickSubjectIcon('Life Skills — Personal and Social Wellbeing', '#000');
    assert.equal(name, 'heart');
  });

  test('Economic and Management Sciences → coins', () => {
    const { name } = pickSubjectIcon('Economic and Management Sciences', '#000');
    assert.equal(name, 'coins');
  });

  test('unknown subject falls back to pencil', () => {
    const { name } = pickSubjectIcon('Quantum Wizardry', '#000');
    assert.equal(name, 'pencil');
  });

  test('every entry in ICON_MAP is callable and produces a non-trivial SVG', () => {
    for (const entry of iconInternals.ICON_MAP) {
      const svg = entry.fn('#F4B942');
      assert.match(svg, /^<svg /);
      assert.match(svg, /viewBox="0 0 100 100"/);
      assert.ok(svg.length > 100, `${entry.name} SVG looks empty`);
    }
  });

  test('icon SVG carries the requested accent colour', () => {
    const { svg } = pickSubjectIcon('Mathematics', '#F4B942');
    assert.match(svg, /#F4B942/);
  });

  test('determinism — same subject + colour always returns the same SVG', () => {
    const a = pickSubjectIcon('Mathematics', '#F4B942').svg;
    const b = pickSubjectIcon('Mathematics', '#F4B942').svg;
    assert.equal(a, b);
  });
});

describe('pickHero — junior gets mascot, senior gets subject icon', () => {
  test('junior band returns the waving mascot', () => {
    const hero = pickHero({
      subject: 'Mathematics', gradeBand: 'junior', accent: '#F4B942',
    });
    assert.equal(hero.kind, 'mascot');
    assert.equal(hero.name, 'mascot-waving');
    assert.match(hero.svg, /^<svg /);
  });

  test('senior band returns the subject icon, not the mascot', () => {
    const hero = pickHero({
      subject: 'Mathematics', gradeBand: 'senior', accent: '#F4B942',
    });
    assert.equal(hero.kind, 'icon');
    assert.equal(hero.name, 'calculator');
  });

  test('senior band uses the subject mapping (English → book)', () => {
    const hero = pickHero({
      subject: 'English Home Language', gradeBand: 'senior', accent: '#F4B942',
    });
    assert.equal(hero.kind, 'icon');
    assert.equal(hero.name, 'book');
  });
});

describe('pickIcon — independent of grade band', () => {
  test('returns the subject icon directly', () => {
    const r1 = pickIcon({ subject: 'Mathematics', accent: '#F4B942' });
    const r2 = pickIcon({ subject: 'Mathematics', accent: '#F4B942' });
    assert.equal(r1.name, 'calculator');
    assert.equal(r1.svg, r2.svg);
  });
});

describe('pickStamp — junior only', () => {
  test('junior band returns a Well done! stamp', () => {
    const stamp = pickStamp({ gradeBand: 'junior', language: 'English', accent: '#F4B942' });
    assert.ok(stamp);
    assert.equal(stamp.name, 'well-done');
    assert.match(stamp.svg, /WELL DONE/);
  });

  test('senior band returns null', () => {
    const stamp = pickStamp({ gradeBand: 'senior', language: 'English', accent: '#F4B942' });
    assert.equal(stamp, null);
  });

  test('Afrikaans junior stamp uses the Afrikaans copy', () => {
    const stamp = pickStamp({ gradeBand: 'junior', language: 'Afrikaans', accent: '#F4B942' });
    assert.match(stamp.svg, /MOOI GEDOEN/);
  });
});

describe('mascotWavingSvg / wellDoneStampSvg — direct generators', () => {
  test('mascot SVG carries the accent colour and has both eyes', () => {
    const svg = mascotWavingSvg({ accent: '#5DA9E9' });
    assert.match(svg, /#5DA9E9/);
    // Two eye highlights — small white circles
    const eyeMatches = svg.match(/<circle[^/]*fill="white"/g) || [];
    assert.ok(eyeMatches.length >= 2, `expected at least two white eye circles, got ${eyeMatches.length}`);
  });

  test('stamp SVG defaults to English copy when language is unknown', () => {
    const svg = wellDoneStampSvg({ accent: '#F4B942' });   // language omitted
    assert.match(svg, /WELL DONE/);
  });
});

describe('illustrationToPng — raster pipeline', () => {
  test('rasterises the mascot SVG to a non-trivial PNG buffer', () => {
    const svg = mascotWavingSvg({ accent: '#F4B942' });
    const png = illustrationToPng(svg, { widthPx: 240 });
    assert.ok(Buffer.isBuffer(png), 'expected PNG Buffer');
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    assert.equal(png[0], 0x89);
    assert.equal(png[1], 0x50);
    assert.equal(png[2], 0x4e);
    assert.equal(png[3], 0x47);
    assert.ok(png.length > 800, `PNG seems empty: ${png.length} bytes`);
  });

  test('rasterises a subject icon SVG too', () => {
    const { svg } = pickSubjectIcon('Mathematics', '#F4B942');
    const png = illustrationToPng(svg, { widthPx: 240 });
    assert.ok(png.length > 600);
  });
});

// ─────────────────────────────────────────────────────────────────
// Phase D — Photo picker (scaffold; actual JPGs vendored separately)
// ─────────────────────────────────────────────────────────────────

describe('photoCategoryFor — subject → photo category mapping', () => {
  test('Mathematics → mathematics', () => {
    assert.equal(photoCategoryFor('Mathematics'), 'mathematics');
  });

  test('Natural Sciences and Technology → sciences', () => {
    assert.equal(photoCategoryFor('Natural Sciences and Technology'), 'sciences');
  });

  test('Technology → sciences', () => {
    assert.equal(photoCategoryFor('Technology'), 'sciences');
  });

  test('Social Sciences — Geography → geography', () => {
    assert.equal(photoCategoryFor('Social Sciences — Geography'), 'geography');
  });

  test('Social Sciences — History → history', () => {
    assert.equal(photoCategoryFor('Social Sciences — History'), 'history');
  });

  test('English Home Language → languages', () => {
    assert.equal(photoCategoryFor('English Home Language'), 'languages');
  });

  test('Afrikaans First Additional Language → languages', () => {
    assert.equal(photoCategoryFor('Afrikaans First Additional Language'), 'languages');
  });

  test('Life Skills — Personal and Social Wellbeing → lifeskills', () => {
    assert.equal(photoCategoryFor('Life Skills — Personal and Social Wellbeing'), 'lifeskills');
  });

  test('Economic and Management Sciences → lifeskills', () => {
    assert.equal(photoCategoryFor('Economic and Management Sciences'), 'lifeskills');
  });

  test('unknown subject falls back to lifeskills (most generic bucket)', () => {
    assert.equal(photoCategoryFor('Quantum Wizardry'), 'lifeskills');
  });
});

describe('PHOTO_CATEGORIES — slot manifest', () => {
  test('all six categories declared with positive slot counts', () => {
    for (const key of ['mathematics', 'sciences', 'geography', 'languages', 'history', 'lifeskills']) {
      assert.ok(PHOTO_CATEGORIES[key] > 0, `missing slot count for ${key}`);
    }
  });

  test('total slot count is 50 across all categories', () => {
    const total = Object.values(PHOTO_CATEGORIES).reduce((a, b) => a + b, 0);
    assert.equal(total, 50, `expected 50 photo slots total, got ${total}`);
  });
});

describe('pickPhoto — deterministic per (subject, slot)', () => {
  test('returns a category-routed file path with zero-padded fileName', () => {
    const photo = pickPhoto({ subject: 'Mathematics', slot: 0 });
    assert.equal(photo.category, 'mathematics');
    assert.equal(photo.fileName, '01.jpg');
    assert.match(photo.path, /lib\/illustrations\/photos\/mathematics\/01\.jpg$/);
  });

  test('slot indexes wrap modulo per-category count', () => {
    // mathematics has 8 slots — slot 8 wraps back to 01.jpg
    const a = pickPhoto({ subject: 'Mathematics', slot: 0 });
    const b = pickPhoto({ subject: 'Mathematics', slot: PHOTO_CATEGORIES.mathematics });
    assert.equal(a.fileName, b.fileName);
  });

  test('different slots within a category pick different files', () => {
    const photos = new Set();
    for (let i = 0; i < PHOTO_CATEGORIES.mathematics; i++) {
      photos.add(pickPhoto({ subject: 'Mathematics', slot: i }).fileName);
    }
    assert.equal(photos.size, PHOTO_CATEGORIES.mathematics);
  });

  test('determinism — same (subject, slot) always returns the same file', () => {
    const a = pickPhoto({ subject: 'Mathematics', slot: 3 });
    const b = pickPhoto({ subject: 'Mathematics', slot: 3 });
    assert.deepEqual(a, b);
  });

  test('reports exists:false when the photo file is not on disk yet', () => {
    // Phase D ships scaffolded — actual JPGs vendored by the curator.
    // Until they land, every slot reports exists:false and callers fall
    // back to text-only layouts.
    const photo = pickPhoto({ subject: 'Mathematics', slot: 0 });
    assert.equal(photo.exists, false);
  });

  test('handles missing subject gracefully — falls back to lifeskills', () => {
    const photo = pickPhoto({ slot: 0 });
    assert.equal(photo.category, 'lifeskills');
    assert.equal(photo.fileName, '01.jpg');
  });

  test('non-finite slot is treated as 0', () => {
    const photo = pickPhoto({ subject: 'Mathematics', slot: NaN });
    assert.equal(photo.fileName, '01.jpg');
  });
});

describe('loadPhotoBuffer', () => {
  test('returns null when the photo does not exist on disk', () => {
    const photo = pickPhoto({ subject: 'Mathematics', slot: 0 });
    assert.equal(photo.exists, false);
    assert.equal(loadPhotoBuffer(photo), null);
  });

  test('returns null on null input', () => {
    assert.equal(loadPhotoBuffer(null), null);
  });
});
