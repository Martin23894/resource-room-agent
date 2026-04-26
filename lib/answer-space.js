// Post-processing safety net: if the AI forgot to put blank answer lines
// after a question, inject them deterministically. Runs after cleanOutput
// and before DOCX rendering, so learners always have somewhere to write.
//
// The rules match the prompt's ANSWER SPACE RULES contract:
//   MCQ (a./b./c./d. options within ~10 lines) → "Answer: ___" after last option
//   True/False (T/F cue on the question line)  → no injection
//   Fill-in-the-blank (underscores mid-line)   → no injection
//   Pipe table follows                         → no injection
//   Calculation (Working:/Answer: present)     → no injection
//   Already has underscore answer lines        → no injection
//   Question has labelled (a)(b)(c) sub-parts  → no injection on the parent
//   Otherwise                                  → N blank lines scaled to marks

import { i18n } from './i18n.js';

const BLANK = '_______________________________________________';

const HAS_MCQ_OPTION = /^\s*[a-dA-D][.)]\s/;
const HAS_UNDERSCORES = /^\s*_{5,}\s*$/m;
const HAS_WORKING_ANSWER = /^\s*(Working|Werking|Answer|Antwoord)\s*:/im;
const HAS_TABLE_ROW = /^\s*\|.*\|/m;
// Fill-in-the-blank: the question line itself has long underscores in the middle.
const HAS_INLINE_BLANK = /_{3,}/;
// Labelled sub-parts: a line beginning with (a) (b) (c) etc. Anchored at start
// (after optional indent) so it doesn't match an inline "(a) for example" inside
// a question stem. The History T2 sample produced parents like
//   "5.1 Name TWO ways… (2)\n\n(a) ____\n\n(b) ____"
// where the parent's "Name TWO" pattern would otherwise inject 2 plain blank
// lines on top of the (a)(b) lines, doubling the answer space.
const HAS_SUBPART_LABEL = /^\s*\([a-d]\)\s/m;

// A sub-question line looks like "1.1 …", "1.2.1 …", "7.1a …" etc.
// We only inject after sub-questions, not after "Question 1:" headings
// (those don't end with (N) anyway).
const SUBQ_WITH_MARKS = /^\s*\d+\.\d[\w.]*\s+.*\((\d+)\)\s*$/;

// True/False indicator — if the question line contains the phrase,
// we assume the learner writes T/F on the same line, no injected blank.
// Covers "True/False", "True or False", "T/F", plus Afrikaans variants.
const IS_TRUE_FALSE = /\btrue\s*(?:\/|or)\s*false\b|\bT\s*\/\s*F\b|\bwaar\s*(?:\/|of)\s*onwaar\b/i;

function blanksForMarks(marks, questionText) {
  if (marks >= 5) return 4;
  if (marks >= 3) return 2;
  if (marks >= 1) {
    // "List N …" / "Name N …" etc. → one line per expected item.
    // English + Afrikaans verbs covered for the list-size cue.
    const listMatch = /\b(list|name|give|write down|state|noem|gee|skryf neer)\b.*?\b(two|three|four|five|six|seven|eight|nine|ten|twee|drie|vier|vyf|ses|sewe|agt|nege|tien|\d+)\b/i.exec(questionText);
    if (listMatch) {
      const word = listMatch[2].toLowerCase();
      const WORD_TO_NUM = {
        two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
        twee: 2, drie: 3, vier: 4, vyf: 5, ses: 6, sewe: 7, agt: 8, nege: 9, tien: 10,
      };
      const n = WORD_TO_NUM[word] ?? parseInt(word, 10);
      if (Number.isFinite(n) && n >= 2 && n <= 12) return n;
    }
    return 2;
  }
  return 1;
}

// Answer/Antwoord stub pattern — matches an injected or model-generated
// "Answer: ___" line so we can detect options that slipped past it.
const IS_ANSWER_STUB = /^\s*(Answer|Antwoord)\s*:\s*_{3,}/i;

/**
 * If Claude generated MCQ options AFTER the "Answer: ___" line (typically
 * the last option in a sequencing/ordering question), move them to before
 * the answer line so the question reads correctly.
 */
function reorderMisplacedOptions(lines) {
  const skip = new Set();
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i)) continue;
    if (!IS_ANSWER_STUB.test(lines[i])) { out.push(lines[i]); continue; }

    // Look ahead up to 6 lines for any MCQ options that belong before this stub.
    const displaced = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 7); j++) {
      if (HAS_MCQ_OPTION.test(lines[j])) {
        displaced.push(lines[j]);
        skip.add(j);
      }
    }
    out.push(...displaced);   // options first
    out.push(lines[i]);       // then the answer stub
  }
  return out;
}

/**
 * Inject answer space where missing.
 *
 * @param {string} text   Question paper text (post-cleanOutput).
 * @param {object} [opts]
 * @param {string} [opts.language]  "English" / "Afrikaans" — drives the
 *                                  localisation of "Answer:" in the MCQ
 *                                  answer-line stub. Falls back to English.
 */
export function ensureAnswerSpace(text, opts = {}) {
  if (!text) return text;
  const L = i18n(opts.language);
  const mcqAnswerStub = (L?.answerLabel || 'Answer') + ': ' + BLANK;

  // Fix any options that appear after their own answer stub before we scan.
  const lines = reorderMisplacedOptions(text.split('\n'));

  // Map from line index → extra lines to append AFTER that line.
  const injections = new Map();
  const push = (idx, extra) => {
    const prev = injections.get(idx) || [];
    injections.set(idx, prev.concat(extra));
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = SUBQ_WITH_MARKS.exec(line);
    if (!m) continue;

    // Look ahead up to 10 lines or until the next sub-question.
    const lookaheadEnd = Math.min(lines.length, i + 11);
    let stopIdx = lookaheadEnd;
    for (let j = i + 1; j < lookaheadEnd; j++) {
      if (SUBQ_WITH_MARKS.test(lines[j])) { stopIdx = j; break; }
    }
    const aheadLines = lines.slice(i + 1, stopIdx);
    const ahead = aheadLines.join('\n');

    // Skip if any form of answer space already exists.
    if (
      HAS_UNDERSCORES.test(ahead) ||
      HAS_WORKING_ANSWER.test(ahead) ||
      HAS_TABLE_ROW.test(ahead) ||
      HAS_INLINE_BLANK.test(line) ||
      IS_TRUE_FALSE.test(line) ||
      HAS_SUBPART_LABEL.test(ahead)        // ← the new rule: (a)(b)(c) carry their own answer lines
    ) {
      continue;
    }

    // MCQ: inject one "Answer: ___" line after the last option.
    if (HAS_MCQ_OPTION.test(ahead)) {
      let lastOptionIdx = -1;
      for (let j = i + 1; j < stopIdx; j++) {
        if (HAS_MCQ_OPTION.test(lines[j])) lastOptionIdx = j;
      }
      if (lastOptionIdx > 0) push(lastOptionIdx, [mcqAnswerStub]);
      continue;
    }

    // Non-MCQ: N blank lines scaled to marks.
    const marks = parseInt(m[1], 10);
    const n = blanksForMarks(marks, line);
    push(i, new Array(n).fill(BLANK));
  }

  const out = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    if (injections.has(i)) out.push(...injections.get(i));
  }
  return out.join('\n');
}
