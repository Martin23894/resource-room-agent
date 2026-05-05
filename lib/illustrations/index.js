// Illustration dispatcher — Phase C v1.
//
// Pure-function picker that returns SVG illustration strings keyed off the
// resource's subject + grade band. The picker makes NO model decision —
// the same Lesson always gets the same illustrations. That keeps tests
// deterministic and avoids the model picking off-brand or wrong-subject art.
//
// Three illustration kinds are exposed:
//
//   • Subject icon — a per-subject SVG (calculator / book / flask /
//     globe / scroll / heart / coins / pencil). Used as a small accent on
//     the PPTX yourTurn slide, the worksheet cover, and the title slide
//     (when the senior band skips the mascot).
//
//   • Mascot — a friendly geometric blob character. Junior band only
//     (Gr 4–5). Senior gets the subject icon as its hero instead.
//
//   • Stamp — "Well done!" celebration art. Junior band only.
//
// Output of each picker is { svg, name } where svg is the raw SVG string
// (rasterise with rasterSvgToPng for DOCX/PPTX embedding). Same raster
// pipeline as lib/diagrams/.

import { pickSubjectIcon } from './subject-icons.js';
import { mascotWavingSvg } from './mascot.js';
import { wellDoneStampSvg } from './stamps.js';
import { rasterSvgToPng } from '../diagrams/raster.js';

/**
 * Pick the hero illustration for a Lesson worksheet cover or PPTX title
 * slide. Junior band gets the waving mascot; senior gets the subject
 * icon. Returns { svg, kind, name } where kind is 'mascot' or 'icon'.
 */
export function pickHero({ subject, gradeBand, accent }) {
  if (gradeBand === 'junior') {
    return {
      svg: mascotWavingSvg({ accent }),
      kind: 'mascot',
      name: 'mascot-waving',
    };
  }
  const { svg, name } = pickSubjectIcon(subject, accent);
  return { svg, kind: 'icon', name };
}

/**
 * Pick the subject icon — used on PPTX yourTurn slide and (where Phase A
 * placeholder shapes were) wherever a small subject motif belongs. This
 * is independent of grade band — every Lesson has a subject icon.
 */
export function pickIcon({ subject, accent }) {
  return pickSubjectIcon(subject, accent);
}

/**
 * Pick the celebration stamp. Junior band only — senior keeps the cleaner
 * memo / celebrate slide without a stamp. Returns null when no stamp is
 * appropriate so callers can simply skip the embed.
 */
export function pickStamp({ gradeBand, language, accent }) {
  if (gradeBand !== 'junior') return null;
  return {
    svg: wellDoneStampSvg({ language, accent }),
    name: 'well-done',
  };
}

/**
 * Convenience: rasterise an illustration SVG to PNG bytes via the same
 * pipeline as diagrams. Use widthPx tuned to the embed size for sharper
 * output on Word's rendering — too small and the icon looks fuzzy, too
 * large and the DOCX file gets bloated.
 */
export function illustrationToPng(svg, { widthPx = 600 } = {}) {
  return rasterSvgToPng(svg, { widthPx });
}

export { pickSubjectIcon, mascotWavingSvg, wellDoneStampSvg };
