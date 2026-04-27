// Schema-first generation spike (Day 2).
//
// One Claude tool call. Sonnet 4.6, large maxTokens, forced tool use.
// The tool's input_schema is the per-request narrowed Resource schema
// (see schema/resource.schema.js → narrowSchemaForRequest). Sonnet returns
// a single structured object; we run assertResource over it and report.
//
// Day 2 only answers "can the model fill the schema reliably across the
// matrix?". No DOCX rendering, no validation feedback loop, no frontend
// wiring here. Day 3+ work is conditional on the answer.

import { callAnthropicTool } from '../lib/anthropic.js';
import { getCogLevels, isBarretts, marksToTime, largestRemainder } from '../lib/cognitive.js';
import { ATP, EXAM_SCOPE } from '../lib/atp.js';
import { resourceTypeLabel, subjectDisplayName, localiseDuration } from '../lib/i18n.js';
import { narrowSchemaForRequest, assertResource } from '../schema/resource.schema.js';

const SONNET_4_6 = 'claude-sonnet-4-6';

/**
 * Build the topic scope (terms covered + ATP topics) for a request.
 * - Worksheet/Test       → [t]              term-only content
 * - Exam (T2, T4)        → EXAM_SCOPE[t]    cross-term per CAPS
 * - Exam (T1, T3)        → [t]              single-term exams
 * - Final Exam           → [1,2,3,4]        full year
 */
function topicScopeFor(subject, grade, term, resourceType) {
  let coversTerms;
  if (resourceType === 'Final Exam') coversTerms = [1, 2, 3, 4];
  else if (resourceType === 'Exam') coversTerms = EXAM_SCOPE[term] || [term];
  else coversTerms = [term];

  const topics = coversTerms.flatMap((t) => ATP[subject]?.[grade]?.[t] || []);
  // De-dup while preserving order — different terms occasionally repeat a topic.
  const seen = new Set();
  const unique = [];
  for (const t of topics) {
    if (seen.has(t)) continue;
    seen.add(t);
    unique.push(t);
  }
  return { coversTerms, topics: unique };
}

/**
 * Build the per-request context object the spike needs:
 * cognitive framework, prescribed marks, topic scope, derived labels.
 */
function buildContext(req) {
  const { subject, grade, term, language, resourceType, totalMarks, difficulty = 'on' } = req;

  const cog = getCogLevels(subject);
  const frameworkName = isBarretts(cog) ? "Barrett's" : "Bloom's";
  const prescribedMarks = largestRemainder(totalMarks, cog.pcts);
  const cogLevels = cog.levels.map((name, i) => ({
    name,
    percent: cog.pcts[i],
    prescribedMarks: prescribedMarks[i],
  }));

  const { coversTerms, topics } = topicScopeFor(subject, grade, term, resourceType);
  if (topics.length === 0) {
    throw new Error(`No ATP topics for subject="${subject}" grade=${grade} term=${term}`);
  }

  const durationMin = parseDurationMinutes(marksToTime(totalMarks));
  const localisedDurationLabel = localiseDuration(marksToTime(totalMarks), language);
  const subjectDisplay = subjectDisplayName(subject, language);
  const localResourceLabel = resourceTypeLabel(resourceType, language);

  return {
    subject, grade, term, language, resourceType, totalMarks, difficulty,
    frameworkName, cogLevels,
    cognitiveLevelNames: cogLevels.map((l) => l.name),
    coversTerms, topics,
    durationMin, localisedDurationLabel, subjectDisplay, localResourceLabel,
  };
}

function parseDurationMinutes(label) {
  // marksToTime returns strings like "45 minutes", "1 hour", "1 hour 30 minutes".
  let mins = 0;
  const hoursMatch = label.match(/(\d+)\s*hour/);
  const minsMatch = label.match(/(\d+)\s*minute/);
  if (hoursMatch) mins += parseInt(hoursMatch[1], 10) * 60;
  if (minsMatch) mins += parseInt(minsMatch[1], 10);
  return mins || 60;
}

function buildSystemPrompt(ctx) {
  const {
    subject, grade, term, language, resourceType, totalMarks, difficulty,
    frameworkName, cogLevels, coversTerms, topics,
    durationMin, localisedDurationLabel, subjectDisplay, localResourceLabel,
  } = ctx;

  const cogTable = cogLevels
    .map((l) => `  - ${l.name}: ${l.percent}% = ${l.prescribedMarks} marks`)
    .join('\n');
  const topicList = topics.map((t) => `  - ${t}`).join('\n');
  const isRTT = subject.includes('Home Language') || subject.includes('First Additional')
    || subject.includes('Huistaal') || subject.includes('Addisionele') || subject.includes('Eerste');
  const isExamType = resourceType === 'Exam' || resourceType === 'Final Exam';

  return [
    `You are a CAPS-aligned exam-paper author for South African Grades 4–7.`,
    `Your job is to call the build_resource tool with a complete, structurally-valid Resource for the requested paper.`,
    ``,
    `## Request`,
    `- Subject:        ${subject} (display in ${language}: ${subjectDisplay})`,
    `- Grade:          ${grade}`,
    `- Term:           ${term}`,
    `- Resource type:  ${resourceType} (label "${localResourceLabel}")`,
    `- Language:       ${language}`,
    `- Total marks:    ${totalMarks}`,
    `- Duration:       ${durationMin} minutes (display "${localisedDurationLabel}")`,
    `- Difficulty:     ${difficulty} grade level`,
    ``,
    `## CAPS topic scope`,
    `This paper covers term${coversTerms.length > 1 ? 's' : ''} ${coversTerms.join(', ')} content.`,
    `Every question.topic MUST be one of these ATP topics:`,
    topicList,
    ``,
    `## Cognitive framework: ${frameworkName}`,
    `Your meta.cognitiveFramework MUST list these levels with these percentages and prescribed marks:`,
    cogTable,
    `Every leaf question's cognitiveLevel MUST be one of: ${cogLevels.map((l) => l.name).join(', ')}.`,
    `The actual mark distribution across cognitive levels should match the prescribed marks within ±${Math.max(1, Math.round(totalMarks * 0.02))} marks per level.`,
    ``,
    `## Structural rules (the schema enforces these — violations are rejected)`,
    `1. Every question is EITHER a LEAF (has marks, cognitiveLevel, answerSpace) OR a COMPOSITE (has subQuestions). Never both.`,
    `2. Composite marks are computed from leaves; do NOT put marks on composites.`,
    `3. Every leaf has exactly one matching memo.answer (matched on questionNumber). marks and cognitiveLevel must agree.`,
    `4. Sum of leaf marks across the whole paper MUST equal meta.totalMarks (${totalMarks}).`,
    `5. Stimuli are first-class. If a question references a passage/visual/data, declare it once in stimuli[] and reference it via stimulusRef.`,
    `6. Question numbers are dotted decimals: "1", "1.1", "1.1.1".`,
    ``,
    `## Resource-type guidance`,
    isRTT && isExamType
      ? `- This is a Response-to-Text (RTT) ${resourceType}. Section A MUST contain a passage stimulus (kind="passage") with the full body and a wordCount. Comprehension questions in Section A MUST stimulusRef that passage. RTT papers also typically include a Section B (summary, ~5 marks) referencing the same passage, and a Section C (language structures + visual text). The visual text in Section C is a separate stimulus (kind="visualText" with a verbal description, since we cannot generate images).`
      : isRTT
      ? `- This is a language ${resourceType}. Use stimuli where appropriate (passages for comprehension, visual texts for visual-literacy items).`
      : resourceType === 'Worksheet'
      ? `- A Worksheet is a single-section practice instrument; one section with letter=null is fine. Aim for short, focused items. ${totalMarks} marks total.`
      : resourceType === 'Test'
      ? `- A Test typically has 2–4 sections progressing from MCQ/short answer to extended response. ${totalMarks} marks total.`
      : `- An ${resourceType} typically has 3–5 sections progressing from short answer to extended response, with the harder cognitive levels concentrated in later sections. ${totalMarks} marks total.`,
    ``,
    `## Language and labels`,
    `- All learner-facing strings (cover, section titles, instructions, question stems, memo answers) MUST be written in ${language}.`,
    `- Cover: resourceTypeLabel="${localResourceLabel}", subjectLine="${subjectDisplay}", gradeLine="${language === 'Afrikaans' ? `Graad ${grade}` : `Grade ${grade}`}", termLine="${language === 'Afrikaans' ? `Kwartaal ${term}` : `Term ${term}`}".`,
    `- Section titles should be in ${language}, upper-cased.`,
    ``,
    `## Output`,
    `Call build_resource with the Resource object. Do not output anything else.`,
  ].join('\n');
}

function buildUserPrompt(ctx) {
  return [
    `Generate the ${ctx.resourceType} described in the system prompt.`,
    `Set meta.schemaVersion="1.0", meta.subject="${ctx.subject}", meta.grade=${ctx.grade}, meta.term=${ctx.term}, meta.language="${ctx.language}", meta.resourceType="${ctx.resourceType}", meta.totalMarks=${ctx.totalMarks}, meta.duration.minutes=${ctx.durationMin}, meta.difficulty="${ctx.difficulty}".`,
    `meta.topicScope.coversTerms=[${ctx.coversTerms.join(',')}], meta.topicScope.topics must be exactly the ATP topic list given above.`,
    `Ensure the leaf-mark sum equals ${ctx.totalMarks} and that every leaf has a corresponding memo answer.`,
  ].join('\n');
}

/**
 * Run the spike for a single request. Returns:
 *   { resource, validation, model, usage }
 * - resource: the parsed object the model passed to build_resource (always
 *             schema-shape valid by API guarantee)
 * - validation: assertResource(resource) result
 */
export async function generateV2(req, opts = {}) {
  const { logger, signal } = opts;
  const ctx = buildContext(req);
  const inputSchema = narrowSchemaForRequest({
    subject: ctx.subject,
    language: ctx.language,
    resourceType: ctx.resourceType,
    cognitiveLevels: ctx.cognitiveLevelNames,
    topics: ctx.topics,
  });

  const tool = {
    name: 'build_resource',
    description: 'Emit one structured Resource object describing the entire paper (cover + stimuli + sections + memo). The harness renders DOCX and the cog-analysis table from this object — do not include those artifacts here.',
    input_schema: inputSchema,
  };

  const system = buildSystemPrompt(ctx);
  const user = buildUserPrompt(ctx);

  const resource = await callAnthropicTool({
    system,
    user,
    tool,
    model: SONNET_4_6,
    maxTokens: 16000,
    cacheSystem: false, // spike: configurations differ; cache won't help much
    logger,
    signal,
    phase: 'generate-v2',
  });

  const validation = assertResource(resource);

  return { resource, validation, model: SONNET_4_6, ctx };
}

// Exposed for the spike runner.
export const __internals = { buildContext, topicScopeFor, parseDurationMinutes };
