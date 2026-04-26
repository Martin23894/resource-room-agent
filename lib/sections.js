// Defensive validator for SECTION letters in exam-type papers.
//
// Bug 22 — Paper 11 (EMS Term 2) shipped with SECTION A → unlabelled
// Q2/Q3 → SECTION C → SECTION D (Section B missing entirely). The user-
// facing complaint is that the section letters must be sequential
// (A, B, C, D) with no gaps. The prompt forbids gaps, but the writer
// occasionally produces them anyway, so this code-side pass catches
// what the prompt missed.
//
// Strategy: after Phase 2 / Phase 2a, scan the paper for SECTION/AFDELING
// headers in order. If the letters are not sequential starting at A,
// renumber them in place so the visible labels become A, B, C, D, …
// We never delete a header or change other content. If there are no
// headers (e.g. a Worksheet that uses Question 1, Question 2 …) we
// return the input unchanged.

// Match a plain SECTION/AFDELING header line. We deliberately do NOT
// match markdown-wrapped variants (`**SECTION A**`, `## SECTION A`) —
// the prompts never ask for them and matching them would require
// surgically preserving the markdown wrapper through the in-place
// replace, which is a footgun. The docx-builder strips `**` at render
// time anyway; if a future leak produces a wrapped header we'll add
// targeted handling rather than blanket support.
const SECTION_RE = /^(\s*)(SECTION|AFDELING)\s+([A-Z])\b/i;

/**
 * Renumber SECTION/AFDELING headers in the paper so their letters run
 * consecutively from A. Returns `{ text, changed, replacements }`.
 *
 * `replacements` is a list of `{ from, to }` letter swaps performed —
 * useful for log lines.
 */
export function ensureSequentialSectionLetters(paperText) {
  if (typeof paperText !== 'string' || paperText.length === 0) {
    return { text: paperText, changed: false, replacements: [] };
  }
  const lines = paperText.split('\n');
  const headers = [];
  for (let i = 0; i < lines.length; i++) {
    const m = SECTION_RE.exec(lines[i]);
    if (m) headers.push({ lineIdx: i, indent: m[1] || '', label: m[2].toUpperCase(), letter: m[3].toUpperCase() });
  }
  if (headers.length === 0) {
    return { text: paperText, changed: false, replacements: [] };
  }

  const expected = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const replacements = [];
  for (let i = 0; i < headers.length; i++) {
    const want = expected[i];
    if (!want) break; // safety
    if (headers[i].letter !== want) {
      const h = headers[i];
      replacements.push({ from: h.letter, to: want });
      // Re-emit the header line with the corrected letter, preserving
      // everything after the letter (the colon + section title).
      lines[h.lineIdx] = lines[h.lineIdx].replace(
        SECTION_RE,
        (_m, indent, label) => `${indent}${label} ${want}`,
      );
    }
  }

  if (replacements.length === 0) {
    return { text: paperText, changed: false, replacements: [] };
  }
  return { text: lines.join('\n'), changed: true, replacements };
}

// Match an existing "SECTION B TOTAL: 10 marks" / "AFDELING C TOTAAL: 5 punte"
// closing line for a given section label. Tolerates extra whitespace and
// the optional ":" before the number.
function buildExistingCloserRe(sectionLabel) {
  // sectionLabel may be "SECTION A" / "AFDELING B" — escape just in case
  const safe = sectionLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*${safe}\\s+(TOTAL|TOTAAL|TOTALE)\\s*:?.*$`, 'gim');
}

// Match ANY section closer in a body of text (so we can detect a Section
// B body that closes with a SECTION C / AFDELING C line — Bug 4 / 16).
const ANY_SECTION_CLOSER_RE = /^\s*(SECTION|AFDELING)\s+[A-Z]\s+(TOTAL|TOTAAL|TOTALE)\s*:?.*$/gim;

/**
 * Replace (or append) the canonical closing-total line for a section's
 * memo body. Strips any existing closer for THIS section AND any other
 * section closer the writer may have placed by accident (the Bug 4 / 16
 * "Section B body closes with SECTION C TOTAL" failure mode), then
 * appends the canonical line in code.
 *
 * The canonical closer always reads exactly:
 *   "<sectionLabel> <totalLabel>: <sectionTotal> <marksWord>"
 *
 * Returns the body with the canonical closer at the end (separated by a
 * blank line if the body doesn't already end in one).
 *
 * @param {string} body          The section's memo content.
 * @param {string} sectionLabel  e.g. "SECTION B" / "AFDELING C".
 * @param {string} totalLabel    e.g. "TOTAL" / "TOTAAL".
 * @param {number} sectionTotal  The mark total for this section.
 * @param {string} marksWord     e.g. "marks" / "punte".
 * @returns {{ text: string, strippedExisting: boolean, strippedWrong: boolean }}
 */
export function ensureSectionCloser(body, sectionLabel, totalLabel, sectionTotal, marksWord) {
  if (typeof body !== 'string') return { text: '', strippedExisting: false, strippedWrong: false };
  let text = body;
  // 1. Strip any closer for THIS section (so we re-emit a canonical one).
  const sameRe = buildExistingCloserRe(sectionLabel);
  let strippedExisting = false;
  text = text.replace(sameRe, () => { strippedExisting = true; return ''; });
  // 2. Strip closers for ANY OTHER section (Bug 4 / 16 prevention). This
  //    targets the case where memo Section B accidentally ended with
  //    "SECTION C TOTAL: 5 marks". We never want a foreign-section closer
  //    inside a section body.
  let strippedWrong = false;
  text = text.replace(ANY_SECTION_CLOSER_RE, (m) => {
    if (new RegExp(sectionLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(m)) return m;
    strippedWrong = true;
    return '';
  });
  // 3. Tidy up trailing whitespace and append canonical closer.
  text = text.replace(/\s+$/, '');
  const canonical = `${sectionLabel} ${totalLabel}: ${sectionTotal} ${marksWord}`;
  return {
    text: text + '\n\n' + canonical,
    strippedExisting,
    strippedWrong,
  };
}
