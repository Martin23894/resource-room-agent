// Extract ATP pacing data from DBE PDFs into data/atp-pacing.json.
//
// Reads every PDF in data/atp-source/, calls Sonnet with the PDF as a
// document content block, and forces a structured tool call that returns
// the per-family pacing JSON. Output is merged into data/atp-pacing.json.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/extract-atp-pacing.js
//
// Flags:
//   --only "<filename>"   Process exactly one PDF (filename in data/atp-source/).
//   --limit N             Stop after N successful extractions.
//   --force               Overwrite existing entries in atp-pacing.json
//                         (default: skip subject/grade pairs that are already populated).
//   --dry-run             Show what would be processed; don't call the API.
//
// The script is resumable: re-running it picks up where it left off
// because already-populated subject/grade pairs are skipped by default.

import fs from 'node:fs';
import path from 'node:path';

const SOURCE_DIR = path.resolve('data/atp-source');
const OUTPUT_FILE = path.resolve('data/atp-pacing.json');
const MODEL = 'claude-sonnet-4-6';

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY is not set.');
  console.error('Run with: ANTHROPIC_API_KEY=sk-ant-... node scripts/extract-atp-pacing.js');
  process.exit(1);
}

const argv = process.argv.slice(2);
const flags = {
  only:    argFlag('--only'),
  limit:   argFlag('--limit') ? parseInt(argFlag('--limit'), 10) : Infinity,
  force:   argv.includes('--force'),
  dryRun:  argv.includes('--dry-run'),
};

function argFlag(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

// ─── Tool schema — what Sonnet must return per PDF ──────────────
const TOOL = {
  name: 'extract_atp_pacing',
  description: 'Return the structured ATP pacing data for the supplied PDF.',
  input_schema: {
    type: 'object',
    required: ['metadata', 'terms'],
    properties: {
      metadata: {
        type: 'object',
        required: ['subject', 'grade', 'atpVintage'],
        properties: {
          subject: {
            type: 'string',
            description: 'Subject name as it appears in data/atp.json subjects list. Examples: "Mathematics", "Natural Sciences and Technology", "Social Sciences — History", "English Home Language".',
          },
          grade: { type: 'integer', minimum: 4, maximum: 7 },
          atpVintage: { type: 'string', enum: ['2023-24', '2026'] },
        },
      },
      terms: {
        type: 'object',
        description: 'Object keyed by term number ("1","2","3","4"). Each value is a TermCell.',
        patternProperties: {
          '^[1-4]$': { $ref: '#/$defs/TermCell' },
        },
      },
    },
    $defs: {
      TermCell: {
        oneOf: [
          { $ref: '#/$defs/TopicBlocksCell' },
          { $ref: '#/$defs/LanguageStrandsCell' },
          { $ref: '#/$defs/ThemedCell' },
        ],
      },
      TopicBlocksCell: {
        type: 'object',
        required: ['kind', 'blocks'],
        properties: {
          kind: { const: 'topic-blocks' },
          totalHours: { type: 'integer' },
          weeksInTerm: { type: 'integer' },
          blocks: {
            type: 'array',
            items: {
              type: 'object',
              required: ['blockId', 'weeks', 'kind', 'topic'],
              properties: {
                blockId: { type: 'string', description: 'Stable id like g4-m-t1-b1.' },
                weeks: { type: 'array', items: { type: 'integer' } },
                hours: { type: ['integer', 'null'] },
                kind: { type: 'string', enum: ['content', 'assessment', 'revision'] },
                topic: { type: 'string' },
                concepts: { type: 'array', items: { type: 'string' } },
                prerequisite: { type: 'array', items: { type: 'string' } },
                assessmentType: { type: 'string', description: 'For kind="assessment": Assignment/Test/Investigation/Project/Exam.' },
                scope: { type: 'array', items: { type: 'string' } },
                notes: { type: 'string' },
              },
            },
          },
        },
      },
      LanguageStrandsCell: {
        type: 'object',
        required: ['kind', 'fortnights'],
        properties: {
          kind: { const: 'language-strands' },
          fortnights: {
            type: 'array',
            items: {
              type: 'object',
              required: ['weeks'],
              properties: {
                weeks: { type: 'array', items: { type: 'integer' } },
                listening: { type: 'array', items: { type: 'string' } },
                reading:   { type: 'array', items: { type: 'string' } },
                writing:   { type: 'array', items: { type: 'string' } },
                language:  { type: 'array', items: { type: 'string' } },
                notes: { type: 'string' },
              },
            },
          },
        },
      },
      ThemedCell: {
        type: 'object',
        required: ['kind', 'theme', 'weeks'],
        properties: {
          kind: { const: 'themed' },
          theme: { type: 'string' },
          weeks: {
            type: 'array',
            items: {
              type: 'object',
              required: ['week'],
              properties: {
                week: { type: 'integer' },
                concepts: { type: 'array', items: { type: 'string' } },
                physicalEducation: { type: 'array', items: { type: 'string' } },
                resources: { type: 'array', items: { type: 'string' } },
                assessment: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You extract South African DBE Annual Teaching Plan (ATP) pacing data into structured JSON.

The supplied PDF is one ATP, covering one subject across one grade for all four terms. Every term is a row of weekly columns; columns may span multiple weeks (e.g. "WEEK 4-6"). Each column contains a topic block with hours, concepts/skills bullets, and a prerequisite knowledge row.

Pick exactly one of three "kind" values per term cell, based on the PDF layout:

1. "topic-blocks" — Maths, Sciences (NS&Tech, NS, Tech), EMS, and any subject with a "HOURS PER TOPIC" row and a "PREREQUISITE SKILL OR PRE-KNOWLEDGE" row. Each column becomes a block: { weeks, hours, topic, concepts, prerequisite }. Set block.kind="content" for normal teaching weeks, "assessment" for Formal Assessment Tasks (Assignment, Test, Investigation, Project, Exam — capture the type in assessmentType and the scope in scope[]), "revision" for revision-only weeks.

2. "language-strands" — English HL/FAL and Afrikaans HL/FAL. The PDF organises content into four parallel columns per week (or fortnight): "LISTENING AND SPEAKING", "READING AND VIEWING", "WRITING AND PRESENTING", "LANGUAGE STRUCTURES AND CONVENTIONS". Group each fortnight (e.g. weeks 1-2) into one entry with strand arrays.

3. "themed" — Life Skills, Life Orientation. Each term has a single "CAPS TOPIC" theme that runs across the term, broken down by week. Each week has CORE CONCEPTS, optional PHYSICAL EDUCATION activity, and a RESOURCES TO ENHANCE LEARNING list. Capture the theme at cell level and the per-week breakdown in weeks[].

Hard rules:
- Copy concept and prerequisite bullets verbatim from the PDF — preserve wording, including the unusual punctuation DBE uses.
- Do not paraphrase, summarise, or merge bullets. The downstream lesson generator needs the exact CAPS phrasing.
- weeks[] uses the integers shown in the PDF column header. If a column says "WEEK 4-6", weeks=[4,5,6].
- For Maths/Sciences: hours come from the "HOURS PER TOPIC" row; copy the integer.
- blockId pattern: g{grade}-{subjAbbrev}-t{term}-b{n}. subjAbbrev: m=Maths, ns=Natural Sciences, nst=NS&Tech, t=Tech, ss=Soc Sci, ssh=History, ssg=Geography, ehl=English HL, efal=English FAL, ahl=Afrikaans HL, afal=Afrikaans FAL, ls=Life Skills, lo=Life Orientation, ems=EMS.
- subject MUST match one of these strings exactly: Mathematics, Natural Sciences and Technology, Natural Sciences, Technology, Social Sciences — History, Social Sciences — Geography, English Home Language, English First Additional Language, Afrikaans Home Language, Afrikaans First Additional Language, Life Skills — Personal and Social Wellbeing, Life Skills — Physical Education, Life Skills — Creative Arts, Life Orientation, Economic and Management Sciences. If a Soc Sci PDF combines History and Geography, return whichever the term predominantly covers, or "Social Sciences — History" for History-led terms and "Social Sciences — Geography" for Geography-led terms.
- atpVintage: "2026" if the cover or filename says 2026, else "2023-24".

Call the extract_atp_pacing tool exactly once with the full result.`;

// ─── Helpers ────────────────────────────────────────────────────
function loadMaster() {
  if (!fs.existsSync(OUTPUT_FILE)) return {};
  const raw = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
  // Strip _meta so we re-emit it cleanly. Keep subject keys.
  const { _meta, ...rest } = raw;
  return rest;
}

function saveMaster(master) {
  const withMeta = {
    _meta: {
      schemaVersion: 1,
      source: 'DBE Annual Teaching Plans',
      generatedBy: 'scripts/extract-atp-pacing.js',
      generatedAt: new Date().toISOString(),
      vintageNote: '2026 ATPs used for Mathematics and NS&Tech where available; 2023-24 ATPs used for all other subjects (still current per DBE).',
      discriminators: {
        'topic-blocks':     'Maths / NST / Technology / EMS — week-banded topic blocks with explicit hours per topic.',
        'language-strands': 'Home Language and First Additional Language — fortnightly grids across Listening/Speaking, Reading/Viewing, Writing/Presenting, Language Structures.',
        'themed':           'Life Skills / Life Orientation — term-long theme with weekly sub-activities and a resources list.',
      },
    },
    ...master,
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(withMeta, null, 2) + '\n');
}

function isCellPopulated(master, subject, grade) {
  return Boolean(master?.[subject]?.[String(grade)] && Object.keys(master[subject][String(grade)]).length === 4);
}

async function callSonnet(pdfBase64, filename) {
  const body = {
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'extract_atp_pacing' },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text',     text: `Extract the pacing data from this ATP PDF. Filename: ${filename}.` },
      ],
    }],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const toolUse = (data.content || []).find((c) => c.type === 'tool_use');
  if (!toolUse) throw new Error(`No tool_use in response. Stop reason: ${data.stop_reason}`);
  return { result: toolUse.input, usage: data.usage };
}

// ─── Main ───────────────────────────────────────────────────────
async function main() {
  const allPdfs = fs.readdirSync(SOURCE_DIR).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
  const targets = flags.only ? allPdfs.filter((f) => f === flags.only) : allPdfs;

  if (flags.only && targets.length === 0) {
    console.error(`No PDF found matching --only "${flags.only}". Available files:`);
    for (const f of allPdfs) console.error(`  ${f}`);
    process.exit(1);
  }

  console.log(`Found ${targets.length} PDF(s) to consider in ${SOURCE_DIR}.`);
  if (flags.dryRun) console.log('(dry run — no API calls will be made)');

  const master = loadMaster();
  let successes = 0;
  let totalInTokens = 0;
  let totalOutTokens = 0;

  for (const filename of targets) {
    if (successes >= flags.limit) break;

    const pdfPath = path.join(SOURCE_DIR, filename);
    console.log(`\n[${filename}]`);

    if (flags.dryRun) { console.log('  would extract.'); continue; }

    let pdfBase64;
    try {
      pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
    } catch (err) {
      console.error(`  ✗ read failed: ${err.message}`);
      continue;
    }

    let result, usage;
    try {
      ({ result, usage } = await callSonnet(pdfBase64, filename));
    } catch (err) {
      console.error(`  ✗ API failed: ${err.message}`);
      continue;
    }

    const { subject, grade } = result.metadata;
    if (!subject || !grade) {
      console.error(`  ✗ malformed metadata:`, result.metadata);
      continue;
    }

    if (isCellPopulated(master, subject, grade) && !flags.force) {
      console.log(`  → ${subject} G${grade} already populated. Use --force to overwrite. Skipping.`);
      continue;
    }

    master[subject] ??= {};
    master[subject][String(grade)] = result.terms;
    saveMaster(master);

    totalInTokens  += usage?.input_tokens  || 0;
    totalOutTokens += usage?.output_tokens || 0;
    successes++;

    console.log(`  ✓ ${subject} G${grade} (${result.metadata.atpVintage}) saved. ` +
                `Tokens: in=${usage?.input_tokens || 0} out=${usage?.output_tokens || 0}.`);
  }

  console.log(`\nDone. ${successes} extraction(s) saved to ${OUTPUT_FILE}.`);
  console.log(`Total tokens used: input=${totalInTokens}, output=${totalOutTokens}.`);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});
