// Day-3 render spike — turn the six fixtures into DOCX files.
//
// Usage:
//   node schema/render-spike.js              # render all six
//   node schema/render-spike.js g4-maths-test-t1
//
// Outputs land in schema/spike-outputs/<name>.docx (gitignored). Fixtures
// are deterministic (no model in the loop) so this validates the renderer
// in isolation; once we trust it, the same renderer runs on live spike
// outputs without changes.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Packer } from 'docx';

import { renderResource } from '../lib/render.js';
import { assertResource } from './resource.schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'spike-outputs');

const FIXTURES = [
  'g4-maths-test-t1',
  'g5-nst-worksheet-t2',
  'g6-english-hl-rtt-t4',
  'g7-soc-sci-history-exam-t2',
  'g7-ems-final-exam',
  'g5-afrikaans-hl-rtt-t2',
];

async function renderOne(name) {
  const t0 = Date.now();
  try {
    const fixture = (await import(`./fixtures/${name}.js`)).default;
    const v = assertResource(fixture);
    if (!v.ok) {
      console.log(`SKIP  ${name.padEnd(30)} fixture failed assertResource (${v.errors.length} errors)`);
      return { ok: false };
    }

    const doc = renderResource(fixture);
    const buf = await Packer.toBuffer(doc);
    mkdirSync(OUT_DIR, { recursive: true });
    const out = join(OUT_DIR, `${name}.docx`);
    writeFileSync(out, buf);

    const ms = Date.now() - t0;
    const kb = (buf.length / 1024).toFixed(1);
    console.log(`OK    ${name.padEnd(30)} ${kb}KB  (${ms}ms)`);
    return { ok: true };
  } catch (err) {
    const ms = Date.now() - t0;
    console.log(`ERROR ${name.padEnd(30)} (${ms}ms) ${err.message}`);
    if (err.stack) console.log(err.stack.split('\n').slice(0, 4).join('\n'));
    return { ok: false };
  }
}

async function main() {
  const filter = process.argv[2];
  const targets = filter ? FIXTURES.filter((n) => n === filter) : FIXTURES;
  if (filter && targets.length === 0) {
    console.error(`No fixture named "${filter}". Available: ${FIXTURES.join(', ')}`);
    process.exit(1);
  }

  console.log(`Render spike — ${targets.length} fixture(s)`);
  console.log('─'.repeat(80));

  let ok = 0;
  for (const name of targets) {
    const r = await renderOne(name);
    if (r.ok) ok++;
  }

  console.log('─'.repeat(80));
  console.log(`Done: ${ok}/${targets.length} rendered. DOCX in schema/spike-outputs/.`);
  if (ok < targets.length) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
