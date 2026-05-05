// Lesson visual palette + per-grade-band style picker.
//
// Returns null for non-Lesson resources so assessment renderers (Tests,
// Exams, Worksheets, etc.) keep their formal palette unchanged. Lesson
// renderers (DOCX worksheet section, PPTX deck) consult this module to
// pick a softer green base, a rotating accent palette, and per-grade-band
// decoration density.
//
//   Junior band (Grade 4–5): more rounded corners, more decoration, mascot
//                            on the worksheet cover, brighter accent rotation.
//   Senior band (Grade 6–7): same warm palette but cleaner geometry, less
//                            decoration, no mascot — closer to "tween cool".
//
// Both bands share the same friendly display-font chain (Fredoka → Nunito
// → Calibri); machines without Fredoka degrade gracefully.

export const ASSESSMENT_PALETTE = Object.freeze({
  ink:      '1A1A18',
  inkSoft:  '3D3D3A',
  green:    '085041',
  greenBar: '0F6E56',
  grey:     '999999',
  bgTint:   'E1F5EE',
});

const LESSON_BASE = Object.freeze({
  ink:      '1A1A18',
  inkSoft:  '3D3D3A',
  green:    '0F6E56',     // softened from the formal 085041
  greenBar: '2A8B73',
  grey:     '8C8C8C',
  bgTint:   'EAF7F1',     // lighter mint than assessments
  accents:  Object.freeze({
    sun:   'F4B942',
    coral: 'F76C5E',
    sky:   '5DA9E9',
    mint:  'A8E6CF',
    plum:  'B57EDC',
  }),
});

const JUNIOR_TIER = Object.freeze({
  cornerRadius:    0.18,
  fontHead:        'Fredoka, Nunito, Calibri',
  fontBody:        'Calibri',
  decorationLevel: 'high',
  mascotEnabled:   true,
  accentRotation:  ['sun', 'coral', 'sky', 'mint'],
});

const SENIOR_TIER = Object.freeze({
  cornerRadius:    0.10,
  fontHead:        'Fredoka, Nunito, Calibri',
  fontBody:        'Calibri',
  decorationLevel: 'low',
  mascotEnabled:   false,
  accentRotation:  ['sun', 'sky', 'plum', 'mint'],
});

/**
 * Resolve a Lesson visual-style descriptor for the given request.
 *
 *   pickLessonStyle({ resourceType: 'Lesson', grade: 4 })  → junior tier
 *   pickLessonStyle({ resourceType: 'Lesson', grade: 7 })  → senior tier
 *   pickLessonStyle({ resourceType: 'Test',   grade: 6 })  → null
 *
 * The shape returned:
 *   {
 *     isLesson:        true,
 *     gradeBand:       'junior' | 'senior',
 *     palette:         { ink, inkSoft, green, greenBar, grey, bgTint, accents{} },
 *     cornerRadius,    fontHead, fontBody,
 *     decorationLevel, mascotEnabled, accentRotation
 *   }
 */
export function pickLessonStyle({ resourceType, grade } = {}) {
  if (resourceType !== 'Lesson') return null;
  const g = Number(grade) || 4;
  const band = g <= 5 ? 'junior' : 'senior';
  const tier = band === 'junior' ? JUNIOR_TIER : SENIOR_TIER;
  return {
    isLesson:  true,
    gradeBand: band,
    palette:   LESSON_BASE,
    ...tier,
  };
}

/**
 * Pick the n-th accent colour from a style's rotation. The rotation lets
 * sibling slides / sibling questions cycle through accents (objective #1
 * gets sun, #2 coral, #3 sky, …) without the renderer caring which colour
 * it is at any given index.
 */
export function nthAccent(style, n) {
  if (!style || !style.accentRotation?.length) return null;
  const key = style.accentRotation[Math.abs(n) % style.accentRotation.length];
  return style.palette.accents[key] || null;
}
