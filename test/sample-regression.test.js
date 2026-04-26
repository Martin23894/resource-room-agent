// Regression test corpus from the five-resource audit cycle.
//
// Each test is named after the audit Resource and Bug number. The goal
// is structural — given a known-bad input shape, assert that the relevant
// helper produces the corrected output. This makes it impossible for a
// future prompt-tweak or refactor to silently re-introduce a fixed bug.
//
// Audit findings live in the conversation history; this file is the
// programmatic memory.
//
// When fixing a new bug, add a test here. Naming convention:
//   describe('Resource N — Bug M: short description', () => { ... })

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildCogAnalysisTable, parseMemoAnswerRows, correctCogAnalysisTable } from '../lib/cog-table.js';
import { ensureSectionCloser, ensureSequentialSectionLetters } from '../lib/sections.js';
import { stripLeadingMemoBanner, cleanOutput, localiseLabels } from '../lib/clean-output.js';
import { hasAnswerTable, hasCogAnalysis, validateMemoStructure } from '../lib/memo-structure.js';
import { countMarks } from '../lib/marks.js';

// ─── Resource 1 (Grade 4 English HL Term 2, RTT) ──────────────────────

describe('Resource 1 — RTT memo regressions', () => {
  test('Bug 4: Section B body must not close with SECTION C TOTAL', () => {
    // The audit shipped a Section B distribution table that ended with
    // "SECTION C TOTAL: 5 marks" because the B+C phase collapsed Section
    // B's pattern into Section C's. ensureSectionCloser strips foreign
    // closers and emits the correct one.
    const sectionBBody = [
      '| 2.1 | answer | guidance | Literal | 1 |',
      '| 2.2 | answer | guidance | Literal | 1 |',
      '| 2.3 | answer | guidance | Inferential | 2 |',
      '',
      '| Cognitive Level | Questions | Marks |',
      '| Reorganisation | Content Points 1, 2, 3, 4, 5 | 5 |',
      '',
      'SECTION C TOTAL: 5 marks',
    ].join('\n');
    const r = ensureSectionCloser(sectionBBody, 'SECTION B', 'TOTAL', 10, 'marks');
    assert.doesNotMatch(r.text, /SECTION C TOTAL/i, 'Section B body must never end with a SECTION C TOTAL line');
    assert.match(r.text, /SECTION B TOTAL: 10 marks\s*$/);
  });

  test('Bug 8 / 20: combined Barrett\'s totals are computed not invented', () => {
    // The audit shipped a "100%/50/100%" combined Barrett's row even
    // when actual marks summed to 45. The emitter computes from the
    // answer rows so the TOTAL row reflects reality.
    const answerRows = [
      { number: '1.1', level: 'Literal', mark: 5 },
      { number: '2.1', level: 'Inferential', mark: 10 },
      // intentionally short of the 50-mark cover total
    ];
    const out = buildCogAnalysisTable({
      answerRows,
      cog: {
        levels: ['Literal', 'Reorganisation', 'Inferential', 'Evaluation and Appreciation'],
        pcts: [20, 20, 40, 20],
      },
      totalMarks: 50,
      language: 'English',
      isBarretts: true,
    });
    // The TOTAL row's Actual cell shows 15, not 50, and Actual % is 30.0% not 100%.
    assert.match(out.table, /\| TOTAL \| 100% \| 50 \| 15 \| 30\.0% \|/);
  });

  test('Bug 9: three MEMORANDUM banners collapse to one', () => {
    const memo = [
      'MEMORANDUM',
      '',
      'Grade 4 English HL — Response to Text — Term 2',
      'CAPS Aligned | Barrett\'s Taxonomy Framework',
      '',
      'MEMORANDUM',
      '',
      'Grade 4 English HL | RTT',
      'SIPHO\'S BIG DECISION',
      '',
      'MEMORANDUM',
      '',
      '| 1.1 | answer | guidance | Literal | 1 |',
    ].join('\n');
    const stripped = stripLeadingMemoBanner(memo);
    const banners = (stripped.match(/^\s*MEMORANDUM\s*$/gm) || []).length;
    assert.equal(banners, 0, 'all leading MEMORANDUM banners are stripped before assembly');
  });
});

// ─── Resource 2 (Grade 5 Afrikaans EAT Term 4, RTT) ───────────────────

describe('Resource 2 — Afrikaans RTT memo regressions', () => {
  test('Bug 13: standalone "Answer:" label is replaced with "Antwoord:" on Afrikaans papers', () => {
    const paper = [
      '1.4 Plaas die volgende gebeure in volgorde. (2)',
      'A. Een',
      'B. Twee',
      'C. Drie',
      'D. Vier',
      'Answer: _______________________________________________',
    ].join('\n');
    const out = localiseLabels(paper, 'Afrikaans');
    assert.doesNotMatch(out, /^Answer:/m);
    assert.match(out, /^Antwoord:/m);
  });

  test('Bug 16: Afrikaans Section B body must not close with AFDELING C TOTAAL', () => {
    const sectionBBody = [
      '| 2.1 | antwoord | nasienriglyn | Letterlik | 1 |',
      '',
      '| Cognitive Level | Questions | Marks |',
      '| Reorganisation | Inhoudspunt 1, 2, 3, 4, 5 | 5 |',
      '',
      'AFDELING C TOTAAL: 5 punte',
    ].join('\n');
    const r = ensureSectionCloser(sectionBBody, 'AFDELING B', 'TOTAAL', 10, 'punte');
    assert.doesNotMatch(r.text, /AFDELING C TOTAAL/i);
    assert.match(r.text, /AFDELING B TOTAAL: 10 punte\s*$/);
  });

  test('Bug 23: cog table reconciles a memo with mixed English / Afrikaans level labels', () => {
    // The audit found Section A used English level names and Section D
    // used Afrikaans. The deterministic emitter treats both as the same
    // canonical level so the per-level tally is correct.
    const answerRows = [
      { number: '1.1', level: 'Literal', mark: 5 },        // English label
      { number: '4.1', level: 'Letterlik', mark: 3 },      // Afrikaans label
      { number: '4.2', level: 'Inferensieel', mark: 2 },   // Afrikaans label
    ];
    const out = buildCogAnalysisTable({
      answerRows,
      cog: {
        levels: ['Literal', 'Reorganisation', 'Inferential', 'Evaluation and Appreciation'],
        pcts: [20, 20, 40, 20],
      },
      totalMarks: 10,
      language: 'Afrikaans',
      isBarretts: true,
    });
    assert.equal(out.actualByLevel['Literal'], 8, 'Literal/Letterlik rows merge into one canonical bucket');
    assert.equal(out.actualByLevel['Inferential'], 2);
  });
});

// ─── Resource 3 (Grade 6 Afrikaans Geografie Term 4, standard) ────────

describe('Resource 3 — Afrikaans standard pipeline regressions', () => {
  test('Bug 31: every standalone "Answer:" line is localised, not just inline ones', () => {
    // The audit found 12 separate MCQs each ending with a standalone
    // "Answer: _____" line. The fix matches line-initial Answer: so all
    // 12 instances are caught in one pass.
    const paper = Array.from({ length: 12 }, (_, i) =>
      `1.${i + 1} Question text (1)\na. opt\nb. opt\nc. opt\nd. opt\nAnswer: _______________________________________________`
    ).join('\n\n');
    const out = localiseLabels(paper, 'Afrikaans');
    const englishLabels = (out.match(/^Answer:/gm) || []).length;
    const afrikaansLabels = (out.match(/^Antwoord:/gm) || []).length;
    assert.equal(englishLabels, 0, 'no English Answer: labels remain');
    assert.equal(afrikaansLabels, 12, 'all 12 labels were localised');
  });

  test('Bug 28: Prescribed Marks always sums to the cover total, not to a different number', () => {
    // Resource 3 cover = 20 but Prescribed column showed 12, 20, 8 (sum 40).
    // The emitter recomputes from largestRemainder so the column always
    // sums to totalMarks.
    const out = buildCogAnalysisTable({
      answerRows: [],
      cog: { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30, 50, 20] },
      totalMarks: 20,
      language: 'Afrikaans',
    });
    let prescribedSum = 0;
    for (const line of out.table.split('\n')) {
      if (!line.startsWith('|') || /TOTAL|TOTAAL|---/i.test(line)) continue;
      const cells = line.split('|').map((s) => s.trim()).filter(Boolean);
      if (cells.length === 5) prescribedSum += parseInt(cells[2], 10) || 0;
    }
    assert.equal(prescribedSum, 20);
  });

  test('Bug 32: Afrikaans memo uses Lae Orde / Middel Orde / Hoë Orde, not English', () => {
    const out = buildCogAnalysisTable({
      answerRows: [{ number: '1.1', level: 'Lae Orde', mark: 10 }],
      cog: { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30, 50, 20] },
      totalMarks: 10,
      language: 'Afrikaans',
    });
    assert.match(out.table, /\| Lae Orde \|/, 'level labels appear in Afrikaans');
    assert.doesNotMatch(out.table, /\| Low Order \|/);
    assert.match(out.table, /\| Kognitiewe Vlak \|/, 'column header in Afrikaans');
  });
});

// ─── Resource 4 (Grade 7 Maths Investigation Term 2, standard) ────────

describe('Resource 4 — mark-sum and cog regressions', () => {
  test('Bug 38: Prescribed Marks does not lie when the cog framework changes', () => {
    // For a 66-mark Maths paper at 25/45/20/10, prescribed must sum to 66.
    const out = buildCogAnalysisTable({
      answerRows: [],
      cog: {
        levels: ['Knowledge', 'Routine Procedures', 'Complex Procedures', 'Problem Solving'],
        pcts: [25, 45, 20, 10],
      },
      totalMarks: 66,
      language: 'English',
    });
    assert.match(out.table, /\| TOTAL \| 100% \| 66 \|/, 'TOTAL row prescribed = 66');
  });

  test('Bug 39: Actual % column never fakes 100% when actual < cover', () => {
    // Cover = 66 but answer rows sum to 51 (Resource 4 case).
    const answerRows = [
      { number: '1.1', level: 'Knowledge', mark: 13 },
      { number: '2.1', level: 'Routine Procedures', mark: 22 },
      { number: '3.1', level: 'Complex Procedures', mark: 10 },
      { number: '4.1', level: 'Problem Solving', mark: 6 },
    ];
    const out = buildCogAnalysisTable({
      answerRows,
      cog: {
        levels: ['Knowledge', 'Routine Procedures', 'Complex Procedures', 'Problem Solving'],
        pcts: [25, 45, 20, 10],
      },
      totalMarks: 66,
      language: 'English',
    });
    assert.match(out.table, /\| TOTAL \| 100% \| 66 \| 51 \| 77\.3% \|/);
  });

  test('Bug 40: cog breakdown counts only the rows actually in the answer table', () => {
    // The audit found Q4.4 (truncated, 2 marks) being counted in the
    // Middle Order breakdown despite the question being incomplete on
    // the paper. With the deterministic emitter, breakdown items come
    // ONLY from parseMemoAnswerRows — which means the answer table is
    // the single source of truth.
    const answerRows = [
      { number: '4.1', level: 'Middle Order', mark: 1 },
      { number: '4.2', level: 'Middle Order', mark: 1 },
      // 4.4 is NOT in the answer rows — it cannot leak into the breakdown
    ];
    const out = buildCogAnalysisTable({
      answerRows,
      cog: { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30, 50, 20] },
      totalMarks: 20,
      language: 'English',
    });
    assert.doesNotMatch(out.breakdown, /Q4\.4/);
    assert.match(out.breakdown, /Middle Order \(2 marks\): Q4\.1 \(1\) \+ Q4\.2 \(1\) = 2 marks/);
  });
});

// ─── Resource 5 (Grade 7 EMS Final Exam Term 4, standard) ─────────────

describe('Resource 5 — Final Exam regressions', () => {
  test('Bug 47: cog breakdown header always equals listed-items sum', () => {
    // The audit shipped "Middle Order (59 marks): … = 51 marks" — the
    // header was 59 but the trailing total was 51 because Claude wrote
    // the header guess from the percentage and the items by listing
    // questions. Code emits both from one source so they cannot diverge.
    const answerRows = [
      { number: '7.1', level: 'Middle Order', mark: 2 },
      { number: '7.2', level: 'Middle Order', mark: 2 },
      { number: '8.1', level: 'Middle Order', mark: 2 },
      { number: '9.1', level: 'Middle Order', mark: 4 },
    ];
    const out = buildCogAnalysisTable({
      answerRows,
      cog: { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30, 50, 20] },
      totalMarks: 50,
      language: 'English',
    });
    const line = out.breakdown.split('\n\n').find((l) => /Middle Order/.test(l));
    const headerN = line.match(/Middle Order \((\d+) marks\)/)[1];
    const trailN = line.match(/= (\d+) marks/)[1];
    assert.equal(headerN, '10');
    assert.equal(headerN, trailN, 'header total equals trailing total — both computed from items');
  });

  test('Bug 48: cog table Actual Marks always equals breakdown items sum', () => {
    // Resource 5 had cog table Mid = 47 but breakdown items summed to 51.
    // Both numbers come from the same parseMemoAnswerRows tally.
    const answerRows = [
      { number: '7.1', level: 'Middle Order', mark: 5 },
      { number: '7.2', level: 'Middle Order', mark: 6 },
    ];
    const out = buildCogAnalysisTable({
      answerRows,
      cog: { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30, 50, 20] },
      totalMarks: 30,
      language: 'English',
    });
    assert.match(out.table, /\| Middle Order \|.*\| 11 \|/);
    assert.match(out.breakdown, /Middle Order \(11 marks\): Q7\.1 \(5\) \+ Q7\.2 \(6\) = 11 marks/);
  });

  test('Bug 49: Actual % never claims 100% when the body is short of the cover', () => {
    // Resource 5: cover 103, body 100/101 depending on counting method.
    // The TOTAL row's Actual % must reflect the genuine body/cover ratio.
    const answerRows = Array.from({ length: 100 }, (_, i) => ({
      number: `${i + 1}.1`, level: 'Low Order', mark: 1,
    }));
    const out = buildCogAnalysisTable({
      answerRows,
      cog: { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30, 50, 20] },
      totalMarks: 103,
      language: 'English',
    });
    // 100/103 = 97.1% — the TOTAL row must show that, not a fabricated 100%.
    assert.match(out.table, /\| TOTAL \| 100% \| 103 \| 100 \| 97\.1% \|/);
  });
});

// ─── Resource 5 follow-up — five-resource audit (Sonnet review pass) ──

describe('Resource 5 follow-up — Sonnet review pass fixes', () => {
  test('Bug A: validateMemoStructure exposes answerRowCount so retry guard can act on it', () => {
    // F7: previously a header-only memo passed retryRttSection's check
    // because answerTable === true, even with zero rows below.
    const headerOnly = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
    ].join('\n');
    const r = validateMemoStructure(headerOnly);
    assert.equal(r.answerTable, true);
    assert.equal(r.answerRowCount, 0,
      'header-only memo must report 0 body rows so the retry guard fires');
  });

  test('Bug B: Section C summary memo with Content Point N labels tallies marks correctly', () => {
    // F2: parseMemoAnswerRows accepts content-point labels — without this,
    // every Section C summary memo's marks vanished from the cog tally.
    const memo = [
      '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| Content Point 1 | Sipho went to market | first idea | Reorganisation | 1 |',
      '| Content Point 2 | He bought maize | second idea | Reorganisation | 1 |',
      '| Content Point 3 | Anri arrived next | third idea | Reorganisation | 1 |',
      '| Content Point 4 | Trade happened | fourth idea | Reorganisation | 1 |',
      '| Content Point 5 | Outcome | fifth idea | Reorganisation | 1 |',
    ].join('\n');
    const out = buildCogAnalysisTable({
      answerRows: parseMemoAnswerRows(memo),
      cog: { levels: ['Literal', 'Reorganisation', 'Inferential', 'Evaluation and Appreciation'], pcts: [20, 20, 40, 20] },
      totalMarks: 5,
      language: 'English',
      isBarretts: true,
    });
    assert.equal(out.actualByLevel.Reorganisation, 5,
      'all five content points must tally as Reorganisation marks');
  });

  test('Bug C: Afrikaans "Reorganisasie" rows tally as Reorganisation', () => {
    // F3: alias map accepts the anglicised Afrikaans spelling Claude
    // sometimes emits; without it the rows were silently dropped.
    const out = buildCogAnalysisTable({
      answerRows: [{ number: '1.1', level: 'Reorganisasie', mark: 5 }],
      cog: { levels: ['Literal', 'Reorganisation', 'Inferential', 'Evaluation and Appreciation'], pcts: [20, 20, 40, 20] },
      totalMarks: 25,
      language: 'Afrikaans',
      isBarretts: true,
    });
    assert.equal(out.actualByLevel.Reorganisation, 5);
  });

  test('Bug D: Afrikaans memo with markdown-bold "Answer:" labels gets localised', () => {
    // F5+F6: localiseLabels covers markdown-bold form AND is applied to
    // the memo (not only the question paper).
    const memoCell = '**Answer:** R835';
    assert.match(localiseLabels(memoCell, 'Afrikaans'), /\*\*Antwoord:\*\* R835/);
    assert.match(localiseLabels(memoCell, 'afrikaans'), /\*\*Antwoord:\*\*/,
      'lowercase language tag works too (case-insensitive match)');
  });

  test('Bug E: TOTAL row Actual % is honest when actual marks differ from cover', () => {
    // F4: correctCogAnalysisTable no longer hardcodes the TOTAL row's
    // Actual % to 100% when there is mark drift.
    const memo = [
      '| NO. | ANSWER | GUIDANCE | LEVEL | MARK |',
      '|---|---|---|---|---|',
      '| 1.1 | a | b | Low Order | 30 |',
      '',
      '| Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual % |',
      '|---|---|---|---|---|',
      '| Low Order | 30% | 38 | 30 | 100% |',
      '| Middle Order | 50% | 63 | 0 | 0% |',
      '| High Order | 20% | 25 | 0 | 0% |',
      '| TOTAL | 100% | 126 | 30 | 100% |',
    ].join('\n');
    // Import-on-demand so this block doesn't depend on file order.
    // (parseMemoAnswerRows / correctCogAnalysisTable already imported above.)
    // 30 / 126 = 23.8% — that's what the TOTAL row should show, NOT 100%.
    const r = correctCogAnalysisTable(memo, { totalMarks: 126 });
    assert.match(r.text, /\| TOTAL \| 100% \| 126 \| 30 \| 23\.8% \|/);
  });

  test('R5 hierarchical mark count: countMarks returns the true sub-question total', () => {
    // F1: parent (X) is skipped when it has lettered children with their
    // own (X). The R5 Q12+Q13 shape used to be inflated by 14+ marks.
    const r5SectionC = [
      'Question 12',
      '',
      '12.1 (a) Identify three. (3)',
      '(b) Explain advantage. (3)',
      '',
      '12.2 Old trading system. (4)',
      '(a) Name. (1)',
      '(b) Two reasons. (3)',
      '',
      '12.3 EFT details. (4)',
      '(a) What is EFT? (1)',
      '(b) Calc R850-R15. (1)',
      '(c) Reason. (2)',
      '',
      '12.4 Evaluate. (3)',
      '',
      '[10]',
    ].join('\n');
    // Q12.1: 3+3=6 (no parent total), Q12.2: 4 (parent skipped, 1+3=4),
    // Q12.3: 4 (parent skipped, 1+1+2=4), Q12.4: 3. Total: 6+4+4+3=17.
    assert.equal(countMarks(r5SectionC), 17);
  });
});

// ─── Cross-cutting structural invariants ─────────────────────────────

describe('Cross-cutting: structural invariants every memo must satisfy', () => {
  test('Cog table always emits N+1 rows: one per level + TOTAL', () => {
    const out = buildCogAnalysisTable({
      answerRows: [],
      cog: { levels: ['A', 'B', 'C', 'D'], pcts: [25, 25, 25, 25] },
      totalMarks: 40,
    });
    const dataLines = out.table.split('\n').filter((l) => l.startsWith('|') && !/---/.test(l));
    assert.equal(dataLines.length, 6, '4 levels + header + TOTAL');
  });

  test('Cog table TOTAL row always reflects sum of Actual Marks (not invented)', () => {
    const answerRows = [
      { number: '1.1', level: 'A', mark: 5 },
      { number: '1.2', level: 'B', mark: 7 },
      { number: '1.3', level: 'C', mark: 3 },
    ];
    const out = buildCogAnalysisTable({
      answerRows,
      cog: { levels: ['A', 'B', 'C', 'D'], pcts: [25, 25, 25, 25] },
      totalMarks: 50,
    });
    // Actual sums to 15, cover is 50. TOTAL row shows 15 (not 50), Actual % = 30.0%.
    assert.match(out.table, /\| TOTAL \| 100% \| 50 \| 15 \| 30\.0% \|/);
  });

  test('countMarks treats TRUE/FALSE-style "(1)" lines correctly', () => {
    // Sanity check on the PER_ITEM regex used for mark-sum drift detection.
    const paper = [
      '2.1 −15 > −9 _____________ (1)',
      '2.2 The sum of −8 and +13 is +5. _____________ (1)',
      '3.1 Calculate 2 + 2. (2)',
    ].join('\n');
    assert.equal(countMarks(paper), 4);
  });
});
