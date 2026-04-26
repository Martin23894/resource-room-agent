// Filters out stray AI reasoning / meta-commentary that Claude sometimes
// emits alongside the actual resource content, even when the prompt forbids
// it. This is a belt-and-braces defence — the prompt is the primary control;
// this runs afterwards in case the model slips.
//
// Each rule has been added in response to a real leak observed in production.
// When adding a new rule, pin the reason to a concrete example of leak.

const META_COMMENTARY_RULES = [
  // Plan/step indicators
  { test: (tr) => /^STEP\s+\d+\s*[—\-–]?/i.test(tr) },
  { test: (tr) => /^STEP\s+\d+$/i.test(tr) },

  // Rewrite / correction headers — English
  { test: (tr, t) => t.startsWith('CORRECTED ') || t.startsWith('UPDATED ') },
  { test: (tr, t) => t.includes('CORRECTED MEMORANDUM') || t.includes('CORRECTED COGNITIVE') },
  { test: (tr, t) => t.startsWith('NOTE:') || t.startsWith('NOTE ') || t.startsWith('NOTE TO') },
  { test: (tr, t) => t.includes('DISCREPANCY') || t.includes('RECONCILIATION') },
  { test: (tr, t) => t.startsWith('REVISED ') || t.startsWith('FINAL INSTRUCTION') || t.startsWith('FINAL CONFIRMED') },
  { test: (tr, t) => t.startsWith('RECOMMENDED ADJUSTMENT') || t.startsWith('TEACHERS SHOULD') },
  { test: (tr, t) => t.startsWith('RECOUNT:') || t.startsWith('RE-EXAMINE') || t.startsWith('RE-COUNT') },
  { test: (tr, t) => t.startsWith('VERIFY:') || t.startsWith('VERIFY ALL') || t.startsWith('CHECK:') },
  { test: (tr, t) => t.includes('ALREADY COUNTED') || t.includes('CUMULATIVE') },
  { test: (tr, t) => t.startsWith('THAT GIVES') || t.startsWith('THIS GIVES') },
  { test: (tr, t) => t.startsWith('SO ROUTINE') || t.startsWith('SO COMPLEX') || t.startsWith('SO KNOWLEDGE') },

  // Rewrite / correction headers — Afrikaans equivalents
  { test: (tr, t) => t.startsWith('REGSTEL ') || t.startsWith('VERBETER ') || t.startsWith('OPGEDATEER ') || t.startsWith('BYGEWERK ') },
  { test: (tr, t) => t.includes('VERBETERDE MEMORANDUM') || t.includes('HERSIENDE MEMORANDUM') },
  { test: (tr, t) => t.startsWith('NOTA:') || t.startsWith('NOTA ') || t.startsWith('NOTA AAN') },
  { test: (tr, t) => t.includes('TEENSTRYDIGHIED') || t.includes('VERSOENING') },
  { test: (tr, t) => t.startsWith('HERSIEN ') || t.startsWith('FINALE INSTRUKSIE') || t.startsWith('FINALE BEVESTIG') },
  { test: (tr, t) => t.startsWith('AANBEVOLE AANPASSING') || t.startsWith('ONDERWYSERS MOET') },
  { test: (tr, t) => t.startsWith('HERTELLING:') || t.startsWith('HERONDERSOEK') },
  { test: (tr, t) => t.startsWith('VERIFIEER:') || t.startsWith('VERIFIEER AL') },
  { test: (tr, t) => t.includes('AL GETEL') || t.includes('REEDS GETEL') || t.includes('KUMULATIEF') },
  { test: (tr, t) => t.startsWith('SO ROETINE') || t.startsWith('SO KOMPLEKS') || t.startsWith('SO KENNIS') },

  // Cognitive-level scratchpad rows — English and Afrikaans
  { test: (tr) => /^(KNOWLEDGE|ROUTINE|COMPLEX|PROBLEM|LOW|MIDDLE|HIGH|LITERAL|REORGAN|INFERENTIAL|EVALUATION)\s+ROWS?:/i.test(tr) },
  { test: (tr) => /^(KENNIS|ROETINE|KOMPLEKS|PROBLEEMOPLOSSING|LAAG|MIDDEL|HOOG|LETTERLIK|HERORGANISASIE|INFERENSIEEL|EVALUERING)\s+RYE?:/i.test(tr) },

  // Branding leaks (the DOCX builder handles branding)
  { test: (tr) => /^(\*{0,2})THE RESOURCE ROOM(\*{0,2})\s*$/i.test(tr) },

  // Mark arithmetic scratchpad
  { test: (tr) => /^MARKS?:/i.test(tr) && /written as|include also|one question/i.test(tr) },
  { test: (tr) => /^\(\d+\)\s*\+\s*\(\d+\)/.test(tr) },

  // Placeholder diagram markers (we disallow diagrams entirely)
  { test: (tr) => /^\[diagram/i.test(tr) || /^\[figure/i.test(tr) || /^\[image/i.test(tr) },
  { test: (tr) => /^\[an angle/i.test(tr) || /^\[a shape/i.test(tr) },

  // "Let me try", "I need to", etc. — English
  { test: (tr) => /^TRY\s+/i.test(tr) || /^USE\s+\*\*/i.test(tr) },
  { test: (tr) => /^NEW DATA SET/i.test(tr) || /^CHECKING CONSISTENCY/i.test(tr) },
  { test: (tr) => /^LET ME TRY/i.test(tr) || /^LET'S TRY/i.test(tr) },
  { test: (tr, t) => /^WAIT\s*[—\-–]/i.test(tr) || t.startsWith('WAIT ') },
  { test: (tr) => /^I MUST RECHECK/i.test(tr) || /^LET ME RECHECK/i.test(tr) },
  { test: (tr) => /^RECHECK:/i.test(tr) || /^CHECKING:/i.test(tr) },

  // Afrikaans thinking-aloud equivalents (Wag —, Laat my, Kom ons, Ek moet, etc.)
  // Mirrors every English "Let me / Wait / I need to" rule above.
  { test: (tr) => /^WAG\s*[—\-–]/i.test(tr) || /^WAG\s+/i.test(tr) },
  { test: (tr) => /^LAAT MY PROBEER/i.test(tr) || /^KOM ONS PROBEER/i.test(tr) || /^LAAT ONS PROBEER/i.test(tr) },
  { test: (tr) => /^LAAT MY TRY/i.test(tr) },
  { test: (tr) => /^EK MOET HERKONTREER/i.test(tr) || /^LAAT MY HERKONTREER/i.test(tr) },
  { test: (tr) => /^EK MOET HERTEL/i.test(tr) || /^LAAT MY HERTEL/i.test(tr) },
  { test: (tr) => /^EK MOET VERIFIEER/i.test(tr) || /^LAAT MY VERIFIEER/i.test(tr) },
  { test: (tr) => /^EINTLIK\s*[—\-–,]/i.test(tr) || /^EINTLIK\s+/i.test(tr) },
  { test: (tr) => /^HERKONTREER:/i.test(tr) || /^NAGAAN:/i.test(tr) || /^KONTROLEER:/i.test(tr) },

  // Financial scratch
  { test: (tr) => /^COST\s*=/i.test(tr) || /^INCOME\s*=/i.test(tr) },
  { test: (tr) => /^SINCE\s+R\d/i.test(tr) },

  // Recount tallies — English
  { test: (tr) => /^I NEED TO/i.test(tr) || /^LET ME VERIFY/i.test(tr) },
  { test: (tr) => /^CURRENT TOTALS?:/i.test(tr) || /^LET ME RECOUNT/i.test(tr) },
  { test: (tr) => /^REDUCE BY/i.test(tr) },

  // Recount tallies — Afrikaans
  { test: (tr) => /^HUIDIGE TOTALE?:/i.test(tr) || /^LAAT MY HERTEL\b/i.test(tr) },
  { test: (tr) => /^VERMINDER MET\b/i.test(tr) },
  { test: (tr, t) => t.startsWith('DIT GEE ') || t.startsWith('DIT LUI ') },

  // Mid-line recount reasoning Claude sprinkles into level-summary lines, e.g.
  //   "High Order (7 marks): Q9.1 (1) + Q10.3 was not listed; confirmed sum: … = 6 marks"
  //   "High Order (7 marks): Q9.1 (1) + Q9.2 (2) + [remaining 1 mark from Q10 total] = 7 marks"
  { test: (tr) => /\bwas not listed\b/i.test(tr) },
  { test: (tr) => /\bconfirmed sum\b/i.test(tr) },
  { test: (tr) => /\[remaining\s+\d+\s+marks?\b/i.test(tr) },
  { test: (tr) => /\bso total\s*=/i.test(tr) && /\brecount\b/i.test(tr) },
  { test: (tr) => /^but (low|middle|high|knowledge|routine|complex|problem|literal|reorgan|inferential|evaluation)/i.test(tr) },

  // Distribution / compliance warnings — Claude sometimes adds a paragraph
  // like "⚠ COGNITIVE LEVEL DISTRIBUTION NOTE: This paper does not meet …"
  // when the actual cog-level split differs from the prescribed one. This
  // is useful commentary for the developer but must not appear in the memo.
  { test: (tr) => /^\*{0,3}\s*⚠/.test(tr) },
  { test: (tr, t) => t.includes('DISTRIBUTION NOTE') || t.includes('COMPLIANCE NOTE') },
  { test: (tr, t) => t.startsWith('THIS PAPER DOES NOT MEET') || t.startsWith('THIS PAPER WOULD') },
  { test: (tr, t) => t.startsWith('THE QUESTION PAPER SHOULD BE') || t.startsWith('THE PRESCRIBED DISTRIBUTION SHOULD') },
  { test: (tr, t) => /^NO (LOW|MIDDLE|HIGH|KNOWLEDGE|ROUTINE|COMPLEX|PROBLEM) ORDER QUESTIONS/i.test(tr) || /^NO (LITERAL|REORGAN|INFERENTIAL|EVALUATION)/i.test(tr) },
  { test: (tr, t) => t.startsWith('THE ACTUAL DISTRIBUTION') || t.startsWith('THE ACTUAL PAPER ALLOCATES') },

  // Distribution / compliance warnings — Afrikaans equivalents
  { test: (tr, t) => t.includes('VERSPREIDINGSNOTA') || t.includes('NALEWINGNOTA') },
  { test: (tr, t) => t.startsWith('HIERDIE VRAESTEL VOLDOEN NIE') || t.startsWith('HIERDIE VRAESTEL SOU') },
  { test: (tr, t) => t.startsWith('DIE VRAESTEL MOET') || t.startsWith('DIE VOORGESKREWE VERSPREIDING MOET') },
  { test: (tr, t) => /^GEEN (LAE|MIDDEL|HOË|KENNIS|ROETINE|KOMPLEKS|PROBLEEM) ORDE VRAE/i.test(tr) || /^GEEN (LETTERLIK|HERORGANISASIE|INFERENSIEEL|EVALUERING)/i.test(tr) },
  { test: (tr, t) => t.startsWith('DIE WERKLIKE VERSPREIDING') || t.startsWith('DIE WERKLIKE VRAESTEL') },

  // Bug 21 — phase-commentary leakage. The Phase 4 memo correction
  // sometimes opened with restatements of the error report:
  //   "Q7.2: The error report confirms the answer is already correct…"
  //   "Q7.4: The working needs to explicitly state…"
  // and a stray ```json fence wrapper. Strip the lines that match this
  // exact preamble shape — a sub-question reference followed by colon
  // and a META-COMMENT about the error report / the correction itself.
  //
  // The match patterns are intentionally narrow so we never delete
  // legitimate question content. "Q1.2: This table shows…" is a real
  // question stem and must NOT be stripped — only phrases that clearly
  // refer to the meta-process (the error report, the correction, the
  // working that needs adjusting) are dropped.
  { test: (tr) => /^Q\s*\d+(\.\d+)?\s*:\s+The\s+error\s+report\b/i.test(tr) },
  { test: (tr) => /^Q\s*\d+(\.\d+)?\s*:\s+The\s+working\s+(?:needs|must|should)\b/i.test(tr) },
  { test: (tr) => /^Q\s*\d+(\.\d+)?\s*:\s+The\s+(?:memorandum|correction|memo)\s+(?:must|should|needs|will)\b/i.test(tr) },
  { test: (tr) => /^Q\s*\d+(\.\d+)?\s*:\s+No\s+change\s+(?:needed|required|necessary)/i.test(tr) },
  { test: (tr) => /^Q\s*\d+(\.\d+)?\s*:\s+(?:Already\s+correct|Requires\s+no\s+change|Confirmed\s+correct)\b/i.test(tr) },
  { test: (tr) => /^Q\s*\d+(\.\d+)?\s*:\s+Fix:\s+/i.test(tr) },
  // Stray markdown code-fence lines (```json, ```, ```text, ```markdown).
  // The fence isn't part of the rendered DOCX so it must never survive.
  { test: (tr) => /^```[a-z]*\s*$/i.test(tr) },
  // Stray JSON envelope markers on their own line.
  { test: (tr) => /^\{\s*"content"\s*:\s*"?\s*$/.test(tr) },
  { test: (tr) => tr === '"}' || tr === '}"' },
];

function isCommentaryLine(line) {
  const tr = line.trim();
  const t = tr.toUpperCase();
  for (const rule of META_COMMENTARY_RULES) {
    if (rule.test(tr, t)) return true;
  }
  return false;
}

// Collapse very long "recount" explanation lines (usually scratch work
// crammed onto a single 500+ char line with running arithmetic) OR a
// cognitive-distribution commentary paragraph Claude writes as one line.
function isLongScratchpadLine(line) {
  if (
    line.length > 200 &&
    (/distribution\s+note/i.test(line) ||
      /prescribed\s+cognitive\s+level/i.test(line) ||
      /prescribed\s+distribution/i.test(line))
  ) {
    return true;
  }
  return (
    line.length > 300 &&
    /recount|already counted|cumulative|verify|reconcil/i.test(line) &&
    /\d+\s*\+\s*\d+/.test(line)
  );
}

// When Claude iterates on the Cognitive Level Analysis table (writes one,
// recounts aloud, writes a "corrected" second table), there will be two or
// more "Cognitive Level | Prescribed %" header rows in the output. Keep
// only the LAST table — that's Claude's final version. Everything from the
// first header up to the last header is dropped.
const COG_TABLE_HEADER = /^\s*\|?\s*(Cognitive Level|Kognitiewe Vlak)\s*\|/i;
function keepLastCogTable(lines) {
  const headerIdx = [];
  for (let i = 0; i < lines.length; i++) {
    if (COG_TABLE_HEADER.test(lines[i])) headerIdx.push(i);
  }
  if (headerIdx.length < 2) return lines;
  const first = headerIdx[0];
  const last = headerIdx[headerIdx.length - 1];
  return [...lines.slice(0, first), ...lines.slice(last)];
}

/**
 * Replace English answer/working labels with localised equivalents.
 * Must run AFTER ensureAnswerSpace so injected stubs are also caught.
 *
 * Coverage (F5 — Resource 3 Bug 31 follow-up):
 *   - Line-initial: "Answer:" / "Working:" with optional leading whitespace
 *   - Markdown-bold:  "**Answer:**" / "**Working:**"  (open + close OR just open)
 *   - Pipe-table cell start:  "| Answer:" / "| Working:"
 *   - Bullet-list start:  "- Answer:" / "* Answer:"
 *
 * We deliberately do NOT touch mid-sentence "answer:" inside passage prose.
 *
 * Language matching is case-insensitive ("Afrikaans" / "afrikaans" / "AFRIKAANS"
 * all trigger the rewrite) so callers that lowercase the language string
 * before passing it (api/generate.js:isAfr, isAfrRtt) don't silently no-op.
 */
export function localiseLabels(text, language) {
  if (!text) return text;
  if (String(language || '').toLowerCase() !== 'afrikaans') return text;
  return text
    // Line-initial (with optional leading whitespace)
    .replace(/^([ \t]*)Answer\s*:/gm, '$1Antwoord:')
    .replace(/^([ \t]*)Working\s*:/gm, '$1Werking:')
    // Markdown-bold form: **Answer:** or **Answer**: — match the label
    // and bold markers WITHOUT consuming trailing whitespace.
    .replace(/\*\*Answer\s*:\s*\*\*/g, '**Antwoord:**')
    .replace(/\*\*Working\s*:\s*\*\*/g, '**Werking:**')
    .replace(/\*\*Answer\*\*\s*:/g, '**Antwoord**:')
    .replace(/\*\*Working\*\*\s*:/g, '**Werking**:')
    // Pipe-table cell start: "| Answer:" — the answer label inside a memo
    // marking-guidance cell. Conservative: only at the start of a cell
    // (after `|` and optional whitespace) so we never touch a passage that
    // happens to contain the word "answer:".
    .replace(/(\|\s*)Answer\s*:/g, '$1Antwoord:')
    .replace(/(\|\s*)Working\s*:/g, '$1Werking:')
    // Bullet-list start: "- Answer:" / "* Answer:"
    .replace(/^([ \t]*[-*]\s+)Answer\s*:/gm, '$1Antwoord:')
    .replace(/^([ \t]*[-*]\s+)Working\s*:/gm, '$1Werking:');
}

/**
 * Collapse runs of repeated MEMORANDUM headings.
 *
 * The RTT memo assembly hard-codes a single "MEMORANDUM" heading and then
 * concatenates three model-generated phases (A / B+C / D). When the model
 * also opens a phase with its own "MEMORANDUM" line we ship two — and
 * the Grade 6 Afrikaans HL audit caught a triple. This pass keeps the
 * first MEMORANDUM-style heading and silently drops any later ones that
 * appear within ~3 lines of another (i.e. a fresh memo banner with no
 * intervening table content).
 *
 * "MEMORANDUM-style" matches the bare word, an Afrikaans variant, or a
 * "REAKSIE OP TEKS — AFDELING …" reprise the model sometimes emits.
 */
// Banner shapes to dedupe / strip. Includes:
//   - MEMORANDUM (with optional separator)
//   - MEMO (bare loanword Claude sometimes emits in Afrikaans)
//   - REAKSIE OP TEKS — … (canonical Afrikaans subtitle reprise)
//   - RESPONS OP TEKS — … (anglicised Afrikaans, Bug 25 — Resource 2)
const MEMO_BANNER = /^\s*(MEMORANDUM|MEMORANDUM\s*[-—:]|MEMO|REAKSIE OP TEKS\s*[-—].*|RESPONS OP TEKS\s*[-—].*)\s*$/i;
function dedupeMemoHeaders(lines) {
  const out = [];
  let lastBannerOutIdx = -Infinity;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (MEMO_BANNER.test(line)) {
      // If we already emitted a banner in the last few output lines and
      // nothing of substance has appeared since, skip this one.
      const intervening = out.slice(lastBannerOutIdx + 1).filter((l) => l.trim() !== '');
      if (intervening.length === 0 && lastBannerOutIdx >= 0) {
        // duplicate banner with only blanks since the previous — drop
        continue;
      }
      lastBannerOutIdx = out.length;
    }
    out.push(line);
  }
  return out;
}

// Phase 6: in-cell meta-commentary scrubbing.
//
// The whole-line filter above strips meta-commentary that appears as its
// own line. The audits (Resources 1, 3, 4) caught a different shape:
// meta-commentary INSIDE a memo answer-table cell, which the line filter
// can't touch without destroying the row's data. Examples:
//
//   "Figure 6: 30 + 12 = 42 (award both marks together for 7.2)"
//   "Award marks based on the following model... NOTE TO EDUCATOR:
//      The original sentence appears incomplete in the question paper."
//   "Vraag 4.4 was onvolledig op die vraestel — beoordeel..."
//
// Each pattern below targets a specific known leak. When we find one, we
// strip just the offending substring (a parenthetical, a sentence, or a
// note phrase) and leave the rest of the cell intact.
const META_PATTERNS = [
  // "(award both marks together…)" / "(award marks together)"
  { pattern: /\s*\([^)]*award\s+(?:both|all)?\s*marks?\s+together[^)]*\)/gi, label: 'award-marks-together' },
  // "(see report)" / "(see error report)"
  { pattern: /\s*\([^)]*see\s+(?:the\s+)?(?:error\s+)?report[^)]*\)/gi, label: 'see-report' },
  // "NOTE TO EDUCATOR: …<sentence>." — stop at the first '.' that ends a sentence.
  { pattern: /\bNOTE TO EDUCATOR:[^.]*\.(?:\s+[A-Z]'?[a-z]?[^.]*\.)?/gi, label: 'note-to-educator' },
  // "NOTA AAN ONDERWYSER: …" (Afrikaans equivalent)
  { pattern: /\bNOTA AAN ONDERWYSER:[^.]*\./gi, label: 'nota-aan-onderwyser' },
  // "Vraag 4.4 was onvolledig op die vraestel — beoordeel op grond van wat die leerder verstaan."
  { pattern: /\bVraag\s+\d+(?:\.\d+)*(?:\([a-z]\))?\s+was\s+onvolledig[^.]*\./gi, label: 'vraag-onvolledig' },
  // "Question 4.4 is incomplete in the question paper — …."
  { pattern: /\bQuestion\s+\d+(?:\.\d+)*(?:\([a-z]\))?\s+is\s+incomplete[^.]*\./gi, label: 'question-incomplete' },
  // "appears incomplete in the question paper"
  { pattern: /\bappears\s+incomplete\s+in\s+the\s+question\s+paper[^.]*\./gi, label: 'appears-incomplete' },
  // "onvolledig op die vraestel" — generic Afrikaans
  { pattern: /\bonvolledig\s+op\s+die\s+vraestel[^.]*\./gi, label: 'onvolledig-vraestel' },
];

/**
 * Scrub known meta-commentary phrases from anywhere in `text` (not just
 * line starts). Logs the patterns matched via `onMatch(label, count)` so
 * the caller can record which leaks were stripped.
 */
export function scrubInCellMetaCommentary(text, onMatch = () => {}) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  for (const { pattern, label } of META_PATTERNS) {
    const matches = out.match(pattern);
    if (matches && matches.length) {
      onMatch(label, matches.length);
      out = out.replace(pattern, '');
    }
  }
  return out;
}

// Strip phantom answer-table rows that exist only to apologise for the
// memo's own gaps. Resource 1 audit (Bug 10) shipped a Section D answer
// row "| 4.8 | [No question 4.8 appears in the paper — marks already
// accounted for in 4.1–4.7 above] | N/A | N/A | — |".
//
// Match pattern: a pipe row whose ANSWER cell starts with "[No question"
// or "[No vraag" (Afrikaans) — these are unmistakable phantoms.
const PHANTOM_ROW_RE = /^\s*\|\s*\d+(?:\.\d+)*(?:\([a-z]\))?\s*\|\s*\[No (?:question|vraag)\b[^\n]*$/gim;

function stripPhantomRows(text) {
  if (!text || typeof text !== 'string') return { text, stripped: 0 };
  const matches = text.match(PHANTOM_ROW_RE);
  if (!matches) return { text, stripped: 0 };
  return {
    text: text.replace(PHANTOM_ROW_RE, ''),
    stripped: matches.length,
  };
}

/**
 * Strip a leading MEMORANDUM-style banner from the start of a memo phase
 * before assembly. Used by the RTT pipeline so that the hard-coded outer
 * heading and the model-emitted phase headings don't pile up.
 *
 * Accepts an optional run of blank lines before the banner. Removes the
 * banner AND any title/framework lines that follow before the first table
 * row, since those are duplicates of the assembled outer subtitle.
 *
 * RECURSIVE: if the model emits TWO banner blocks back-to-back —
 *   "MEMORANDUM\n\nGr 6 Afrikaans HL — RTT — Kw 2\nCAPS-belyn | …\n\nMEMORANDUM\n\nGr 6 Afrikaans HL | Die Groot Skoolfees\n\n| NR. | …"
 * (the Paper 9 / Bug 4 leak) — we strip both. Each iteration removes one
 * banner-plus-subtitle block. We stop when the head no longer looks like
 * a banner.
 */
export function stripLeadingMemoBanner(text) {
  if (!text) return text;
  let lines = text.split('\n');
  // Hard cap on iterations so a malformed input can never loop forever.
  for (let pass = 0; pass < 5; pass++) {
    let i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length || !MEMO_BANNER.test(lines[i])) break;
    // Drop the banner and any non-table text that immediately follows
    // (typically a subtitle + framework line).
    i++;
    while (i < lines.length) {
      const tr = lines[i].trim();
      if (tr === '') { i++; continue; }
      // Stop at the first thing that looks like memo content: a pipe table
      // row, a numbered answer key row, or a "PART N —" header.
      if (/^\|/.test(tr) || /^(NO\.|NR\.|N°|#)/i.test(tr) || /^\d+\.\d/.test(tr)) break;
      if (/^PART\s+\d+\s*[—\-–]/i.test(tr) || /^DEEL\s+\d+\s*[—\-–]/i.test(tr)) break;
      if (/^(SECTION|AFDELING)\s+[A-Z]\b/i.test(tr)) break;
      // Subtitles / framework lines / passage-title reprises — drop these.
      // We accept any short free-text line (≤ 120 chars) that does NOT
      // already look like content, since the model varies the wording.
      if (
        /^(CAPS|Grade|Graad|REAKSIE|RESPONSE|Barrett)/i.test(tr) ||
        /Framework|raamwerk/i.test(tr) ||
        // Passage / paper-title reprise pattern: "… | <Title>" or
        // "<Subject> — <Title>" — if the line is short, drop it.
        (tr.length <= 120 && !/[(]\d+[)]/.test(tr) && !/^_+$/.test(tr))
      ) {
        i++; continue;
      }
      break;
    }
    lines = lines.slice(i);
  }
  return lines.join('\n');
}

export function cleanOutput(text) {
  if (!text) return text;

  // Pass 0 — unescape markdown escape sequences Claude sometimes emits to
  // protect underscores/asterisks from italic/bold interpretation. Without
  // this, a True/False question's inline blank comes out as "\_\_\_\_\_\_…"
  // (literal backslashes) AND the answer-space helper fails to detect it
  // as a blank, so it injects two extra answer lines below the question.
  text = text.replace(/\\_/g, '_').replace(/\\\*/g, '*');

  // Pass 1 — drop commentary lines entirely.
  const kept = text.split('\n').filter((line) => !isCommentaryLine(line));

  // Pass 2 — blank out (not drop, so surrounding structure stays) long scratchpads.
  const scrubbed = kept.map((line) => (isLongScratchpadLine(line) ? '' : line));

  // Pass 3 — keep only the last Cognitive Level analysis table if Claude
  // produced multiple (happens when it recounts and "corrects" itself).
  const singleTable = keepLastCogTable(scrubbed);

  // Pass 3b — strip duplicate MEMORANDUM banners (Bug 4). The RTT memo
  // assembly pre-pends one outer banner; phase outputs sometimes add
  // their own. Without this pass the rendered DOCX shows MEMORANDUM
  // twice or thrice in a row.
  const dedupedBanners = dedupeMemoHeaders(singleTable);

  // Pass 3c — Phase 6: strip phantom answer rows that exist only to
  // apologise for their own absence (Resource 1 Bug 10).
  const phantomFixed = stripPhantomRows(dedupedBanners.join('\n'));
  const dedupedLines = phantomFixed.text.split('\n');

  // Pass 4 — collapse consecutive blank lines to a single blank.
  const collapsed = [];
  let blanks = 0;
  for (const line of dedupedLines) {
    if (line.trim() === '') {
      blanks++;
      if (blanks <= 1) collapsed.push(line);
    } else {
      blanks = 0;
      collapsed.push(line);
    }
  }

  // Pass 5 — Phase 6: scrub in-cell meta-commentary phrases (NOTE TO
  // EDUCATOR, "(award both marks together)", "Vraag X was onvolledig", …)
  // that the audits caught inside marking-guidance cells. Operates on the
  // joined text so multi-sentence patterns work even across line wraps.
  const scrubbedFinal = scrubInCellMetaCommentary(collapsed.join('\n'));

  // Phase 3A and Phase 3B are now separate Claude calls with dedicated
  // prompts ("generate each cognitive level table ONCE only"), so duplicate
  // analysis sections within a single response are no longer observed in the
  // wild. An older dedup pass at this point was too greedy — it matched the
  // "Cognitive Level" column header in the analysis table itself and cut off
  // every memo mid-table. Removed.
  return scrubbedFinal;
}
