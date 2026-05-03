// Prompt-builders for the rich CAPS pacing data. Kept separate from
// api/generate.js so they can be unit-tested without loading the full
// generation pipeline (Anthropic SDK, render, schema, etc.).
//
// Inputs are the plain Unit / FormalAssessment objects that lib/atp.js
// returns from data/atp-pacing.json. Outputs are arrays of prompt lines
// the system-prompt builder can spread directly into its line list.

/**
 * Recursively flattens a Subtopic tree into bullet lines. The PDF excerpts
 * already include their own leading markers (em-dashes, hyphens) so we just
 * preserve what the extractor captured verbatim and add a 2-space indent
 * per nesting level.
 */
export function formatSubtopics(subtopics, depth = 0) {
  if (!Array.isArray(subtopics) || subtopics.length === 0) return [];
  const lines = [];
  const indent = '  '.repeat(depth);
  for (const st of subtopics) {
    if (st.heading) lines.push(`${indent}- ${st.heading}`);
    for (const c of st.concepts || []) lines.push(`${indent}  • ${c}`);
    lines.push(...formatSubtopics(st.children || [], depth + 1));
  }
  return lines;
}

/**
 * Renders a single Unit as compact prompt-ready text. Skips fields that
 * are empty so the section stays small for sparse units (e.g. a revision
 * block with no subtopics).
 */
export function formatPacingUnit(u) {
  const lines = [];
  const flags = [];
  if (u.isRevision) flags.push('REVISION');
  if (u.isAssessmentSlot) flags.push('FORMAL ASSESSMENT SLOT');
  const flagSuffix = flags.length ? ` [${flags.join(', ')}]` : '';
  lines.push(`### ${u.topic}${flagSuffix}`);
  if (u.capsStrand) {
    lines.push(`CAPS strand: ${u.capsStrand}${u.subStrand ? ` / ${u.subStrand}` : ''}`);
  }
  if (u.subtopics?.length) {
    lines.push(`Concepts and skills:`);
    lines.push(...formatSubtopics(u.subtopics));
  }
  if (u.prerequisites?.length) {
    lines.push(`Prior knowledge (do not re-teach; assume learners have this):`);
    for (const p of u.prerequisites) lines.push(`  • ${p}`);
  }
  if (u.notes?.length) {
    lines.push(`CAPS notes:`);
    for (const n of u.notes) lines.push(`  • ${n}`);
  }
  return lines.join('\n');
}

/**
 * Renders the per-skill mark-split structure of a CAPS formal assessment.
 * This is the single biggest gain for Languages papers — without it, the
 * model improvises Listening/Reading/Writing/LSC mark splits.
 * Returns null when there's nothing structural to inject.
 */
export function formatFormalAssessmentStructure(assessments, resourceType, totalMarks) {
  if (!Array.isArray(assessments) || assessments.length === 0) return null;
  // Match by mark range first (within ±40% of requested totalMarks). Avoids
  // forcing a 20-mark Oral structure onto a 50-mark written Test.
  const tolerantMatch = assessments.find((a) => {
    const total = a.totalMarks || a.maxMarks || 0;
    if (!total || !totalMarks) return false;
    const ratio = Math.abs(total - totalMarks) / totalMarks;
    return ratio <= 0.4;
  }) || assessments[0];
  if (!tolerantMatch?.sections?.length) return null;
  const lines = [`This ${resourceType} aligns with CAPS Formal Assessment "${tolerantMatch.label}".`];
  if (tolerantMatch.totalMarks) {
    lines.push(`CAPS prescribes a total of ${tolerantMatch.totalMarks} marks split as:`);
  } else {
    lines.push(`CAPS prescribes the following section structure:`);
  }
  for (const sec of tolerantMatch.sections) {
    const strand = sec.capsStrand ? ` (${sec.capsStrand})` : '';
    lines.push(`  • ${sec.label}${strand} — ${sec.marks} marks`);
  }
  if (tolerantMatch.conditions) lines.push(`Conditions: ${tolerantMatch.conditions}`);
  return lines.join('\n');
}

/**
 * Build the "## CAPS reference" block from the request's pacing units.
 * Returns [] when no pacing data is available so the prompt stays
 * unchanged for legacy code paths and tests. Excludes assessment-slot
 * rows (those carry no pedagogical content) to keep the block tight.
 */
export function buildCapsReferenceBlock(pacingUnits) {
  if (!pacingUnits?.length) return [];
  const teaching = pacingUnits.filter((u) => !u.isAssessmentSlot);
  if (teaching.length === 0) return [];
  return [
    `## CAPS reference (verbatim from the Annual Teaching Plan)`,
    `Use the concepts and skills below as the source of truth for what to assess. ` +
      `Ground every question in these CAPS bullets — do NOT introduce concepts ` +
      `that aren't listed here, and do NOT re-test prerequisites that learners ` +
      `should already have from prior grades.`,
    ``,
    teaching.map(formatPacingUnit).join('\n\n'),
    ``,
  ];
}

/**
 * Build the per-paper "## CAPS assessment structure" block. Mainly
 * impactful for Languages assessments where CAPS prescribes a per-skill
 * mark split that the model otherwise improvises. Returns [] when no
 * matching structure exists.
 */
export function buildAssessmentStructureBlock(assessments, resourceType, totalMarks) {
  const block = formatFormalAssessmentStructure(assessments, resourceType, totalMarks);
  if (!block) return [];
  return [
    `## CAPS assessment structure`,
    block,
    `Your section/composite mark allocations MUST follow this split. Section titles ` +
      `should reflect the labels above (translated to the requested language).`,
    ``,
  ];
}
