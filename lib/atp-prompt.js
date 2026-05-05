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
 * Picks the single best-matching CAPS formal assessment for a request,
 * returning the full assessment object (or null when nothing fits the
 * mark-tolerance band). Shared between the prompt-block builder and
 * the rebalancer's section-target enforcement (Phase F).
 */
export function pickFormalAssessment(assessments, resourceType, totalMarks) {
  if (!Array.isArray(assessments) || assessments.length === 0) return null;
  const preferTypes = preferredTypesFor(resourceType);
  const scored = assessments
    .map((a) => ({ a, score: scoreAssessment(a, totalMarks, preferTypes) }))
    .filter(({ score }) => score >= 0)
    .sort((x, y) => y.score - x.score);
  return scored[0]?.a || null;
}

/**
 * Returns the prescribed section-mark targets for a request, scaled to
 * the requested totalMarks if the CAPS assessment's total differs.
 *
 * Example: CAPS assessment has sections [20, 10, 5, 15] = 50 total. User
 * requests a 40-mark Test. We scale by 40/50 = 0.8, then redistribute
 * leftover via the largest-remainder method so the integers still sum to
 * exactly 40. Returns null when no structure is available or totals don't
 * match within mark tolerance (caller skips Phase 4 in that case).
 *
 * Format: array of { label, marks, capsStrand } in the order CAPS
 * prescribes — same order the prompt block emits, so generated sections
 * align by index when the model follows the prompt.
 */
export function prescribedSectionMarksFor(assessments, resourceType, totalMarks) {
  const best = pickFormalAssessment(assessments, resourceType, totalMarks);
  if (!best?.sections?.length) return null;
  const capsTotal = best.totalMarks
    || best.sections.reduce((a, s) => a + (s.marks || 0), 0);
  if (!capsTotal) return null;

  // Scale section marks to the request's total. Largest-remainder ensures
  // the integer marks sum to exactly totalMarks even when capsTotal !== totalMarks.
  const raw = best.sections.map((s) => ((s.marks || 0) * totalMarks) / capsTotal);
  const floored = raw.map(Math.floor);
  const deficit = totalMarks - floored.reduce((a, b) => a + b, 0);
  const remainders = raw
    .map((r, i) => ({ i, frac: r - floored[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < deficit; k++) floored[remainders[k % remainders.length].i]++;

  return best.sections.map((s, i) => ({
    label: s.label,
    capsStrand: s.capsStrand || null,
    marks: floored[i],
  }));
}

/**
 * Renders the per-skill mark-split structure of a CAPS formal assessment.
 * This is the single biggest gain for Languages papers — without it, the
 * model improvises Listening/Reading/Writing/LSC mark splits.
 * Returns null when there's nothing structural to inject.
 *
 * Selection (changed 2026-05 after teacher review found the matcher
 * picking the narrower Task 3 "Response to Texts" over the comprehensive
 * Task 5 "June Controlled Test" for an English HL Gr6 T2 Exam): rank
 * candidates by a composite score that prefers (1) close mark match,
 * (2) request resourceType ↔ assessment type alignment, and
 * (3) more sections (= more comprehensive paper).
 */
export function formatFormalAssessmentStructure(assessments, resourceType, totalMarks) {
  if (!Array.isArray(assessments) || assessments.length === 0) return null;

  const preferTypes = preferredTypesFor(resourceType);
  const scored = assessments
    .map((a) => ({ a, score: scoreAssessment(a, totalMarks, preferTypes) }))
    .filter(({ score }) => score >= 0)
    .sort((x, y) => y.score - x.score);

  const best = scored[0]?.a;
  if (!best?.sections?.length) return null;

  const lines = [`This ${resourceType} aligns with CAPS Formal Assessment "${best.label}".`];
  if (best.totalMarks) {
    lines.push(`CAPS prescribes a total of ${best.totalMarks} marks split as:`);
  } else {
    lines.push(`CAPS prescribes the following section structure:`);
  }
  for (const sec of best.sections) {
    const strand = sec.capsStrand ? ` (${sec.capsStrand})` : '';
    lines.push(`  • ${sec.label}${strand} — ${sec.marks} marks`);
  }
  if (best.conditions) lines.push(`Conditions: ${best.conditions}`);
  return lines.join('\n');
}

// Map a request resourceType to the preferred CAPS assessment type(s) in
// priority order. Examination wins for Exam/Test/Final Exam (the most
// comprehensive paper at term-end), since the wife's 2026-05 review was
// against papers that should have used the Examination shape. Tests prefer
// Examination structure too because the wife's annotated paper was
// effectively the term-end controlled test, not a mid-term Response-to-Text.
function preferredTypesFor(resourceType) {
  if (resourceType === 'Exam' || resourceType === 'Final Exam') return ['Examination', 'Test'];
  if (resourceType === 'Test') return ['Examination', 'Test'];
  if (resourceType === 'Worksheet') return ['Test', 'Practical Task'];
  if (resourceType === 'Project') return ['Project'];
  if (resourceType === 'Investigation') return ['Investigation'];
  if (resourceType === 'Practical') return ['Practical Task'];
  if (resourceType === 'Assignment') return ['Assignment'];
  return [];
}

function scoreAssessment(a, totalMarks, preferTypes) {
  const total = a.totalMarks || a.maxMarks || 0;
  if (!total || !totalMarks) return -1;
  const ratio = Math.abs(total - totalMarks) / totalMarks;
  if (ratio > 0.4) return -1; // out of mark range — disqualify
  // Base score: 100 minus a mark-distance penalty (close-match wins).
  let score = 100 - (ratio * 50);
  const typeIdx = preferTypes.indexOf(a.type);
  if (typeIdx === 0) score += 30;
  else if (typeIdx > 0) score += 15;
  // More sections = more comprehensive structure (Task 5 over Task 3).
  score += (a.sections?.length || 0) * 5;
  return score;
}

/**
 * Build the "## Out of scope for this paper" block listing pacing units
 * from OTHER terms of the same subject + grade. Lets the model see what
 * is NOT in scope so it doesn't invent money-context word problems for a
 * Term 2 Maths paper, or test conditional sentences in Term 1 English.
 *
 * Filters out assessment-slot rows (no pedagogical content) and revision
 * rows (no specific topic to police). Returns [] when there's nothing
 * useful to emit (e.g. Final Exam covers all four terms — no out-of-scope
 * topics to list).
 */
export function buildOutOfScopeBlock(outOfScopeUnits) {
  if (!Array.isArray(outOfScopeUnits) || outOfScopeUnits.length === 0) return [];
  const teaching = outOfScopeUnits.filter((u) => !u.isAssessmentSlot && !u.isRevision);
  if (teaching.length === 0) return [];
  // Group by term so the block stays scannable even on big subject corpora.
  const byTerm = new Map();
  for (const u of teaching) {
    const t = u._term || u.term || 'other';
    if (!byTerm.has(t)) byTerm.set(t, []);
    byTerm.get(t).push(u.topic);
  }
  const lines = [
    `## Out of scope for this paper`,
    `These CAPS topics are taught in OTHER terms of this grade and MUST NOT be tested in this paper:`,
  ];
  for (const [t, topics] of [...byTerm.entries()].sort()) {
    lines.push(`  Term ${t}:`);
    for (const topic of topics) lines.push(`    • ${topic}`);
  }
  lines.push(`Do not include questions, contexts, calculations, or scenarios that test these topics. For example: if "Money" or "Financial mathematics" appears only in a later term, do NOT write money-context word problems with rand amounts. If "Conditional sentences" is taught only in Grade 7, do NOT test conditionals at Grade 6 even when teaching tense or sentence types.`);
  lines.push(``);
  return lines;
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
export function buildLessonContextBlock(unit, lessonMinutes, language, subtopic = null) {
  if (!unit) return [];
  const af = language === 'Afrikaans';
  const focused = !!(subtopic && subtopic.heading);

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

  // When a subtopic is chosen, render its concepts list verbatim so the
  // model has a tightly-scoped focus instead of the whole Unit's concept
  // tree. Without this, two lessons against the same 6h Unit drift toward
  // the same "introduction" content and overlap heavily.
  const subtopicConcepts = focused
    ? (Array.isArray(subtopic.concepts) ? subtopic.concepts : []).map((c) => `    ${c}`)
    : [];

  const lines = [
    `## Lesson plan directives`,
    focused
      ? `You are designing ONE classroom lesson of ${lessonMinutes} minutes within the CAPS Unit "${unit.topic}". The lesson focuses NARROWLY on the subtopic "${subtopic.heading}" — not the whole Unit. Other subtopics of this Unit will be taught in separate lessons.`
      : `You are designing ONE classroom lesson of ${lessonMinutes} minutes that teaches the CAPS Unit "${unit.topic}".`,
    unit.capsStrand
      ? `CAPS strand: ${unit.capsStrand}${unit.subStrand ? ` / ${unit.subStrand}` : ''}.`
      : '',
    Array.isArray(unit.weeks) && unit.weeks.length
      ? `This Unit spans week${unit.weeks.length > 1 ? 's' : ''} ${unit.weeks.join(', ')} of the term${unit.hours ? ` (${unit.hours} hours total allocated)` : ''}.`
      : '',
    ``,
    ...(focused ? [
      `### Subtopic focus`,
      `Cover ONLY these concepts (verbatim from the CAPS subtopic "${subtopic.heading}"):`,
      ...(subtopicConcepts.length ? subtopicConcepts : [`    (no detailed concepts in CAPS — teach the subtopic at an introductory level)`]),
      `Do NOT introduce concepts from other subtopics of the Unit. The teacher will generate separate lessons for those.`,
      ``,
    ] : []),
    `### Two conventions worth following`,
    `These two help downstream rendering but are auto-inferred when omitted, so they aren't fail-the-tool-call constraints — just useful to set when natural:`,
    `  • The 4th phase ("${phaseNames[3]}") is the worksheet-completion phase. You may set \`worksheetRef: true\` on it; if you don't, the renderer treats the "${phaseNames[3]}" phase as the worksheet phase by name.`,
    `  • Slide #1 is the lesson opener. You may give it \`layout: "title"\`; if you don't, the renderer treats the lowest-ordinal slide as the title regardless of its declared layout.`,
    ``,
    `### Required fields under \`lesson\``,
    `Populate the resource's \`lesson\` branch with:`,
    `  - lessonMinutes: ${lessonMinutes}`,
    `  - capsAnchor: { unitTopic, capsStrand, subStrand, weekRange, sourcePdf, sourcePage } pulled from the Unit above.${focused ? ` Set capsAnchor.subStrand to "${subtopic.heading}" so the lesson plan header tells the teacher which subtopic this lesson covers.` : ''}`,
    `  - learningObjectives: 3–5 objectives, each starting with "${af ? 'Aan die einde van die les sal leerders' : 'By the end of this lesson learners will be able to'}…". ${focused ? `Every objective MUST come from the subtopic concepts listed above` : `Anchor each objective in a CAPS bullet from the Unit's concepts list`} — do NOT introduce content not in the ${focused ? 'subtopic' : 'Unit'}.`,
    `  - priorKnowledge: list assumed prior knowledge VERBATIM from the Unit's prerequisites where they exist.`,
    `  - vocabulary: 3–6 key terms with short, learner-appropriate definitions in ${language}.`,
    `  - materials: physical resources the teacher will need (chart paper, counters, ruler, etc.).`,
    `  - phases: an array of ${phaseNames.length} phases, in this order, with the prescribed minute budget. Each phase must have at least one teacherActions entry and at least one learnerActions entry.`,
    `      1. ${phaseNames[0]} — ${intro} minutes`,
    `      2. ${phaseNames[1]} — ${direct} minutes`,
    `      3. ${phaseNames[2]} — ${guided} minutes`,
    `      4. ${phaseNames[3]} — ${indep} minutes (the attached worksheet — sections+memo — is what learners do here)`,
    `      5. ${phaseNames[4]} — ${consolid} minutes`,
    `    Phase minute totals MUST sum to ${lessonMinutes} (±5).`,
    `  - slides: a learner-facing slide deck of 6–10 slides (rendered to PowerPoint by the system). Slides MUST follow these structural rules:`,
    `      • ordinals are 1, 2, 3, … unique and gap-free.`,
    `      • Slide #1 is the lesson opener — its heading is the lesson topic (≤8 words). \`layout:"title"\` is recommended for it; the renderer treats slide #1 as a title regardless if you choose another layout.`,
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
