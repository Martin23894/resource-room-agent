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

/**
 * Build the lesson-generation directives. Only emitted when resourceType
 * is "Lesson". Pins the model to a single CAPS Unit, prescribes the phase
 * structure, and links the lesson to the embedded worksheet (which is just
 * the existing sections+memo in a small mark allocation).
 */
export function buildLessonContextBlock(unit, lessonMinutes, language) {
  if (!unit) return [];
  const af = language === 'Afrikaans';

  // Prescribe minute-budgets for each phase based on lessonMinutes. We use
  // CAPS-conventional ratios: ~10/30/25/25/10. The model rebalances minutes
  // within ±5 of the total, but starts with these targets so short lessons
  // don't end up with one huge "Direct Teaching" block.
  const intro     = Math.max(5, Math.round(lessonMinutes * 0.10));
  const direct    = Math.max(8, Math.round(lessonMinutes * 0.30));
  const guided    = Math.max(5, Math.round(lessonMinutes * 0.25));
  const indep     = Math.max(5, Math.round(lessonMinutes * 0.25));
  const consolid  = Math.max(3, lessonMinutes - intro - direct - guided - indep);

  const phaseNames = af
    ? ['Inleiding', 'Direkte Onderrig', 'Begeleide Oefening', 'Onafhanklike Werk', 'Konsolidasie']
    : ['Introduction', 'Direct Teaching', 'Guided Practice', 'Independent Work', 'Consolidation'];

  const lines = [
    `## Lesson plan directives`,
    `You are designing ONE classroom lesson of ${lessonMinutes} minutes that teaches the CAPS Unit "${unit.topic}".`,
    unit.capsStrand
      ? `CAPS strand: ${unit.capsStrand}${unit.subStrand ? ` / ${unit.subStrand}` : ''}.`
      : '',
    Array.isArray(unit.weeks) && unit.weeks.length
      ? `This Unit spans week${unit.weeks.length > 1 ? 's' : ''} ${unit.weeks.join(', ')} of the term${unit.hours ? ` (${unit.hours} hours total allocated)` : ''}.`
      : '',
    ``,
    `Populate the resource's \`lesson\` branch with:`,
    `  - lessonMinutes: ${lessonMinutes}`,
    `  - capsAnchor: { unitTopic, capsStrand, subStrand, weekRange, sourcePdf, sourcePage } pulled from the Unit above.`,
    `  - learningObjectives: 3–5 objectives, each starting with "${af ? 'Aan die einde van die les sal leerders' : 'By the end of this lesson learners will be able to'}…". Anchor each objective in a CAPS bullet from the Unit's concepts list — do NOT introduce content not in the Unit.`,
    `  - priorKnowledge: list assumed prior knowledge VERBATIM from the Unit's prerequisites where they exist.`,
    `  - vocabulary: 3–6 key terms with short, learner-appropriate definitions in ${language}.`,
    `  - materials: physical resources the teacher will need (chart paper, counters, ruler, etc.).`,
    `  - phases: an array of ${phaseNames.length} phases, in this order, with the prescribed minute budget. Each phase must have at least one teacherActions entry and at least one learnerActions entry.`,
    `      1. ${phaseNames[0]} — ${intro} minutes`,
    `      2. ${phaseNames[1]} — ${direct} minutes`,
    `      3. ${phaseNames[2]} — ${guided} minutes`,
    `      4. ${phaseNames[3]} — ${indep} minutes — set worksheetRef:true on THIS phase. The attached worksheet (sections+memo) is what learners do here.`,
    `      5. ${phaseNames[4]} — ${consolid} minutes`,
    `    Phase minute totals MUST sum to ${lessonMinutes} (±5).`,
    `  - slides: a learner-facing slide deck of 6–10 slides (rendered to PowerPoint by the system). Slides MUST follow these structural rules:`,
    `      • ordinals are 1, 2, 3, … unique and gap-free.`,
    `      • Slide 1 MUST have layout:"title" — heading is the lesson topic (≤8 words). Use it to open the lesson, not as a chapter divider mid-deck.`,
    `      • Include exactly ONE layout:"objectives" slide near the start, listing the learning objectives (rephrased to be learner-facing — short and crisp, not the full "By the end of this lesson…" sentence).`,
    `      • Include ONE layout:"vocabulary" slide if there are 2 or more key terms. Bullets are optional — if omitted, the renderer pulls from lesson.vocabulary.`,
    `      • The MIDDLE of the deck is layout:"concept" and layout:"example" slides — these carry the actual teaching. Each slide has a short heading (≤8 words) and 2–6 bullets the teacher will talk through. NEVER put more than 8 bullets on a slide. Speaker notes go in speakerNotes, NOT in bullets — bullets are what the LEARNER sees, speakerNotes are what the TEACHER says.`,
    `      • Use layout:"diagram" only when you also declared a renderable stimulus (bar_graph / number_line / food_chain) and the stimulus genuinely supports the lesson. The slide MUST set stimulusRef to the stimulus.id. Do NOT invent a diagram slide whose stimulus you did not declare in stimuli[].`,
    `      • Include ONE layout:"practice" slide that previews the worksheet question(s) — it cues the learner to start the worksheet. Heading like "Now try these…" (in ${language}).`,
    `      • End with ONE layout:"exitTicket" slide carrying the consolidation question(s). 1–3 short bullets max.`,
    `    Every slide MUST have speakerNotes (2–4 sentences) — these are the teacher's prompts and do not appear in the learner-visible bullets.`,
    `  - differentiation: short adaptations for below/onGrade/above learners (1–3 bullets each).`,
    `  - homework: a short follow-up task with estimatedMinutes.`,
    `  - teacherNotes: 2–4 misconception-correction pairs or classroom-management tips.`,
    ``,
    `## Worksheet (the sections+memo branch)`,
    `The sections+memo branch is the IN-CLASS worksheet learners complete during the "${phaseNames[3]}" phase.`,
    `Keep it short and focused — typically a single section, ${language === 'Afrikaans' ? 'in Afrikaans' : 'in English'}, with practice items that directly check the lesson's learning objectives.`,
    `Every leaf question's topic MUST be exactly "${unit.topic}".`,
    ``,
  ].filter(Boolean);

  return lines;
}
