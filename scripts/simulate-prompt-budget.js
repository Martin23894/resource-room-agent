#!/usr/bin/env node
// scripts/simulate-prompt-budget.js
//
// Dry-run estimator. Walks every subject × grade × resourceType combination
// the generator can be asked for, builds the prompt scope (legacy topic list
// + new CAPS-pacing reference + assessment-structure block), and reports:
//
//   - input chars / tokens for the new CAPS sections
//   - total scope size (tokens) for the worst-case Final Exam paths
//   - margin against the existing 200K context window
//
// The point is to confirm that adding the CAPS reference doesn't push any
// real request near the input limit before we land the change. Output
// budget (max_tokens=16000) and 240s per-call timeout are NOT changed by
// this PR, so they're noted but not measured here — they are governed by
// model output speed which only a live API call can confirm.
//
// Usage: node scripts/simulate-prompt-budget.js
//        node scripts/simulate-prompt-budget.js --top 10
//        node scripts/simulate-prompt-budget.js --resource "Final Exam"

import {
  ATP,
  EXAM_SCOPE,
  getATPTopics,
  getPacingUnits,
  getPacingFormalAssessments,
  hasPacingData,
} from '../lib/atp.js';
import {
  buildCapsReferenceBlock,
  buildAssessmentStructureBlock,
} from '../lib/atp-prompt.js';

// ---------- CLI -------------------------------------------------------

function parseArgs(argv) {
  const args = { top: null, resource: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--top') args.top = Number(argv[++i]);
    else if (argv[i] === '--resource') args.resource = argv[++i];
  }
  return args;
}

// Rough token estimate: GPT-style BPE averages ~4 chars/token for English
// prose. For the CAPS reference (heavy on bullets, short headings, mixed
// English/Afrikaans) we calibrate slightly tighter at 3.8 chars/token to
// stay conservative. Anthropic's tokenizer is similar in practice.
const CHARS_PER_TOKEN = 3.8;
const tokenize = (s) => Math.ceil(s.length / CHARS_PER_TOKEN);

// ---------- Existing prompt baseline (non-CAPS sections) --------------

// Number rounded up from a representative buildSystemPrompt output for
// Maths Gr 4 T1 Worksheet (without my new sections) — measured locally as
// ~12,500 chars before the topic list. Treated as a constant baseline so
// we can estimate input-token impact of the additions cleanly.
const BASE_PROMPT_CHARS = 12_500;

// Average per-topic bullet length in the legacy "topic list" section.
const TOPIC_LIST_LINE_CHARS = 80;

// Tool-schema cost (the build_resource tool definition the API serialises
// into the request). Roughly stable across requests; measured at ~3.5 KB.
const TOOL_SCHEMA_CHARS = 3_500;

// ---------- Scope computation -----------------------------------------

function coversTermsFor(resourceType, term) {
  if (resourceType === 'Final Exam') return [1, 2, 3, 4];
  if (resourceType === 'Exam') return EXAM_SCOPE[term] || [term];
  return [term];
}

function buildScope({ subject, grade, term, resourceType }) {
  const coversTerms = coversTermsFor(resourceType, term);
  const isExamType = resourceType === 'Exam' || resourceType === 'Final Exam';

  const topics = coversTerms.flatMap((t) => ATP[subject]?.[grade]?.[t] || []);
  const pacingUnits = coversTerms.flatMap((t) => getPacingUnits(subject, grade, t, false));
  const pacingFormalAssessments = getPacingFormalAssessments(subject, grade, term, isExamType);

  // Crude representative totalMarks per resourceType — used only to drive
  // the assessment-structure tolerance match.
  const totalMarks = ({
    Worksheet: 20,
    Test: 50,
    Exam: 70,
    'Final Exam': 100,
  })[resourceType] || 50;

  const refBlock = buildCapsReferenceBlock(pacingUnits).join('\n');
  const structBlock = buildAssessmentStructureBlock(pacingFormalAssessments, resourceType, totalMarks).join('\n');

  return {
    coversTerms,
    topicCount: topics.length,
    unitCount: pacingUnits.length,
    refChars: refBlock.length,
    structChars: structBlock.length,
    totalMarks,
  };
}

// ---------- Subjects to walk ------------------------------------------

const SUBJECT_GRADES = [
  // Intermediate phase (Gr 4-6)
  ['Mathematics', [4, 5, 6]],
  ['Natural Sciences and Technology', [4, 5, 6]],
  ['English Home Language', [4, 5, 6]],
  ['English First Additional Language', [4, 5, 6]],
  ['Afrikaans Home Language', [4, 5, 6]],
  ['Afrikaans First Additional Language', [4, 5, 6]],
  ['Social Sciences — History', [4, 5, 6]],
  ['Social Sciences — Geography', [4, 5, 6]],
  ['Life Skills — Personal and Social Wellbeing', [4, 5, 6]],
  ['Life Skills — Physical Education', [4, 5, 6]],
  ['Life Skills — Creative Arts', [4, 5, 6]],
  // Senior phase (Gr 7)
  ['Mathematics', [7]],
  ['Natural Sciences', [7]],
  ['Technology', [7]],
  ['English Home Language', [7]],
  ['English First Additional Language', [7]],
  ['Afrikaans Home Language', [7]],
  ['Afrikaans First Additional Language', [7]],
  ['Social Sciences — History', [7]],
  ['Social Sciences — Geography', [7]],
  ['Life Orientation', [7]],
  ['Economic and Management Sciences', [7]],
];

const RESOURCE_TYPES = ['Worksheet', 'Test', 'Exam', 'Final Exam'];

// ---------- Run --------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const filterResource = args.resource;

  const rows = [];
  let pacingMissing = 0;
  let measured = 0;

  for (const [subject, grades] of SUBJECT_GRADES) {
    for (const grade of grades) {
      for (const resourceType of RESOURCE_TYPES) {
        if (filterResource && resourceType !== filterResource) continue;
        // Term picker: for Final Exam term doesn't matter (covers all 4);
        // for Exam pick T2 (the cross-term case) and T4.
        const terms = resourceType === 'Final Exam' ? [4]
          : resourceType === 'Exam' ? [2, 4]
          : [1, 2, 3, 4];
        for (const term of terms) {
          const hasTopics = (ATP[subject]?.[grade]?.[term] || []).length > 0;
          if (!hasTopics) continue;
          if (!hasPacingData(subject, grade)) { pacingMissing++; continue; }

          const scope = buildScope({ subject, grade, term, resourceType });
          const topicListChars = scope.topicCount * TOPIC_LIST_LINE_CHARS;
          const oldPromptChars = BASE_PROMPT_CHARS + topicListChars + TOOL_SCHEMA_CHARS;
          const newPromptChars = oldPromptChars + scope.refChars + scope.structChars;
          const oldTokens = tokenize('x'.repeat(oldPromptChars));
          const newTokens = tokenize('x'.repeat(newPromptChars));

          rows.push({
            subject, grade, term, resourceType,
            coversTerms: scope.coversTerms.join(','),
            units: scope.unitCount,
            topics: scope.topicCount,
            oldTokens,
            newTokens,
            addedTokens: newTokens - oldTokens,
            refChars: scope.refChars,
            structChars: scope.structChars,
          });
          measured++;
        }
      }
    }
  }

  // Sort by addedTokens desc (worst-impact requests first).
  rows.sort((a, b) => b.newTokens - a.newTokens);

  const top = args.top ? rows.slice(0, args.top) : rows;

  console.log(`Measured: ${measured} subject×grade×term×resourceType combinations`);
  if (pacingMissing > 0) console.log(`Skipped:  ${pacingMissing} cells with no pacing data (legacy code path unaffected)`);
  console.log();
  console.log('Worst-case prompt sizes (sorted by NEW total tokens):');
  console.log();
  console.log(
    'subject'.padEnd(48) +
    'gr'.padEnd(4) +
    't'.padEnd(3) +
    'resourceType'.padEnd(13) +
    'units'.padEnd(7) +
    'old'.padEnd(8) +
    'new'.padEnd(8) +
    '+tok'.padEnd(7) +
    '%ctx'
  );
  console.log('-'.repeat(120));
  for (const r of top) {
    const pctOfContext = (r.newTokens / 200_000 * 100).toFixed(1);
    console.log(
      r.subject.slice(0, 47).padEnd(48) +
      String(r.grade).padEnd(4) +
      String(r.term).padEnd(3) +
      r.resourceType.padEnd(13) +
      String(r.units).padEnd(7) +
      String(r.oldTokens).padEnd(8) +
      String(r.newTokens).padEnd(8) +
      `+${r.addedTokens}`.padEnd(7) +
      pctOfContext + '%'
    );
  }

  // Summary stats.
  const max = rows.reduce((m, r) => Math.max(m, r.newTokens), 0);
  const finalExams = rows.filter((r) => r.resourceType === 'Final Exam');
  const maxFinalExam = finalExams.reduce((m, r) => Math.max(m, r.newTokens), 0);
  const maxAdded = rows.reduce((m, r) => Math.max(m, r.addedTokens), 0);

  console.log();
  console.log('=== SUMMARY ===');
  console.log(`Largest prompt overall:        ${max.toLocaleString()} tokens (${(max / 200_000 * 100).toFixed(1)}% of 200K context)`);
  console.log(`Largest Final Exam prompt:     ${maxFinalExam.toLocaleString()} tokens (${(maxFinalExam / 200_000 * 100).toFixed(1)}% of 200K context)`);
  console.log(`Worst-case CAPS-block addition: ${maxAdded.toLocaleString()} tokens`);
  console.log();
  console.log('Hard limits this PR DOES affect:');
  console.log(`  Sonnet 4.6 input context:    200,000 tokens — margin = ${(200_000 - max).toLocaleString()} tokens (${((200_000 - max)/200_000*100).toFixed(1)}% free)`);
  console.log();
  console.log('Hard limits this PR DOES NOT change (still bounded by existing fixes):');
  console.log('  Output max_tokens:           16,000  (api/generate.js:362, unchanged)');
  console.log('  Per-call timeout:            240 sec (lib/anthropic.js:45, unchanged)');
  console.log('  Wall-clock ceiling:          330 sec (api/generate.js:631, unchanged)');
  console.log('  Final Exam retries:          0 attempts (single shot, unchanged)');
  console.log();
  console.log('What this script CANNOT tell you (only a live API call can):');
  console.log('  • Whether richer prompt context makes the model write longer outputs');
  console.log('    that approach the 16K output cap on Final Exams.');
  console.log('  • Whether the marginal extra input tokens (~3-5K) push wall-clock');
  console.log('    generation time over the 240s per-call budget on Final Exams.');
}

main();
