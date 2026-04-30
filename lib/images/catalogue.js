// Curated photo catalogue for use in resource generation.
//
// Each entry is referenced by its `id` from a stimulus block:
//   { kind: 'image', imageId: 'fynbos-landscape', altText: '…' }
//
// The renderer fetches the URL, caches the bytes, and embeds the image
// in the DOCX via ImageRun. Browser preview gets the same DOCX so no
// frontend changes are needed.
//
// Phase 1 (THIS FILE): seed entries use https://picsum.photos URLs as
// stable test images — proves the fetch / embed / cache pipeline works
// end-to-end. The actual photos do NOT match the captions below — they
// are generic placeholders. CAPTIONS HAVE BEEN MADE INTENTIONALLY
// GENERIC ("a flowering plant" rather than "a king protea") so that
// even with placeholder photos the captions do not lie about specific
// species. Tags retain SA-specific values so Claude can match topics
// in the prompt.
//
// Phase 2 swaps these for real Pexels / Wikimedia Commons URLs paired
// with the same id keys; no other code needs to change.
//
// Licensing rule for production entries: Pexels and Unsplash only,
// both explicitly free for commercial use with no attribution required.
// Wikimedia Commons acceptable on a per-image basis (varies per file).

export const IMAGES = {
  // ── PROOF-OF-CONCEPT SEED · Phase 1 ────────────────────────────
  // picsum.photos serves a different photo per ID, stable per ID.
  // Captions deliberately generic so they're truthful even with
  // placeholder content.

  'fynbos-flower': {
    url: 'https://picsum.photos/id/110/800/600',
    caption: 'A flowering plant.',
    tags: ['protea', 'fynbos', 'plant', 'flower', 'south africa', 'biodiversity'],
    source: 'picsum.photos (test seed)',
    license: 'CC0',
  },

  'fynbos-landscape': {
    url: 'https://picsum.photos/id/29/800/600',
    caption: 'A natural landscape.',
    tags: ['fynbos', 'landscape', 'biome', 'western cape', 'south africa'],
    source: 'picsum.photos (test seed)',
    license: 'CC0',
  },

  'savanna-landscape': {
    url: 'https://picsum.photos/id/177/800/600',
    caption: 'A grassland landscape.',
    tags: ['savanna', 'grassland', 'landscape', 'biome', 'grass', 'acacia'],
    source: 'picsum.photos (test seed)',
    license: 'CC0',
  },

  'classroom-sa': {
    url: 'https://picsum.photos/id/250/800/600',
    caption: 'A school setting.',
    tags: ['classroom', 'school', 'learners', 'education', 'daily life'],
    source: 'picsum.photos (test seed)',
    license: 'CC0',
  },

  'maize-field': {
    url: 'https://picsum.photos/id/236/800/600',
    caption: 'An agricultural field.',
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
