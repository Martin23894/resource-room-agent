// Post-processing safety net: if the AI forgot to put blank answer lines
// after a question, inject them deterministically. Runs after cleanOutput
// and before DOCX rendering, so learners always have somewhere to write.
//
// The rules match the prompt's ANSWER SPACE RULES contract:
//   MCQ (a./b./c./d. options within ~8 lines)        → no injection
//   True/False (look for T/F cue words in 2 lines)   → no injection
//   Fill-in-the-blank (sentence already has _____)   → no injection
//   Pipe table follows                                → no injection
//   Calculation (Working:/Answer: already present)   → no injection
//   Already has underscore answer lines              → no injection
//   Otherwise                                         → inject N blank lines
//     where N is scaled from the (M) mark count on the question line.

const BLANK = '_______________________________________________';

// Lines that count as "answer space already provided" when looking ahead.
const HAS_MCQ_OPTIONS = /^\s*[a-dA-D][.\)]\s/m;
const HAS_UNDERSCORES = /^\s*_{5,}\s*$/m;
const HAS_WORKING_ANSWER = /^\s*(Working|Werking|Answer|Antwoord)\s*:/im;
const HAS_TABLE_ROW = /^\s*\|.*\|/m;
// Fill-in-the-blank: the question line itself has long underscores in the middle.
const HAS_INLINE_BLANK = /_{3,}/;

// A sub-question line looks like "1.1 …", "1.2.1 …", "7.1a …" etc.
// We only inject after sub-questions, not after the "Question 1:" headings
// (those don't end with (N) anyway).
const SUBQ_WITH_MARKS = /^\s*\d+\.\d[\w.]*\s+.*\((\d+)\)\s*$/;

// True/False indicator — if the question line itself contains the phrase,
// we assume the learner writes T/F on the same line, no injected blank.
// Covers "True/False", "True or False", "T/F", plus Afrikaans "Waar/Onwaar"
// and "Waar of Onwaar".
const IS_TRUE_FALSE = /\btrue\s*(?:\/|or)\s*false\b|\bT\s*\/\s*F\b|\bwaar\s*(?:\/|of)\s*onwaar\b/i;

function blanksForMarks(marks, questionText) {
  // Match the prompt's ANSWER SPACE RULES contract.
  if (marks >= 5) return 4;
  if (marks >= 3) return 2;
  if (marks >= 1) {
    // "List N …" / "Name N …" / "Give N …" → one line per expected item.
    const listMatch = /\b(list|name|give|write down|state)\b.*?\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i.exec(questionText);
    if (listMatch) {
      const word = listMatch[2].toLowerCase();
      const WORD_TO_NUM = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
      const n = WORD_TO_NUM[word] ?? parseInt(word, 10);
      if (Number.isFinite(n) && n >= 2 && n <= 12) return n;
    }
    return 2;
  }
  return 1;
}

export function ensureAnswerSpace(text) {
  if (!text) return text;
  const lines = text.split('\n');
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);

    const m = SUBQ_WITH_MARKS.exec(line);
    if (!m) continue;

    // Look ahead up to 10 lines (or until the next sub-question) for existing answer space.
    const lookaheadEnd = Math.min(lines.length, i + 11);
    let stopIdx = lookaheadEnd;
    for (let j = i + 1; j < lookaheadEnd; j++) {
      if (SUBQ_WITH_MARKS.test(lines[j])) { stopIdx = j; break; }
    }
    const ahead = lines.slice(i + 1, stopIdx).join('\n');

    if (
      HAS_MCQ_OPTIONS.test(ahead) ||
      HAS_UNDERSCORES.test(ahead) ||
      HAS_WORKING_ANSWER.test(ahead) ||
      HAS_TABLE_ROW.test(ahead) ||
      HAS_INLINE_BLANK.test(line) ||
      IS_TRUE_FALSE.test(line)
    ) {
      continue;
    }

    const marks = parseInt(m[1], 10);
    const n = blanksForMarks(marks, line);
    for (let k = 0; k < n; k++) out.push(BLANK);
  }

  return out.join('\n');
}
