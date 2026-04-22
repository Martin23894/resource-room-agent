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

  // Rewrite / correction headers
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

  // Cognitive-level scratchpad rows
  { test: (tr) => /^(KNOWLEDGE|ROUTINE|COMPLEX|PROBLEM|LOW|MIDDLE|HIGH|LITERAL|REORGAN|INFERENTIAL|EVALUATION)\s+ROWS?:/i.test(tr) },

  // Branding leaks (the DOCX builder handles branding)
  { test: (tr) => /^(\*{0,2})THE RESOURCE ROOM(\*{0,2})\s*$/i.test(tr) },

  // Mark arithmetic scratchpad
  { test: (tr) => /^MARKS?:/i.test(tr) && /written as|include also|one question/i.test(tr) },
  { test: (tr) => /^\(\d+\)\s*\+\s*\(\d+\)/.test(tr) },

  // Placeholder diagram markers (we disallow diagrams entirely)
  { test: (tr) => /^\[diagram/i.test(tr) || /^\[figure/i.test(tr) || /^\[image/i.test(tr) },
  { test: (tr) => /^\[an angle/i.test(tr) || /^\[a shape/i.test(tr) },

  // "Let me try", "I need to", etc.
  { test: (tr) => /^TRY\s+/i.test(tr) || /^USE\s+\*\*/i.test(tr) },
  { test: (tr) => /^NEW DATA SET/i.test(tr) || /^CHECKING CONSISTENCY/i.test(tr) },
  { test: (tr) => /^LET ME TRY/i.test(tr) || /^LET'S TRY/i.test(tr) },
  { test: (tr, t) => /^WAIT\s*[—\-–]/i.test(tr) || t.startsWith('WAIT ') },
  { test: (tr) => /^I MUST RECHECK/i.test(tr) || /^LET ME RECHECK/i.test(tr) },
  { test: (tr) => /^RECHECK:/i.test(tr) || /^CHECKING:/i.test(tr) },

  // Financial scratch
  { test: (tr) => /^COST\s*=/i.test(tr) || /^INCOME\s*=/i.test(tr) },
  { test: (tr) => /^SINCE\s+R\d/i.test(tr) },

  // Recount tallies
  { test: (tr) => /^I NEED TO/i.test(tr) || /^LET ME VERIFY/i.test(tr) },
  { test: (tr) => /^CURRENT TOTALS?:/i.test(tr) || /^LET ME RECOUNT/i.test(tr) },
  { test: (tr) => /^REDUCE BY/i.test(tr) },
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
// crammed onto a single 500+ char line with running arithmetic).
function isLongScratchpadLine(line) {
  return (
    line.length > 300 &&
    /recount|already counted|cumulative|verify|reconcil/i.test(line) &&
    /\d+\s*\+\s*\d+/.test(line)
  );
}

export function cleanOutput(text) {
  if (!text) return text;

  // Pass 1 — drop commentary lines entirely.
  const kept = text.split('\n').filter((line) => !isCommentaryLine(line));

  // Pass 2 — blank out (not drop, so surrounding structure stays) long scratchpads.
  const scrubbed = kept.map((line) => (isLongScratchpadLine(line) ? '' : line));

  // Pass 3 — collapse consecutive blank lines to a single blank.
  const collapsed = [];
  let blanks = 0;
  for (const line of scrubbed) {
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
