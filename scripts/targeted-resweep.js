#!/usr/bin/env node
// Targeted re-sweep: re-run a list of cell IDs through the current generate
// pipeline, write outputs to a separate dir for diff against the prior sweep.
//
// Usage:
//   node scripts/targeted-resweep.js <ids-file> [--out=DIR] [--delay-ms=N]
//
// <ids-file> is a newline-delimited list of test-matrix IDs (e.g.
// "g4-mathematics-exam-t2"). Outputs are written to schema/spike-outputs-resweep/
// by default — chosen so it doesn't shadow the prior schema/spike-outputs/.
//
// Sequential with a per-call delay to keep within Anthropic's 90k/min output
// token cap. After the run, also writes a summary line per cell so you can
// diff schema-validity + rebalance-nudge counts against the prior sweep.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Packer } from 'docx';

import { generate } from '../api/generate.js';
import { renderResource } from '../lib/render.js';
import { buildAllTermsMatrix } from '../schema/test-matrix.js';

function parseArgs(argv) {
  const args = { delayMs: 30000, out: 'schema/spike-outputs-resweep' };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
    else if (a.startsWith('--delay-ms=')) args.delayMs = Number(a.slice('--delay-ms='.length));
    else positional.push(a);
  }
  args.idsFile = positional[0];
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.idsFile) {
    console.error('Usage: node scripts/targeted-resweep.js <ids-file> [--out=DIR] [--delay-ms=N]');
    process.exit(2);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(2);
  }

  const wantedIds = new Set(
    readFileSync(args.idsFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean),
  );
  const matrix = buildAllTermsMatrix();
  const cases = matrix.filter((c) => wantedIds.has(c.id));
  const missing = [...wantedIds].filter((id) => !matrix.find((c) => c.id === id));
  if (missing.length) {
    console.error('IDs not found in matrix:', missing.join(', '));
    process.exit(2);
  }

  console.log(`Targeted resweep — ${cases.length} cells, sequential with ${args.delayMs}ms spacing`);
  console.log(`Output dir: ${args.out}`);
  console.log(`Estimated cost: ~$${(cases.length * 0.12).toFixed(2)}`);
  console.log('─'.repeat(80));

  const summary = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const t0 = Date.now();
    const outDir = join(args.out, `g${c.grade}`);
    mkdirSync(outDir, { recursive: true });
    try {
      const result = await generate(c.request);
      writeFileSync(join(outDir, `${c.id}.json`), JSON.stringify(result.resource, null, 2));
      if (result.validation.ok) {
        const doc = renderResource(result.resource);
        const buf = await Packer.toBuffer(doc);
        writeFileSync(join(outDir, `${c.id}.docx`), buf);
      }
      const status = result.validation.ok ? 'OK  ' : 'FAIL';
      const nudges = result.rebalance.adjustments.length;
      const attemptsStr = result.attempts > 1 ? ` attempts=${result.attempts}` : '';
      console.log(`${status} ${c.id.padEnd(56)} nudges=${nudges}${attemptsStr} (${Date.now() - t0}ms)`);
      if (!result.validation.ok) {
        for (const e of result.validation.errors.slice(0, 3)) {
          console.log(`     ↳ ${e.path}: ${e.message}`);
        }
      }
      summary.push({ id: c.id, ok: result.validation.ok, nudges, attempts: result.attempts });
    } catch (err) {
      console.log(`ERR  ${c.id.padEnd(56)} ${err.message}`);
      summary.push({ id: c.id, ok: false, error: err.message });
    }
    if (i < cases.length - 1) await new Promise((r) => setTimeout(r, args.delayMs));
  }

  writeFileSync(join(args.out, '_summary.json'), JSON.stringify(summary, null, 2));
  const okCount = summary.filter((s) => s.ok).length;
  console.log('─'.repeat(80));
  console.log(`Done: ${okCount}/${summary.length} schema-valid.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
