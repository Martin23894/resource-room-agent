// Pre-fetch all image stimuli referenced by a Resource so the
// (synchronous) renderResource() can embed them via ImageRun without
// awaiting per-stimulus.
//
// Returns Map<imageId, Buffer>. Failures are swallowed — the renderer
// falls back to a caption-only placeholder when bytes are missing,
// so a single broken URL never blocks the whole generation.

import { fetchImageBytes } from './fetch.js';
import { lookupImage } from './catalogue.js';

export async function prefetchImagesForResource(resource, { logger } = {}) {
  const imageStimuli = (resource.stimuli || []).filter((s) => s.kind === 'image' && s.imageId);
  if (imageStimuli.length === 0) return new Map();

  const results = await Promise.all(imageStimuli.map(async (s) => {
    const entry = lookupImage(s.imageId);
    if (!entry) {
      logger?.warn?.({ imageId: s.imageId }, 'image stimulus references unknown imageId');
      return [s.imageId, null];
    }
    try {
      const bytes = await fetchImageBytes(entry.url, { logger });
      return [s.imageId, bytes];
    } catch (err) {
      logger?.warn?.({ imageId: s.imageId, url: entry.url, err: err?.message }, 'image fetch failed; will fall back to caption');
      return [s.imageId, null];
    }
  }));

  const out = new Map();
  for (const [id, bytes] of results) {
    if (bytes) out.set(id, bytes);
  }
  return out;
}
