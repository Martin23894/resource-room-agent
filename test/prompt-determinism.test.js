// Anthropic's prompt cache is a prefix-byte match: the cached portion of
// every call must be byte-identical to the previous call's prefix or the
// cache silently misses (cache_read_input_tokens=0). Silent misses are
// expensive — we pay full input cost AND a cache-write surcharge.
//
// What we cache as the prefix:
//   1. system prompt (wrapped in a single text block with cache_control)
//   2. tool definition (input_schema for build_resource)
//
// What we DO NOT cache:
//   3. user message (sits after the breakpoint, varies on retry)
//
// This file proves (1) and (2) are byte-stable for identical request
// inputs across separate buildContext invocations. If anything
// time-dependent, random, or order-unstable creeps into either path,
// these tests fire.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { __internals } from '../api/generate.js';
import { narrowSchemaForRequest } from '../schema/resource.schema.js';

const { buildContext, buildSystemPrompt, buildUserPrompt } = __internals;

function buildPair(req) {
  const ctxA = buildContext(req);
  const ctxB = buildContext(req);
  return {
    systemA: buildSystemPrompt(ctxA),
    systemB: buildSystemPrompt(ctxB),
    userA: buildUserPrompt(ctxA),
    userB: buildUserPrompt(ctxB),
    schemaA: narrowSchemaForRequest({
      subject: ctxA.subject,
      language: ctxA.language,
      resourceType: ctxA.resourceType,
      cognitiveLevels: ctxA.cognitiveLevelNames,
      topics: ctxA.topics,
    }),
    schemaB: narrowSchemaForRequest({
      subject: ctxB.subject,
      language: ctxB.language,
      resourceType: ctxB.resourceType,
      cognitiveLevels: ctxB.cognitiveLevelNames,
      topics: ctxB.topics,
    }),
  };
}

const REQUESTS = [
  {
    label: 'Maths Gr 5 T2 Test 40 marks (English)',
    req: { subject: 'Mathematics', grade: 5, term: 2, language: 'English', resourceType: 'Test', totalMarks: 40 },
  },
  {
    label: 'NST Gr 6 T1 Worksheet 25 marks (English)',
    req: { subject: 'Natural Sciences and Technology', grade: 6, term: 1, language: 'English', resourceType: 'Worksheet', totalMarks: 25 },
  },
  {
    label: 'Eng HL Gr 4 T2 Exam 50 marks',
    req: { subject: 'English Home Language', grade: 4, term: 2, language: 'English', resourceType: 'Exam', totalMarks: 50 },
  },
  {
    label: 'Afr HL Gr 4 T3 Test 40 marks',
    req: { subject: 'Afrikaans Home Language', grade: 4, term: 3, language: 'Afrikaans', resourceType: 'Test', totalMarks: 40 },
  },
  {
    label: 'Maths Gr 7 Final Exam 100 marks',
    req: { subject: 'Mathematics', grade: 7, term: 4, language: 'English', resourceType: 'Final Exam', totalMarks: 100 },
  },
];

describe('prompt determinism — system prompt is byte-stable', () => {
  for (const { label, req } of REQUESTS) {
    test(label, () => {
      const { systemA, systemB } = buildPair(req);
      assert.equal(systemA, systemB,
        'buildSystemPrompt must produce byte-identical output for identical inputs ' +
        '— any drift breaks Anthropic prompt caching (silent cache miss → full input cost on every call)');
      assert.ok(systemA.length > 1000, 'sanity check: system prompt should be substantial');
    });
  }
});

describe('prompt determinism — user prompt is byte-stable', () => {
  for (const { label, req } of REQUESTS) {
    test(label, () => {
      const { userA, userB } = buildPair(req);
      assert.equal(userA, userB);
    });
  }
});

describe('prompt determinism — narrowed tool schema is byte-stable', () => {
  for (const { label, req } of REQUESTS) {
    test(label, () => {
      const { schemaA, schemaB } = buildPair(req);
      // The schema is sent as JSON in the request body, so JSON byte-equality
      // is what actually matters for the cache prefix match.
      assert.equal(JSON.stringify(schemaA), JSON.stringify(schemaB));
    });
  }
});

describe('prompt determinism — full prefix (system + schema)', () => {
  for (const { label, req } of REQUESTS) {
    test(`${label} — combined prefix`, () => {
      const { systemA, systemB, schemaA, schemaB } = buildPair(req);
      const prefixA = systemA + '\n' + JSON.stringify(schemaA);
      const prefixB = systemB + '\n' + JSON.stringify(schemaB);
      assert.equal(prefixA, prefixB,
        'The cached portion of the request (system prompt + tool schema) ' +
        'must be byte-stable across calls with identical inputs.');
    });
  }
});
