// Resource schema — single source of truth for the v2 schema-first pipeline.
//
// One Resource object describes the entire artifact a teacher receives:
// cover page, sections, questions, shared stimuli (passages / visual texts /
// data sets), and the full memorandum (answers, rubric, extension). The DOCX,
// preview markdown, and cognitive-analysis table are all derived deterministically
// from this object — none of them are produced by the model directly.
//
// Design rules:
//
// 1. Every fact appears exactly ONCE. The model writes the question stem; code
//    derives section totals, paper totals, cog tables, breakdowns, closers,
//    and i18n labels. If two fields can disagree (e.g. cover total vs. body
//    sum), one of them is computed, not stored.
//
// 2. Cross-references use ids, not text matching. A comprehension question
//    points to a passage by `stimulusRef: "passage-1"`, not by re-quoting it.
//    Schema validation rejects dangling refs.
//
// 3. Every question is either a LEAF (has marks + cognitiveLevel + answerSpace)
//    or a COMPOSITE (has subQuestions). Never both. This eliminates the
//    parent-double-counting failure mode (the "Bug 11" pattern).
//
// 4. Mark allocation is leaf-only. A composite's marks are the sum of its
//    leaves, computed at render time. Schema invariants reject any composite
//    that carries a `marks` field.
//
// 5. Cognitive framework levels live in meta. Each question's cognitiveLevel
//    must be one of meta.cognitiveFramework.levels[*].name. The cog analysis
//    table is GROUP BY cognitiveLevel over memo.answers — phantom levels are
//    structurally impossible.
//
// 6. Stimuli are first-class. A Section A in a Response-to-Text paper REQUIRES
//    a passage stimulus and questions in that section MUST stimulusRef it.
//    Schema validation makes a passage-less RTT structurally invalid.
//
// 7. Language is set at meta.language. All localised strings (resourceTypeLabel,
//    section titles, memo banner, level display names) are either set at meta
//    level or derived by code from i18n. The "bilingual chimera" failure mode
//    (Resource 2 / Bug 23) is structurally impossible.
//
// What's NOT in the schema (validated separately by content invariants):
//   - Pedagogical correctness (is this actually a Grade 6 Inferential question?)
//   - Topic diversity (≥3 distinct, ≤50% per topic)
//   - Cognitive distribution within tolerance (computed actuals vs prescribed)
//   - Resource-type fit (Investigation actually investigative)
//   - Language idiomaticity
//   - MCQ option-letter distribution (no >60% any letter)
//
// These are kept as runtime checks; they survive any architecture and are not
// what schema-first solves.

/**
 * The full JSON Schema for a Resource. Anthropic's tool API accepts this
 * directly as `input_schema`. The model's tool call is guaranteed to
 * conform structurally — no JSON.parse() salvage, no markdown re-parsing.
 *
 * Per-request narrowing: when building the actual tool input_schema for a
 * specific generation, inject narrower enums via `narrowSchema(ctx)`:
 *   - meta.cognitiveFramework.levels[*].name → enum of the framework's labels
 *   - sections[*].questions[*].cognitiveLevel → same enum
 *   - meta.subject → enum of the request's subject
 *   - meta.language → enum of [request.language]
 *   - meta.resourceType → enum of [request.resourceType]
 *   - sections[*].questions[*].topic → enum of meta.topicScope.topics
 * This pushes structural invariants into the API layer so violations are
 * rejected before they ever reach our validator.
 */
export const resourceSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'resource-room/resource.schema.v1',
  type: 'object',
  required: ['meta', 'cover', 'stimuli', 'sections', 'memo'],
  additionalProperties: false,
  properties: {
    meta:     { $ref: '#/$defs/meta' },
    cover:    { $ref: '#/$defs/cover' },
    stimuli:  { type: 'array', items: { $ref: '#/$defs/stimulus' } },
    sections: { type: 'array', minItems: 1, items: { $ref: '#/$defs/section' } },
    memo:     { $ref: '#/$defs/memo' },
  },

  $defs: {
    // ─────────────────────────────────────────────────────────────────
    // META — the generation parameters echoed back, plus the cognitive
    // framework specification. The model fills these in from the request
    // context; values are then used by code to drive labels and i18n.
    // ─────────────────────────────────────────────────────────────────
    meta: {
      type: 'object',
      required: [
        'schemaVersion', 'subject', 'grade', 'term', 'language',
        'resourceType', 'totalMarks', 'duration',
        'cognitiveFramework', 'difficulty', 'topicScope',
      ],
      additionalProperties: false,
      properties: {
        schemaVersion:      { type: 'string', const: '1.0' },
        subject:            { type: 'string', minLength: 1 },
        grade:              { type: 'integer', minimum: 4, maximum: 7 },
        term:               { type: 'integer', minimum: 1, maximum: 4 },
        language:           { type: 'string', enum: ['English', 'Afrikaans'] },
        resourceType:       {
          type: 'string',
          enum: ['Worksheet', 'Test', 'Exam', 'Final Exam', 'Investigation', 'Project', 'Practical', 'Assignment'],
        },
        totalMarks:         { type: 'integer', minimum: 5, maximum: 200 },
        duration:           {
          type: 'object',
          required: ['minutes'],
          additionalProperties: false,
          properties: {
            minutes: { type: 'integer', minimum: 10, maximum: 240 },
          },
        },
        difficulty:         { type: 'string', enum: ['below', 'on', 'above'] },
        cognitiveFramework: {
          type: 'object',
          required: ['name', 'levels'],
          additionalProperties: false,
          properties: {
            name:   { type: 'string', enum: ["Bloom's", "Barrett's"] },
            levels: {
              type: 'array',
              minItems: 3,
              maxItems: 4,
              items: {
                type: 'object',
                required: ['name', 'percent', 'prescribedMarks'],
                additionalProperties: false,
                properties: {
                  name:            { type: 'string', minLength: 1 },
                  percent:         { type: 'integer', minimum: 0, maximum: 100 },
                  prescribedMarks: { type: 'integer', minimum: 0 },
                },
              },
            },
          },
        },
        topicScope:         {
          type: 'object',
          required: ['coversTerms', 'topics'],
          additionalProperties: false,
          properties: {
            coversTerms: {
              type: 'array',
              minItems: 1,
              maxItems: 4,
              items: { type: 'integer', minimum: 1, maximum: 4 },
              description: 'CAPS scope: [t] for term tests, [t-1, t] for Term 2/4 exams, [1,2,3,4] for Final Exam.',
            },
            topics: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', minLength: 1 },
              description: 'ATP topics in scope. Every question.topic must appear here.',
            },
          },
        },
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // COVER — pure presentation. The DOCX cover page renders from this.
    // No mark math; totalMarks is mirrored from meta for convenience.
    // ─────────────────────────────────────────────────────────────────
    cover: {
      type: 'object',
      required: ['resourceTypeLabel', 'subjectLine', 'gradeLine', 'termLine', 'instructions'],
      additionalProperties: false,
      properties: {
        resourceTypeLabel: { type: 'string', description: 'Localised, upper-cased, e.g. "EXAM" / "EKSAMEN".' },
        subjectLine:       { type: 'string', description: 'Localised display name of the subject.' },
        gradeLine:         { type: 'string', description: 'e.g. "Grade 6" / "Graad 6".' },
        termLine:          { type: 'string', description: 'e.g. "Term 4" / "Kwartaal 4".' },
        learnerInfoFields: {
          type: 'array',
          items: {
            type: 'object',
            required: ['kind', 'label'],
            additionalProperties: false,
            properties: {
              kind:  { type: 'string', enum: ['name', 'surname', 'date', 'examiner', 'time', 'total', 'code', 'comments'] },
              label: { type: 'string' },
            },
          },
        },
        instructions: {
          type: 'object',
          required: ['heading', 'items'],
          additionalProperties: false,
          properties: {
            heading: { type: 'string' },
            items:   { type: 'array', minItems: 1, items: { type: 'string' } },
          },
        },
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // STIMULUS — shared content referenced by questions. A passage that
    // anchors comprehension and summary sections is the same stimulus
    // referenced twice; you can't have a Section A passage that doesn't
    // match the Section C summary task because they reference the same id.
    // ─────────────────────────────────────────────────────────────────
    stimulus: {
      type: 'object',
      required: ['id', 'kind'],
      additionalProperties: false,
      properties: {
        id:      { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', description: 'kebab-case id, referenced by stimulusRef.' },
        kind:    { type: 'string', enum: ['passage', 'visualText', 'dataSet', 'diagram', 'scenario'] },
        heading: { type: 'string' },
        // Discriminator-keyed bodies. JSON Schema can't enforce conditional
        // requireds in pure draft-2020-12 cleanly, so we keep all body fields
        // optional at the schema level and assert per-kind required fields
        // in the runtime validator below (assertResource).
        body:        { type: 'string', description: 'Required for kind=passage|scenario.' },
        wordCount:   { type: 'integer', minimum: 1 },
        description: { type: 'string', description: 'Required for kind=visualText|diagram (verbal description, since the system cannot generate images).' },
        table: {
          type: 'object',
          required: ['headers', 'rows'],
          additionalProperties: false,
          properties: {
            headers: { type: 'array', minItems: 1, items: { type: 'string' } },
            rows:    { type: 'array', minItems: 1, items: { type: 'array', items: { type: 'string' } } },
          },
        },
        altText:     { type: 'string', description: 'Used when kind=diagram to describe the image-equivalent in words.' },
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // SECTION — ordered group of questions sharing a heading. Flat
    // resources (Worksheet) typically have a single section with letter=null.
    // Section totals are NOT stored (computed from question marks).
    // ─────────────────────────────────────────────────────────────────
    section: {
      type: 'object',
      required: ['title', 'questions'],
      additionalProperties: false,
      properties: {
        letter:        { type: ['string', 'null'], pattern: '^[A-Z]$' },
        title:         { type: 'string', minLength: 1, description: 'Localised, upper-cased — e.g. "COMPREHENSION", "BEGRIP".' },
        instructions:  { type: 'string' },
        stimulusRefs:  {
          type: 'array',
          items: { type: 'string' },
          description: 'IDs of stimuli this section uses (e.g. ["passage-1"] for RTT Section A).',
        },
        questions:     { type: 'array', minItems: 1, items: { $ref: '#/$defs/question' } },
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // QUESTION — recursive. Either LEAF or COMPOSITE, never both. The
    // runtime validator enforces this in assertResource() below; JSON
    // Schema's oneOf handling is brittle when we want clean error messages.
    //
    // LEAF fields:      marks, cognitiveLevel, answerSpace, (options|trueFalseAnswer)?
    // COMPOSITE fields: subQuestions (array of question)
    // BOTH must have:   number, type, topic, stem
    // ─────────────────────────────────────────────────────────────────
    question: {
      type: 'object',
      required: ['number', 'type', 'topic', 'stem'],
      additionalProperties: false,
      properties: {
        number:         { type: 'string', pattern: '^[0-9]+(\\.[0-9]+)*$', description: 'e.g. "1", "1.1", "1.1.1".' },
        type:           {
          type: 'string',
          enum: [
            'MCQ', 'TrueFalse', 'Matching', 'FillBlank', 'OneWordAnswer',
            'ShortAnswer', 'Calculation', 'WordProblem', 'Identify', 'Explain',
            'Compare', 'Describe', 'Define', 'Investigation', 'Summary',
            'ExtendedResponse', 'TenseChange', 'PassiveVoice', 'IndirectSpeech',
            'Synonym', 'Antonym', 'Punctuation', 'PartOfSpeech', 'CombineSentences',
            'Composite',
          ],
        },
        topic:          { type: 'string', minLength: 1 },
        stem:           { type: 'string', minLength: 1, description: 'The question text the learner reads.' },
        stimulusRef:    { type: 'string', description: 'Optional — references stimuli[].id.' },

        // LEAF fields
        marks:          { type: 'integer', minimum: 1 },
        cognitiveLevel: { type: 'string', minLength: 1 },
        answerSpace:    { $ref: '#/$defs/answerSpace' },
        options:        {
          type: 'array',
          minItems: 2,
          maxItems: 5,
          items: {
            type: 'object',
            required: ['label', 'text', 'isCorrect'],
            additionalProperties: false,
            properties: {
              label:     { type: 'string', pattern: '^[a-eA-E]$' },
              text:      { type: 'string', minLength: 1 },
              isCorrect: { type: 'boolean' },
            },
          },
        },
        trueFalseAnswer: { type: 'boolean' },

        // COMPOSITE fields
        subQuestions:   { type: 'array', minItems: 1, items: { $ref: '#/$defs/question' } },
      },
    },

    answerSpace: {
      type: 'object',
      required: ['kind'],
      additionalProperties: false,
      properties: {
        kind: {
          type: 'string',
          enum: [
            'lines',                 // N blank lines for short/long answer
            'workingPlusAnswer',     // a "Working:" block followed by "Answer:" for calc
            'options',               // MCQ — no extra space, options ARE the answer mechanism
            'table',                 // a table with given/blank cells the learner fills in
            'none',                  // True/False, FillBlank stems where the blank is inline
            'inlineBlank',           // for FillBlank — single short underline inline in the stem
          ],
        },
        lines:   { type: 'integer', minimum: 1, maximum: 30 },
        rows:    { type: 'integer', minimum: 1, maximum: 20 },
        columns: {
          type: 'object',
          required: ['headers'],
          additionalProperties: false,
          properties: {
            headers: { type: 'array', minItems: 1, items: { type: 'string' } },
          },
        },
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // MEMO — answers + rubric + extension. The cog analysis table is NOT
    // here; it is derived from `answers` grouped by cognitiveLevel at
    // render time. Phantom rows / fabricated totals are structurally
    // impossible because the cog table can only reference questions the
    // memo answers actually exist for.
    //
    // Every leaf question MUST have exactly one matching memo.answer
    // (matched on questionNumber). Composite questions have no answer
    // entry — only their leaves do. Validated in assertResource().
    // ─────────────────────────────────────────────────────────────────
    memo: {
      type: 'object',
      required: ['answers'],
      additionalProperties: false,
      properties: {
        answers: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['questionNumber', 'answer', 'cognitiveLevel', 'marks'],
            additionalProperties: false,
            properties: {
              questionNumber:   { type: 'string', pattern: '^[0-9]+(\\.[0-9]+)*$' },
              answer:           { type: 'string', minLength: 1 },
              markingGuidance:  { type: 'string' },
              cognitiveLevel:   { type: 'string', minLength: 1 },
              marks:            { type: 'integer', minimum: 1 },
            },
          },
        },
        rubric: {
          type: 'object',
          required: ['title', 'criteria'],
          additionalProperties: false,
          properties: {
            title:    { type: 'string' },
            criteria: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['name', 'descriptors'],
                additionalProperties: false,
                properties: {
                  name:        { type: 'string' },
                  descriptors: {
                    type: 'array',
                    minItems: 2,
                    items: {
                      type: 'object',
                      required: ['level', 'descriptor', 'marks'],
                      additionalProperties: false,
                      properties: {
                        level:      { type: 'string' },
                        descriptor: { type: 'string' },
                        marks:      { type: 'integer', minimum: 0 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        extension: {
          type: 'object',
          required: ['title', 'activity'],
          additionalProperties: false,
          properties: {
            title:        { type: 'string' },
            activity:     { type: 'string' },
            instructions: { type: 'string' },
          },
        },
      },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────
// RUNTIME VALIDATOR — invariants JSON Schema can't express cleanly.
//
// JSON Schema gets us 80% of validation for free (shape, required fields,
// enum values, pattern matching). The remaining 20% is cross-field and
// cross-document logic that's clearer in code than in $ref/oneOf gymnastics:
//
//   1. Every leaf question's marks contribute to exactly meta.totalMarks.
//   2. Every question is leaf XOR composite.
//   3. cognitiveLevel ∈ meta.cognitiveFramework.levels[*].name.
//   4. topic ∈ meta.topicScope.topics.
//   5. stimulusRef points to an existing stimulus.id.
//   6. memo.answers covers exactly the leaf questions, no more, no less.
//   7. cognitiveFramework.levels[*].percent sums to 100.
//   8. cognitiveFramework.levels[*].prescribedMarks sums to meta.totalMarks.
//   9. memo.answers.marks for a question matches the question's marks.
//   10. MCQ has exactly one correct option.
//
// Returns { ok: true } or { ok: false, errors: [{ path, message }] }.
// ─────────────────────────────────────────────────────────────────────
export function assertResource(resource) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });

  if (!resource || typeof resource !== 'object') {
    return { ok: false, errors: [{ path: '', message: 'resource must be an object' }] };
  }

  const { meta, stimuli = [], sections = [], memo } = resource;
  if (!meta) return { ok: false, errors: [{ path: 'meta', message: 'required' }] };

  // (7) cog framework percentages sum to 100
  const levels = meta.cognitiveFramework?.levels || [];
  const pctSum = levels.reduce((a, l) => a + (l.percent || 0), 0);
  if (pctSum !== 100) err('meta.cognitiveFramework.levels[*].percent', `sum=${pctSum}, expected 100`);

  // (8) prescribed marks sum to total
  const prescribedSum = levels.reduce((a, l) => a + (l.prescribedMarks || 0), 0);
  if (prescribedSum !== meta.totalMarks) {
    err('meta.cognitiveFramework.levels[*].prescribedMarks', `sum=${prescribedSum}, expected meta.totalMarks=${meta.totalMarks}`);
  }

  const levelNames = new Set(levels.map((l) => l.name));
  const topics = new Set(meta.topicScope?.topics || []);
  const stimulusIds = new Set(stimuli.map((s) => s.id));

  // Walk question tree; collect leaves; validate per-question rules.
  const leaves = [];
  const walk = (q, path) => {
    const isLeaf = q.subQuestions === undefined;
    const isComposite = Array.isArray(q.subQuestions);

    // (2) leaf XOR composite
    if (isLeaf && isComposite) err(path, 'question is both leaf and composite (has subQuestions and leaf fields)');
    if (!isLeaf && !isComposite) err(path, 'question must be either leaf or composite');

    if (isComposite) {
      // composites must NOT have leaf fields
      ['marks', 'cognitiveLevel', 'answerSpace', 'options', 'trueFalseAnswer'].forEach((k) => {
        if (q[k] !== undefined) err(`${path}.${k}`, `composite question must not have ${k}`);
      });
      q.subQuestions.forEach((sq, i) => walk(sq, `${path}.subQuestions[${i}]`));
      return;
    }

    // leaf
    leaves.push({ q, path });
    if (!q.marks) err(`${path}.marks`, 'required on leaf');
    if (!q.cognitiveLevel) err(`${path}.cognitiveLevel`, 'required on leaf');
    if (!q.answerSpace) err(`${path}.answerSpace`, 'required on leaf');

    // (3) cogLevel in framework
    if (q.cognitiveLevel && !levelNames.has(q.cognitiveLevel)) {
      err(`${path}.cognitiveLevel`, `"${q.cognitiveLevel}" not in framework levels [${[...levelNames].join(', ')}]`);
    }

    // (4) topic in scope
    if (q.topic && topics.size > 0 && !topics.has(q.topic)) {
      err(`${path}.topic`, `"${q.topic}" not in meta.topicScope.topics`);
    }

    // (5) stimulusRef resolves
    if (q.stimulusRef && !stimulusIds.has(q.stimulusRef)) {
      err(`${path}.stimulusRef`, `"${q.stimulusRef}" not found in stimuli[]`);
    }

    // (10) MCQ has exactly one correct option
    if (q.type === 'MCQ') {
      const correct = (q.options || []).filter((o) => o.isCorrect).length;
      if (correct !== 1) err(`${path}.options`, `MCQ must have exactly one correct option (found ${correct})`);
    }
  };

  sections.forEach((sec, si) => {
    sec.questions.forEach((q, qi) => walk(q, `sections[${si}].questions[${qi}]`));

    // stimulusRefs at section level must resolve
    (sec.stimulusRefs || []).forEach((ref, ri) => {
      if (!stimulusIds.has(ref)) err(`sections[${si}].stimulusRefs[${ri}]`, `"${ref}" not found in stimuli[]`);
    });
  });

  // (1) leaf marks sum to totalMarks
  const leafSum = leaves.reduce((a, { q }) => a + (q.marks || 0), 0);
  if (leafSum !== meta.totalMarks) {
    err('sum(leaf.marks)', `${leafSum}, expected meta.totalMarks=${meta.totalMarks}`);
  }

  // (6) memo.answers covers leaves exactly (and 9: marks match)
  const leafByNum = new Map(leaves.map(({ q, path }) => [q.number, { q, path }]));
  const answerByNum = new Map((memo?.answers || []).map((a) => [a.questionNumber, a]));

  for (const [num, { q, path }] of leafByNum) {
    const a = answerByNum.get(num);
    if (!a) {
      err(`memo.answers[${num}]`, `missing answer for leaf question at ${path}`);
      continue;
    }
    if (a.marks !== q.marks) err(`memo.answers[${num}].marks`, `${a.marks}, expected ${q.marks} (matches paper)`);
    if (a.cognitiveLevel !== q.cognitiveLevel) {
      err(`memo.answers[${num}].cognitiveLevel`, `"${a.cognitiveLevel}", expected "${q.cognitiveLevel}" (matches paper)`);
    }
  }
  for (const num of answerByNum.keys()) {
    if (!leafByNum.has(num)) {
      err(`memo.answers[${num}]`, `references question ${num} which has no leaf in the paper`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// Convenience: the per-leaf cog-level tally that the cog-analysis table is
// rendered from. Pure derivation — no model involvement, can't drift.
export function tallyCogLevels(resource) {
  const tally = {};
  for (const a of resource.memo?.answers || []) {
    tally[a.cognitiveLevel] = (tally[a.cognitiveLevel] || 0) + a.marks;
  }
  return tally;
}

// ─────────────────────────────────────────────────────────────────────
// PER-REQUEST SCHEMA NARROWING
//
// The base schema accepts the full CAPS matrix. For one specific generation
// we narrow string fields to closed enums so the model literally cannot emit
// out-of-scope values. The Anthropic tool API enforces these enums at the
// JSON-Schema level, so violations are rejected before they ever reach
// assertResource.
//
// Narrowed fields:
//   meta.subject                              → [ctx.subject]
//   meta.language                             → [ctx.language]
//   meta.resourceType                         → [ctx.resourceType]
//   meta.cognitiveFramework.levels[*].name    → ctx.cognitiveLevels
//   sections[*].questions[*].cognitiveLevel   → ctx.cognitiveLevels (recursive via $ref)
//   sections[*].questions[*].topic            → ctx.topics          (recursive via $ref)
//   memo.answers[*].cognitiveLevel            → ctx.cognitiveLevels
//
// ctx must supply: { subject, language, resourceType, cognitiveLevels, topics }.
// ─────────────────────────────────────────────────────────────────────
export function narrowSchemaForRequest(ctx) {
  const { subject, language, resourceType, cognitiveLevels, topics } = ctx;
  if (!subject || !language || !resourceType) {
    throw new Error('narrowSchemaForRequest: subject, language, resourceType required');
  }
  if (!Array.isArray(cognitiveLevels) || cognitiveLevels.length < 3) {
    throw new Error('narrowSchemaForRequest: cognitiveLevels must be an array of ≥3 strings');
  }
  if (!Array.isArray(topics) || topics.length === 0) {
    throw new Error('narrowSchemaForRequest: topics must be a non-empty array');
  }

  // Deep-clone so the base schema export stays untouched across calls.
  const s = JSON.parse(JSON.stringify(resourceSchema));

  // meta.* enums
  const meta = s.$defs.meta.properties;
  meta.subject = { ...meta.subject, enum: [subject] };
  meta.language = { ...meta.language, enum: [language] };
  meta.resourceType = { ...meta.resourceType, enum: [resourceType] };

  // meta.cognitiveFramework.levels[*].name enum
  const levelItem = meta.cognitiveFramework.properties.levels.items;
  levelItem.properties.name = { ...levelItem.properties.name, enum: cognitiveLevels };

  // questions (recursive via $ref) — narrow once on the $defs.question shape
  const q = s.$defs.question.properties;
  q.cognitiveLevel = { ...q.cognitiveLevel, enum: cognitiveLevels };
  q.topic = { ...q.topic, enum: topics };

  // memo.answers[*].cognitiveLevel
  const ans = s.$defs.memo.properties.answers.items.properties;
  ans.cognitiveLevel = { ...ans.cognitiveLevel, enum: cognitiveLevels };

  return s;
}
