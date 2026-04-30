// Curated photo catalogue for use in resource generation.
//
// Each entry is referenced by its `id` from a stimulus block:
//   { kind: 'image', imageId: 'protea-cynaroides', altText: '…' }
//
// The renderer fetches the URL, caches the bytes, and embeds the image
// in the DOCX via ImageRun. Browser preview gets the same DOCX so no
// frontend changes are needed.
//
// Phase 1 (THIS FILE): seed entries use https://picsum.photos URLs as
// stable test images — proves the fetch / embed / cache pipeline works
// end-to-end. Phase 2 swaps these for real Pexels / Unsplash photos
// curated against actual SA Grade 4–7 CAPS topics.
//
// Licensing rule for production entries: Pexels and Unsplash only.
// Both are explicitly free for commercial use with no attribution
// required. Wikimedia Commons is acceptable on a per-image basis.

export const IMAGES = {
  // ── PROOF-OF-CONCEPT SEED · Phase 1 ────────────────────────────
  // The picsum.photos service serves a different photo per ID but
  // each URL is stable. These are placeholders to validate the
  // pipeline; replace with real Pexels/Unsplash URLs in Phase 2.

  'protea-cynaroides': {
    url: 'https://picsum.photos/id/110/800/600',
    caption: 'King protea (Protea cynaroides), national flower of South Africa.',
    tags: ['protea', 'fynbos', 'plant', 'flower', 'south africa'],
    source: 'picsum.photos (test seed)',
    license: 'CC0',
  },

  'fynbos-landscape': {
    url: 'https://picsum.photos/id/29/800/600',
    caption: 'Fynbos landscape, Western Cape.',
    tags: ['fynbos', 'landscape', 'biome', 'western cape', 'south africa'],
    source: 'picsum.photos (test seed)',
    license: 'CC0',
  },

  'savanna-landscape': {
    url: 'https://picsum.photos/id/177/800/600',
    caption: 'Savanna landscape with grasses and acacia trees.',
    tags: ['savanna', 'landscape', 'biome', 'grass', 'acacia'],
    source: 'picsum.photos (test seed)',
    license: 'CC0',
  },

  'classroom-sa': {
    url: 'https://picsum.photos/id/250/800/600',
    caption: 'A South African classroom.',
    tags: ['classroom', 'school', 'learners', 'education', 'daily life'],
    source: 'picsum.photos (test seed)',
    license: 'CC0',
  },

  'maize-field': {
    url: 'https://picsum.photos/id/236/800/600',
    caption: 'A maize field at harvest.',
    tags: ['maize', 'mealie', 'crop', 'farming', 'agriculture', 'food'],
    source: 'picsum.photos (test seed)',
    license: 'CC0',
  },
};

export function lookupImage(id) {
  return IMAGES[id] || null;
}

export function listImageIds() {
  return Object.keys(IMAGES);
}
