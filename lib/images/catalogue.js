// Curated photo catalogue for use in resource generation.
//
// Each entry is referenced by its `id` from a stimulus block:
//   { kind: 'image', imageId: 'fynbos-flower', altText: '…' }
//
// The renderer fetches the URL, caches the bytes, and embeds the image
// in the DOCX via ImageRun. Browser preview gets the same DOCX so no
// frontend changes are needed.
//
// CAPTIONS ARE DELIBERATELY GENERIC ("a flowering plant" rather than
// "a king protea") so they never give away identification answers.
// Tags retain SA-specific values so Claude can match topics in the
// prompt. Rule 5g in api/generate.js spells out the answer-leak guard.
//
// Licensing: all entries below are Pexels — free for commercial use,
// no attribution required.

export const IMAGES = {
  // ── BATCH 1 · Pexels-curated · 7 photos ────────────────────────

  // A flowering plant on a dark background — pristine for "name the
  // plant in the photograph" type recognition questions.
  'fynbos-flower': {
    url: 'https://images.pexels.com/photos/29111744/pexels-photo-29111744.jpeg?w=800',
    caption: 'A flowering plant.',
    tags: ['protea', 'fynbos', 'plant', 'flower', 'south africa', 'biodiversity', 'recognition'],
    source: 'Pexels (photo 29111744)',
    license: 'Pexels License (free for commercial use, no attribution required)',
  },

  // Close-up of an open protea bloom — second variant for variety
  // when one paper has already used the dark-background protea.
  'fynbos-flower-bloom': {
    url: 'https://images.pexels.com/photos/32117328/pexels-photo-32117328.jpeg?w=800',
    caption: 'A flowering plant.',
    tags: ['protea', 'fynbos', 'plant', 'flower', 'south africa', 'biodiversity', 'recognition'],
    source: 'Pexels (photo 32117328)',
    license: 'Pexels License',
  },

  // Lion's Head, Cape Town — natural mountain + fynbos landscape.
  'cape-fynbos-landscape': {
    url: 'https://images.pexels.com/photos/34707081/pexels-photo-34707081.jpeg?w=800',
    caption: 'A natural landscape with a mountain.',
    tags: ['cape town', 'lions head', 'mountain', 'landscape', 'biome', 'fynbos', 'south africa', 'western cape'],
    source: 'Pexels (photo 34707081)',
    license: 'Pexels License',
  },

  // Tree in wild grassland — works for savanna / grassland biome
  // questions and isolated-tree recognition.
  'savanna-tree': {
    url: 'https://images.pexels.com/photos/10800257/pexels-photo-10800257.jpeg?w=800',
    caption: 'A tree in a natural landscape.',
    tags: ['tree', 'savanna', 'grassland', 'wild', 'biome', 'landscape'],
    source: 'Pexels (photo 10800257)',
    license: 'Pexels License',
  },

  // Generic golden-hour natural landscape — useful when the question
  // is about landscape features (horizon, sky, vegetation) rather
  // than a specific biome.
  'natural-landscape': {
    url: 'https://images.pexels.com/photos/36746801/pexels-photo-36746801.jpeg?w=800',
    caption: 'A natural landscape at sunset.',
    tags: ['landscape', 'biome', 'natural', 'sunset', 'wilderness', 'sky', 'horizon'],
    source: 'Pexels (photo 36746801)',
    license: 'Pexels License',
  },

  // Empty classroom — desks and chairs in rows. Daily life context.
  'classroom-empty': {
    url: 'https://images.pexels.com/photos/10646409/pexels-photo-10646409.jpeg?w=800',
    caption: 'A school classroom.',
    tags: ['classroom', 'school', 'desks', 'chairs', 'education', 'daily life'],
    source: 'Pexels (photo 10646409)',
    license: 'Pexels License',
  },

  // Cornfield (maize) under a cloudy sky — agriculture, food
  // production, EMS / Maths context (data-handling on harvests).
  'maize-field': {
    url: 'https://images.pexels.com/photos/35740817/pexels-photo-35740817.jpeg?w=800',
    caption: 'An agricultural field of crops.',
    tags: ['maize', 'mealie', 'cornfield', 'crop', 'farming', 'agriculture', 'food', 'landscape'],
    source: 'Pexels (photo 35740817)',
    license: 'Pexels License',
  },
};

export function lookupImage(id) {
  return IMAGES[id] || null;
}

export function listImageIds() {
  return Object.keys(IMAGES);
}
