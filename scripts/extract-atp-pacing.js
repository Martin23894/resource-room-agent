#!/usr/bin/env node
// scripts/extract-atp-pacing.js
//
// Lifts every DBE Annual Teaching Plan PDF at the repo root into structured
// data at data/atp-pacing.json, conforming to docs/atp-pacing-schema.md.
//
// Pipeline per PDF:
//   1. Identify (subject(s), grade, year) from the filename.
//   2. Dump text with `pdftotext -layout` (one page per form-feed).
//   3. Send the dump to Claude with the schema + filename context.
//   4. Parse the model's JSON response.
//   5. Merge each returned PacingDoc into data/atp-pacing.json keyed by
//      subjects[subject][grade][year].
//
// CLI:
//   node scripts/extract-atp-pacing.js [--only "<exact filename>"]
//                                      [--limit <n>]
//                                      [--force]
//                                      [--dry-run]
//                                      [--source-dir <path>]
//                                      [--out <path>]
//                                      [--model <id>]
//
// Defaults: source-dir=data/atp-source, out=data/atp-pacing.json,
//           model=claude-sonnet-4-6.
//
// Designed for both the GitHub Actions workflow (.github/workflows/
// extract-atp-pacing.yml) and ad-hoc local runs.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ---------- CLI ---------------------------------------------------------

function parseArgs(argv) {
  const args = { only: null, limit: null, force: false, dryRun: false,
                 sourceDir: 'data/atp-source', out: 'data/atp-pacing.json',
                 model: 'claude-sonnet-4-6' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only')           args.only = argv[++i];
    else if (a === '--limit')     args.limit = Number(argv[++i]);
    else if (a === '--force')     args.force = true;
    else if (a === '--dry-run')   args.dryRun = true;
    else if (a === '--source-dir')args.sourceDir = argv[++i];
    else if (a === '--out')       args.out = argv[++i];
    else if (a === '--model')     args.model = argv[++i];
    else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    else { console.error(`Unknown argument: ${a}`); process.exit(2); }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/extract-atp-pacing.js [options]

  --only <filename>   Process a single PDF by exact filename.
  --limit <n>         Process at most n PDFs this run.
  --force             Overwrite existing entries in atp-pacing.json.
  --dry-run           Skip the Claude call; print parsed filename metadata only.
  --source-dir <dir>  Where to look for PDFs (default: data/atp-source).
  --out <path>        Output JSON path (default: data/atp-pacing.json).
  --model <id>        Claude model id (default: claude-sonnet-4-6).
`);
}

// ---------- Filename → (subject(s), grade, year) ----------------------

const SUBJECT_ABBR = [
  // Order matters: most specific first.
  { match: /\bMaths\b|Mathematics/i,                   subjects: ['Mathematics'] },
  { match: /NS\s*&\s*Tech|Natural Sciences and Technology/i, subjects: ['Natural Sciences and Technology'] },
  { match: /\bNS\b|Natural Sciences/i,                 subjects: ['Natural Sciences'] },
  { match: /Techn(ology)?\b/i,                         subjects: ['Technology'] },
  { match: /English\s*HL|Eng\s*HL|English Home Language/i,  subjects: ['English Home Language'] },
  { match: /English\s*FAL|English First Additional/i,  subjects: ['English First Additional Language'] },
  { match: /Afrikaans\s*HL|Afrikaans Home Language/i,  subjects: ['Afrikaans Home Language'] },
  { match: /Afrikaans\s*FAL|Afrikaans First Additional/i, subjects: ['Afrikaans First Additional Language'] },
  { match: /Soc\s*Sci|Social Sciences/i,               subjects: ['Social Sciences — History', 'Social Sciences — Geography'] },
  { match: /Life\s*Ski|Life Skills/i,                  subjects: ['Life Skills — Personal and Social Wellbeing', 'Life Skills — Physical Education', 'Life Skills — Creative Arts'] },
  { match: /\bLO\b|Life Orientation/i,                 subjects: ['Life Orientation'] },
  { match: /\bEMS\b|Economic and Management Sciences/i, subjects: ['Economic and Management Sciences'] },
];

function parseFilename(name) {
  // Year:
  //   2026 ATPs → "2026_ATP_<subject>_Grade <n>.pdf"
  //   2023-24 ATPs → "1.xxx ATP 2023-24 Gr <n> <subject> final.pdf"
  let year = null;
  if (/^2026_/.test(name))         year = '2026';
  else if (/2023-24/.test(name))   year = '2023-24';

  // Normalise underscores → spaces so word-boundary regexes work uniformly
  // (e.g. "2026_ATP_NS_Grade 7.pdf" so `\bNS\b` matches).
  const normalised = name.replace(/_/g, ' ');

  // Grade:
  let grade = null;
  const gMatch = normalised.match(/Grade[ _]?(\d)|\bGr[ _]?(\d)\b/i);
  if (gMatch) grade = Number(gMatch[1] || gMatch[2]);

  // Subject(s):
  let subjects = [];
  for (const entry of SUBJECT_ABBR) {
    if (entry.match.test(normalised)) { subjects = entry.subjects; break; }
  }

  return { year, grade, subjects, filename: name };
}

// ---------- pdftotext --------------------------------------------------

function pdftotextLayout(pdfPath) {
  const tmp = join(tmpdir(), `atp-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  const r = spawnSync('pdftotext', ['-layout', pdfPath, tmp], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`pdftotext failed for ${pdfPath}: ${r.stderr || r.stdout}`);
  }
  const text = readFileSync(tmp, 'utf8');
  // Page boundaries are form-feeds (\f). Annotate so the model can attach
  // source.page to each Unit.
  const pages = text.split('\f');
  const annotated = pages
    .map((p, i) => `=== PAGE ${i + 1} ===\n${p}`)
    .join('\n');
  return { annotated, totalPages: pages.length };
}

// ---------- Claude API -------------------------------------------------

async function callClaude({ apiKey, model, system, user }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      // A full Maths ATP across 4 terms with subtopic trees can run to
      // 30-50k output tokens. Languages PDFs with parallel skill units
      // are larger still. Generous budget; we pay for what we use.
      max_tokens: 64000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API ${res.status}: ${body.slice(0, 800)}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  if (data.stop_reason && data.stop_reason !== 'end_turn') {
    console.warn(`  ⚠ unusual stop_reason from Claude: ${data.stop_reason}`);
  }
  return { text, raw: data };
}

const SYSTEM_PROMPT = `You extract South African DBE Annual Teaching Plan (ATP) PDFs into structured JSON.

Your output is the SINGLE SOURCE OF TRUTH for a downstream worksheet/lesson/planner system, so capture EVERY pedagogical detail in the PDF text. Do not summarise, do not abbreviate, do not drop bullets, do not paraphrase.

You will be given:
- Filename context (subject(s), grade, year — already parsed for you, trust it)
- The PDF's full text dump with PAGE markers

You must return a single JSON object with this exact shape (no commentary, no code fences, just the JSON):

{
  "pacingDocs": [
    {
      "subject": "<one of the canonical subject names provided in the user message>",
      "grade": <integer 4-7>,
      "year": "<the year provided>",
      "phase": "intermediate" | "senior",
      "language": "English" | "Afrikaans" | null,
      "source": {
        "pdf": "<filename>",
        "totalPages": <integer>,
        "publishedBy": "DBE",
        "documentTitle": "<verbatim title line from PDF>"
      },
      "capsStrands": [<verbatim CAPS strand names found in the PDF>],
      "terms": {
        "1": { /* TermPlan */ },
        "2": { /* TermPlan */ },
        "3": { /* TermPlan */ },
        "4": { /* TermPlan */ }
      },
      "yearOverview": null,
      "notes": []
    }
  ]
}

A TermPlan is:
{
  "term": <1-4>,
  "totalWeeks": <integer or null>,
  "totalHours": <integer or null>,
  "termNotes": [<string>],
  "units": [<Unit>],
  "formalAssessment": [<FormalAssessment>]
}

A Unit (one row/block on the ATP grid) is:
{
  "id": "<subject-shorthand>-<grade>-<year>-t<term>-u<ordinal>",
  "ordinal": <1-based teaching order within the term>,
  "weeks": [<all week numbers this unit spans, integers>],
  "hours": <integer or null>,
  "durationLabel": "<verbatim duration label like '2½ weeks'>" | null,
  "topic": "<verbatim topic heading>",
  "capsStrand": "<which CAPS strand this belongs to, or null>",
  "subStrand": <string or null>,
  "isRevision": <boolean — true for revision/consolidation blocks>,
  "isAssessmentSlot": <boolean — true for cells whose only content is "FORMAL ASSESSMENT TASK">,
  "subtopics": [<Subtopic>],
  "prerequisites": [<verbatim string from "Prerequisite skill / Pre-knowledge">],
  "resources": [<verbatim "Resources to enhance learning" lines>],
  "informalAssessment": [<verbatim "Informal Assessment" lines>],
  "notes": [<verbatim "Note: ..." callouts attached to this unit>],
  "source": { "pdf": "<filename>", "page": <integer page number where this unit appears> }
}

A Subtopic is recursive:
{
  "heading": "<verbatim sub-heading>",
  "concepts": [<verbatim bullets — preserve leading dashes/dots>],
  "children": [<Subtopic>]
}

A FormalAssessment is:
{
  "label": "<verbatim from PDF e.g. 'Formal Assessment Task 1: Oral'>",
  "type": "Assignment" | "Investigation" | "Project" | "Test" | "Examination" | "Practical Task" | "Oral" | "Presentation",
  "term": <1-4>,
  "weeks": [<integer week numbers when administered>],
  "minMarks": <integer or null>,
  "maxMarks": <integer or null>,
  "totalMarks": <integer or null>,
  "weightingPercent": <number or null>,
  "sections": [
    {
      "label": "<section name e.g. 'Read Aloud'>",
      "marks": <integer>,
      "capsStrand": <string or null>,
      "notes": <string or null>
    }
  ],
  "topicsCovered": [<verbatim>],
  "conditions": "<e.g. 'Assignment to be completed in class within three hours'>" | null,
  "rubricNotes": [<verbatim rubric/marking-guide hints>],
  "source": { "pdf": "<filename>", "page": <integer> }
}

CRITICAL RULES:
1. Capture EVERY bullet, sub-bullet, and "Note:" callout VERBATIM. Preserve leading markers (•, ‒, –, —, ✓, *, numerals).
2. For week-grid PDFs (Maths, Languages), each column block becomes one or more Units. Every "WEEK N" header maps to weeks[].
3. For Languages PDFs (English/Afrikaans HL/FAL), each WEEK row becomes FOUR PARALLEL Units, one per skill column: "Listening and Speaking", "Reading and Viewing", "Writing and Presenting", "Language Structures and Conventions". They share the same weeks[] but each has its own subtopics tree.
4. For NS&T PDFs (duration-row layout), each row becomes one Unit. Compute weeks[] from the cumulative duration label within the term.
5. For Soc Sci PDFs covering both History and Geography, return TWO PacingDocs (one per subject) — split content by the History/Geography section headers in the PDF.
6. For Life Skills PDFs covering Personal/Social Wellbeing + Physical Education + Creative Arts, return THREE PacingDocs.
7. Per-section mark splits MUST be captured in formalAssessment.sections[]. If only a range is given (e.g. "25-50 marks"), set minMarks/maxMarks and leave sections empty.
8. phase = "intermediate" for grades 4-6, "senior" for grade 7.
9. Every Unit and FormalAssessment MUST have source.page pointing at the PAGE marker where it appears.
10. Output ONLY the JSON object. No explanation, no code fences, no markdown.`;

function buildUserPrompt({ filename, year, grade, subjects, totalPages, text }) {
  return `FILENAME: ${filename}
YEAR: ${year}
GRADE: ${grade}
EXPECTED SUBJECT(S): ${subjects.map((s) => `"${s}"`).join(', ')}
TOTAL PAGES: ${totalPages}

If multiple subjects are listed above, return one PacingDoc per subject (split the content by the subject section headers in the PDF).

PDF TEXT DUMP (page markers preserved):

${text}`;
}

function extractJson(modelText) {
  // Strip code fences if the model added any despite instructions.
  let s = modelText.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\n?/, '').replace(/```\s*$/, '');
  }
  // Find the first { and last } and slice (defensive against stray prose).
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1) {
    throw new Error('No JSON object found in model response.');
  }
  return JSON.parse(s.slice(first, last + 1));
}

// ---------- Validation -------------------------------------------------

const CANONICAL_SUBJECTS = new Set([
  'Mathematics',
  'Natural Sciences and Technology',
  'Natural Sciences',
  'Technology',
  'Social Sciences — History',
  'Social Sciences — Geography',
  'English Home Language',
  'English First Additional Language',
  'Afrikaans Home Language',
  'Afrikaans First Additional Language',
  'Life Skills — Personal and Social Wellbeing',
  'Life Skills — Physical Education',
  'Life Skills — Creative Arts',
  'Life Orientation',
  'Economic and Management Sciences',
]);

function validatePacingDoc(doc, filename) {
  const errs = [];
  if (!CANONICAL_SUBJECTS.has(doc.subject))
    errs.push(`subject not in canonical set: ${doc.subject}`);
  if (![4, 5, 6, 7].includes(doc.grade))
    errs.push(`grade out of range: ${doc.grade}`);
  if (!['2026', '2023-24'].includes(doc.year))
    errs.push(`year not recognised: ${doc.year}`);
  if (!doc.terms || Object.keys(doc.terms).length === 0)
    errs.push(`no terms in PacingDoc`);
  for (const [tk, tp] of Object.entries(doc.terms || {})) {
    if (!['1', '2', '3', '4'].includes(tk))
      errs.push(`bad term key: ${tk}`);
    if (!Array.isArray(tp.units))
      errs.push(`term ${tk} units not an array`);
    if (!Array.isArray(tp.formalAssessment))
      errs.push(`term ${tk} formalAssessment not an array`);
  }
  if (errs.length) {
    console.warn(`  ⚠ validation warnings for ${filename} / ${doc.subject}:`);
    for (const e of errs) console.warn(`    - ${e}`);
  }
  return errs.length === 0;
}

// ---------- Merge into atp-pacing.json --------------------------------

function loadOrInit(outPath) {
  if (existsSync(outPath)) {
    return JSON.parse(readFileSync(outPath, 'utf8'));
  }
  return {
    $schemaVersion: '1.0.0',
    extractedAt: null,
    extractor: { model: null, promptVersion: 1 },
    subjects: {},
  };
}

function mergePacingDoc(corpus, doc, { force }) {
  corpus.subjects[doc.subject] ??= {};
  corpus.subjects[doc.subject][String(doc.grade)] ??= {};
  const slot = corpus.subjects[doc.subject][String(doc.grade)];
  if (slot[doc.year] && !force) {
    return { skipped: true, reason: 'exists; use --force to overwrite' };
  }
  slot[doc.year] = doc;
  return { skipped: false };
}

// Stable serialisation: alphabetical subjects, numeric grades, year asc, terms 1-4.
function stableSerialise(corpus) {
  const out = { ...corpus, subjects: {} };
  const subjectKeys = Object.keys(corpus.subjects).sort();
  for (const s of subjectKeys) {
    out.subjects[s] = {};
    const gradeKeys = Object.keys(corpus.subjects[s]).sort((a, b) => Number(a) - Number(b));
    for (const g of gradeKeys) {
      out.subjects[s][g] = {};
      const yearKeys = Object.keys(corpus.subjects[s][g]).sort();
      for (const y of yearKeys) {
        out.subjects[s][g][y] = corpus.subjects[s][g][y];
      }
    }
  }
  return JSON.stringify(out, null, 2) + '\n';
}

// ---------- Main -------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = resolve(REPO_ROOT, args.sourceDir);
  const outPath = resolve(REPO_ROOT, args.out);

  if (!existsSync(sourceDir)) {
    console.error(`Source directory not found: ${sourceDir}`);
    process.exit(1);
  }

  // Discover PDFs.
  let pdfs = readdirSync(sourceDir)
    .filter((n) => n.toLowerCase().endsWith('.pdf'))
    .sort();
  if (args.only) {
    pdfs = pdfs.filter((n) => n === args.only);
    if (pdfs.length === 0) {
      console.error(`--only "${args.only}" matched no files in ${sourceDir}`);
      process.exit(1);
    }
  }
  if (args.limit) pdfs = pdfs.slice(0, args.limit);

  console.log(`Found ${pdfs.length} PDF(s) in ${sourceDir}`);

  // API key only required for non-dry runs.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!args.dryRun && !apiKey) {
    console.error('ANTHROPIC_API_KEY not set. Use --dry-run to skip the API call.');
    process.exit(1);
  }

  // Ensure output dir exists.
  mkdirSync(dirname(outPath), { recursive: true });

  const corpus = loadOrInit(outPath);
  corpus.extractor = { model: args.model, promptVersion: 1 };

  const summary = { processed: 0, skipped: 0, errored: 0, docsAdded: 0 };

  for (const filename of pdfs) {
    const meta = parseFilename(filename);
    const tag = `[${filename}]`;
    if (!meta.year || !meta.grade || meta.subjects.length === 0) {
      console.warn(`${tag} could not parse year/grade/subject from filename — skipping`);
      summary.skipped++;
      continue;
    }
    console.log(`${tag} subject(s)=${meta.subjects.join(' + ')} grade=${meta.grade} year=${meta.year}`);

    if (args.dryRun) {
      summary.processed++;
      continue;
    }

    // Skip-existing check: skip only if every expected subject already has this year.
    if (!args.force) {
      const allExist = meta.subjects.every((s) =>
        corpus.subjects[s]?.[String(meta.grade)]?.[meta.year]);
      if (allExist) {
        console.log(`${tag} already extracted (all expected subjects present) — skipping. Use --force to overwrite.`);
        summary.skipped++;
        continue;
      }
    }

    let dump;
    try {
      dump = pdftotextLayout(join(sourceDir, filename));
    } catch (e) {
      console.error(`${tag} pdftotext failed: ${e.message}`);
      summary.errored++;
      continue;
    }

    const user = buildUserPrompt({
      filename,
      year: meta.year,
      grade: meta.grade,
      subjects: meta.subjects,
      totalPages: dump.totalPages,
      text: dump.annotated,
    });

    let parsed;
    let modelText = '';
    try {
      const r = await callClaude({ apiKey, model: args.model, system: SYSTEM_PROMPT, user });
      modelText = r.text;
      parsed = extractJson(modelText);
    } catch (e) {
      console.error(`${tag} extraction failed: ${e.message}`);
      if (modelText) {
        // First 500 + last 500 of the response so we can diagnose
        // truncation vs malformed JSON without dumping a 60k-char wall.
        const head = modelText.slice(0, 500);
        const tail = modelText.length > 1000 ? modelText.slice(-500) : '';
        console.error(`  model response (len=${modelText.length}):`);
        console.error(`  HEAD: ${head}`);
        if (tail) console.error(`  TAIL: ${tail}`);
      }
      summary.errored++;
      continue;
    }

    const docs = Array.isArray(parsed.pacingDocs) ? parsed.pacingDocs : [];
    if (docs.length === 0) {
      console.warn(`${tag} model returned no pacingDocs — skipping`);
      summary.errored++;
      continue;
    }

    let addedHere = 0;
    for (const doc of docs) {
      validatePacingDoc(doc, filename);
      const r = mergePacingDoc(corpus, doc, { force: args.force });
      if (r.skipped) {
        console.log(`${tag} ${doc.subject} Gr${doc.grade} ${doc.year}: ${r.reason}`);
      } else {
        console.log(`${tag} ${doc.subject} Gr${doc.grade} ${doc.year}: merged (${Object.keys(doc.terms || {}).length} terms)`);
        addedHere++;
      }
    }
    summary.processed++;
    summary.docsAdded += addedHere;
  }

  if (!args.dryRun) {
    corpus.extractedAt = new Date().toISOString();
    writeFileSync(outPath, stableSerialise(corpus));
    console.log(`\nWrote ${outPath}`);
  } else {
    console.log('\n--dry-run: no API calls, no file written.');
  }
  console.log(`Summary: processed=${summary.processed} skipped=${summary.skipped} errored=${summary.errored} docsAdded=${summary.docsAdded}`);

  // Per-PDF errors are expected on long batch runs (rate limits, occasional
  // malformed model responses, etc.). The workflow is designed to be
  // resumable: as long as we wrote the output file with whatever DID
  // succeed, the next run will pick up the rest. Only exit 1 when nothing
  // was processed at all — that signals a config-level failure
  // (no API key, no PDFs found) that the caller needs to fix.
  if (summary.processed === 0 && summary.docsAdded === 0 && summary.errored > 0) {
    console.error('No PDFs processed successfully. Aborting.');
    process.exit(1);
  }
}

// Exports for tests — pure helpers only.
export {
  parseFilename,
  extractJson,
  validatePacingDoc,
  mergePacingDoc,
  stableSerialise,
  loadOrInit,
  CANONICAL_SUBJECTS,
};

// Run as CLI when invoked directly (not when imported by tests).
const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
