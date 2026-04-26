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
 * Only transforms line-initial labels (^Answer: / ^Working:) to avoid
 * touching passage text that might quote those words mid-sentence.
 */
export function localiseLabels(text, language) {
  if (!text || language !== 'Afrikaans') return text;
  return text
    .replace(/^Answer\s*:/gm, 'Antwoord:')
    .replace(/^Working\s*:/gm, 'Werking:');
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

  // Pass 4 — collapse consecutive blank lines to a single blank.
  const collapsed = [];
  let blanks = 0;
  for (const line of singleTable) {
    if (line.trim() === '') {
      blanks++;
      if (blanks <= 1) collapsed.push(line);
    } else {
      blanks = 0;
      collapsed.push(line);
    }
  }

  // Phase 3A and Phase 3B are now separate Claude calls with dedicated
  // prompts ("generate each cognitive level table ONCE only"), so duplicate
  // analysis sections within a single response are no longer observed in the
  // wild. An older dedup pass at this point was too greedy — it matched the
  // "Cognitive Level" column header in the analysis table itself and cut off
  // every memo mid-table. Removed.
  return collapsed.join('\n');
}
