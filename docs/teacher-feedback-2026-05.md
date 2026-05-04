# Teacher Feedback — Grade 6 Live Test Cycle (2026-05-04)

**Source:** Hand-annotated assessments by a primary school teacher (10 years' experience, Cape Town, ZA). Mediated through Martin.

**Documents reviewed:** English HL Gr6 T1 (9pp), English HL Gr6 T2 (9pp), English FAL Gr6 T2 (10pp), Mathematics Gr6 T2 (8pp), Life Skills/Creative Arts Gr6 T2 (7pp).

**Why this doc lives here:** This is the source-of-truth ground-truth from a real CAPS teacher reviewing real outputs of the pipeline. The AI moderator (`lib/moderator.js`) had passed several of these papers as 5/5 PASS — including the Creative Arts paper which is structurally wrong at the conceptual level. This document supersedes the moderator's rubric where they conflict. Any change to `api/generate.js`, the prompts, the rebalancer, or the renderer should be checked against the scorecard in section 4 before shipping.

**Next iterations should:**
- Use sections 2-3 to update the system prompt + invariants
- Use section 4 to score every test output before merging
- Use section 6 to find the right point in the 4-phase pipeline for each rule
- Cross-reference handwritten remarks (section 5) when in doubt about intent

---

## 1. EXECUTIVE SUMMARY — WHERE THE GENERATOR FAILS RIGHT NOW

The mediated feedback shows five recurring failure classes across the five papers:

1. **MARK ALLOCATION DRIFT** — section marks don't match CAPS-prescribed totals (English fails this in 4 sections of one paper alone).
2. **MARKDOWN LEAKING INTO OUTPUT** — `**word**` renders as literal asterisks instead of underlined text; tables and rubrics render as black bars instead of grids.
3. **MULTI-PART QUESTION LAYOUT** — `(a)... (b)... (c)... (d)...` runs together inline instead of stacking vertically with answer spaces.
4. **MISSING VISUAL ASSETS** — poster headings, figure captions, and image references appear, but the actual image is absent and no source citation is given.
5. **CURRICULUM-SCOPE VIOLATIONS** — questions test content outside the term's ATP (e.g. money in Maths T2), use cognitive levels above Grade 6 (e.g. Type 2 conditionals), or place questions in the wrong section (e.g. tone analysis under "Language Structures").

A sixth, subject-specific catastrophic failure: **CREATIVE ARTS IS BEING GENERATED AS A QUESTION PAPER** when it should be a creative brief / performance instruction.

---

## 2. UNIVERSAL GENERATION RULES

These belong in the system prompt of Phase 2 (question paper writing) and Phase 3 (memo + rubric).

### 2.1 Rendering & Layout

- Never use markdown for emphasis in question text. Specifically: do not output `**word**` to indicate underlined or bold text. The downstream renderer treats the asterisks literally. If a noun, verb, or word must be underlined for the question to make sense (e.g. "Identify the underlined noun"), use real underline formatting in the `.docx` output, not asterisks.
- Multi-part questions render as a vertical list with an answer space per part. When a question has parts (a), (b), (c), (d), each part gets its own line and its own ruled answer space. Never run them inline like `(a) The cat... (b) The dog... (c) The bird...`. Correct form:

  ```
  4.2 Rewrite the following sentences in past tense.

  (a) Kemi reads her essay to the audience.
      ____________________________________________

  (b) The learners collect old newspapers every week.
      ____________________________________________

  (c) Mr Osei claps loudly after the speech.
      ____________________________________________
  ```

- Tables must render as actual tables, not ASCII art. Input-output tables, comparison tables, equivalent-forms tables, column-A/column-B match-up tables — all must be real `.docx` tables with cell borders. Never output pipe syntax in question paper text.
- Rubric tables and cognitive-analysis tables must render fully. The recurring "black bar where a table should be" bug means a table is being inserted as an empty/placeholder block. Verify every table has populated rows before output.

### 2.2 Visual Assets (posters, figures, advertisements, mandalas, etc.)

- If a section requires a visual text (poster, advertisement, image, figure), one of two things must be true:
  1. The actual visual is generated/embedded in the paper, OR
  2. A clear source citation is included beneath the heading so the teacher can locate the asset (e.g. "Source: WWF SA, 'Beat Plastic Pollution' campaign poster, 2023, available at [URL]").
- Never reference a figure that doesn't exist. A heading like "Figure 1: A Relief Mandala" with no image below it is a paper-breaking failure — the learner cannot answer the section.
- Memo answers that depend on an unseen visual must not be generated. If Phase 2 cannot embed the visual or cite a source, Phase 3A must not produce answers that reference unstated visual content (e.g. "The Green Oceans Foundation" as the answer to "What is the name of the organisation on the poster?").

### 2.3 Mark Allocation Discipline

- Section marks must match the prescribed CAPS structure for the subject + grade + term + assessment type. The current generator produces section marks like 24, 19, 11, 17 — none of which align with the prescribed totals. See subject blocks (Section 3) for exact required allocations.
- The total on the cover page must equal the sum of section totals AND match the printed "TOTAL: X marks" at the end of the paper. Sum of part-marks within each section must equal the section's stated total.
- Question paper section count and naming convention must follow CAPS exactly. No duplicated section headers (the recurring "SECTION A: SECTION A:" bug must be fixed in the template/concatenation logic).

### 2.4 Curriculum Scope (ATP-aligned)

- Phase 1 (plan generation) must consult the ATP for the specific Grade + Subject + Term and exclude any topic not yet taught by that term's end. A Grade 6 Term 2 paper cannot test money calculations if money appears only in Term 3.
- Cognitive demand must be Grade-appropriate. Specific upper-bound examples:
  - Grade 6 English HL/FAL: do not test Type 1 / Type 2 / Type 3 conditional sentence types. Conditional sentence construction at simple `if + present, will + base verb` level only.
  - Grade 6 anything: question instructions must use Grade-6-appropriate vocabulary. For FAL specifically, lower the register further.
- Questions must belong to the section they're placed in.
  - Tone, attitude, mood, inference questions → Comprehension section, never the Language section.
  - Grammar, syntax, punctuation, parts of speech, tense → Language section only.

### 2.5 Question Quality

- Questions must not contain or give away their answers. Example failure: `Divide the following words into syllables using a hyphen: (a) re-cy-cling (b) com-mu-ni-ty (c) en-vi-ron-ment` — the words are already divided. Phase 2b (quality check) must catch this pattern.
- The mark count printed in a question's instruction must equal the marks awarded. Example failure: `Describe TWO features of EACH dance style (2 features × 2 dances = 3 marks)` — the arithmetic is wrong (2×2=4, not 3).
- Multiple choice sections must include the choices. A section labelled "Multiple Choice" with questions ending in "?" but no `(a) (b) (c) (d)` options is fundamentally broken. Phase 2b must verify every MCQ has at least 3 options and one correct answer present in the options.
- Use full terms, not abbreviations, for Grade 6. Write "Highest Common Factor (HCF)" or just "Highest Common Factor" on first introduction, not bare "HCF". Same for "Lowest Common Multiple", "Greatest Common Divisor", etc.

### 2.6 Cognitive Level Taxonomies (subject-specific)

Different subjects use different taxonomies. The Phase 3B prompt must select the correct one:

| Subject family | Taxonomy | Levels | Percentages |
|---|---|---|---|
| English HL/FAL, Afrikaans HL/FAL | Barrett's | Literal / Reorganisation / Inferential / Evaluation & Appreciation | 20 / 20 / 40 / 20 |
| Mathematics | DoE Maths (labelled "Bloom's" in product) | Knowledge / Routine Procedures / Complex Procedures / Problem Solving | 25 / 45 / 20 / 10 |
| Life Skills — Creative Arts | NO TAXONOMY REQUIRED | (see Section 3.5) | — |

---

## 3. SUBJECT-SPECIFIC OVERRIDES

### 3.1 English Home Language — Grade 6 (T1 + T2)

Prescribed structure (HARD RULE — applies to both Test and Exam formats):

| Section | Title | Marks | Notes |
|---|---|---|---|
| A | Comprehension | 20 | Reading passage + literal/inferential/evaluation Qs. May combine info text + literary extract. |
| B | Summary | 5 | Point-form, max 40 words. NEVER an essay or report. |
| C | Visual Text | 10 | Poster, advert, cartoon, infographic. Visual asset MUST be embedded or cited. |
| D | Language Structures and Conventions | 15 | Grammar, parts of speech, tense, punctuation, syllabification only. |
| **TOTAL** | | **50** | |

Verbatim wife remarks driving these rules:

- T1 cover: "Comprehension - 20 marks / Visual text - 10 marks / Summary - 5 marks / Language - 15 marks / Total 50 marks"
- T2 inline corrections to printed mark allocations: "(24 marks) Must be 20 marks", "(2 marks) Must be 5 marks", "(7 marks) Must be 10 marks", "(17 marks) Must be 15 marks"
- T1 Section D essay: "There must only be a summary question, not an essay question."

Specific HL pitfalls to avoid:

- Do not test Type 1 / Type 2 conditionals at Grade 6. (T2 Q4.4: "Too difficult for grade 6").
- Section D layout for parts-of-speech and pronoun questions: vertical list `a/b/c/d` with answer line per item, not run-on inline text.

### 3.2 English First Additional Language — Grade 6 (T2)

Prescribed structure: SAME AS HL — 20 + 5 + 10 + 15 = 50 marks.

Same mark-allocation rules as 3.1. Wife confirmed inline:

- "(19 marks) 20 marks, not 19" (Section A)
- "(2 marks) Must be 5 marks" (Section B)
- "(11 marks) 10 marks, not 11" (Section C)

FAL-specific overrides on top of HL rules:

- Lower the register of question instructions. Phrasing that's fine for HL ("Write a conditional sentence (using 'if') about ocean pollution. Your sentence must make logical sense.") must be simplified for FAL. Wife wrote: "State question in grade 6 language." For FAL Grade 6, prefer: "Write a sentence using 'if' about ocean pollution. Make sure your sentence makes sense."
- Visual Text section needs question-type variety, not 4 of the same question type. Wife wrote: "Perhaps add a variety of questions and not just 4. Only for this section." Mix: identification, inference about purpose, evaluation of design choices (colour, image placement), inference about target audience.
- For visual text sections, if no image is embedded, state the source so the teacher can find/print it. Wife wrote: "Perhaps state where source can be found to add visual text."
- Section D (Language) questions must actually test language structures. Wife flagged Q6.3 (a tone analysis question) under "Punctuation and Tenses" — "6.3 isn't a language structure question." Tone, mood, attitude, inference belong in Section A (Comprehension), never Section D.

### 3.3 Mathematics — Grade 6 (T2)

Prescribed structure: APPROVED ✓ by wife (5 sections, 50 marks total).

| Section | Title | Marks (sum to 50) |
|---|---|---|
| A | Multiple Choice | ~11 |
| B | Short Answers | ~9 |
| C | Fractions, Decimals and Percentages | ~9 |
| D | Patterns and Number Sentences | ~9 |
| E | Problem Solving and Extended Response | ~12 |

Cognitive ratio (DoE Maths, labelled Bloom's): Knowledge 25% / Routine Procedures 45% / Complex Procedures 20% / Problem Solving 10%.

Maths-specific catastrophic bugs to fix:

- **MULTIPLE CHOICE SECTIONS MUST INCLUDE OPTIONS.** Every MC question needs 4 options labelled `(a) (b) (c) (d)`, with exactly one correct. Wife wrote: "There are no multiple choice options given for 1.1 - 1.7." The current generator outputs MC question stems without options at all. Phase 2b validation must reject any MC question lacking options.
- **SPELL OUT ABBREVIATIONS IN QUESTION TEXT.** Wife wrote "Use full word, not abbreviation" next to HCF and "Use the whole word, not the abbreviation" next to LCM. Write "Highest Common Factor", "Lowest Common Multiple", "Greatest Common Divisor", etc. Acceptable to introduce the abbreviation in parentheses on first mention.
- **TABLES MUST BE REAL TABLES.** Input-output tables (e.g. for Q4.3 input/output rules) must render as a real grid. Wife wrote: "Good question. Format of diagram is wrong." about an input-output table rendered as pipes. Same rule for "Equivalent Forms" tables — wife wrote "What is this?" (table heading present, table absent) and on a follow-up question "5.2 doesn't show a table."
- **ATP-SCOPE CHECK IS NON-NEGOTIABLE.** Wife wrote "Money isn't part of the term 1 or 2 ATPs" on Q5.4 (a profit calculation involving Rand amounts). Cross-check every numerical context against the Grade 6 Maths ATP for the specific term before generating. Money is Grade 6 Term 3.

### 3.4 Mathematics Question Quality Notes (wife approved most content)

- "Questions are good" (general approval of the question content quality in Section A).
- The cognitive-level analysis table at the end is correctly named and structured — keep it.
- Enrichment Challenge / "for learners who finish early" extension activity is good — keep it.

### 3.5 Life Skills — Creative Arts — Grade 6 (T2)

**THIS IS THE MOST FUNDAMENTAL REBUILD REQUIRED.** The current output is wrong at the conceptual level, not just the formatting level.

**HARD RULE 1: VISUAL ART AND PERFORMING ARTS ALTERNATE BY TERM, NEVER COMBINED.**

Wife wrote: "Visual art and performing art should be rotated each term. They should not be done in the same paper. Example: Term 1 → only visual art, Term 2 → only performing arts."

Phase 1 must enforce this alternation. The Term-2 paper combining a Visual Art Section A with a Performing Arts Section B is structurally invalid.

**HARD RULE 2: CREATIVE ARTS ASSESSMENTS ARE NOT QUESTION PAPERS.**

Wife wrote: "It is not a question paper, but instead an instruction of art that needs to be created or a performance that must be prepared."

The output format is a TASK BRIEF with: a stimulus / theme, materials list (for Visual Art) or scenario (for Performing Arts), step-by-step instructions, time allocation, assessment rubric criteria visible to the learner, and an exemplar reference.

A "Section A 1.1 Define the term 'mandala'..." comprehension-style format is fundamentally wrong here.

**HARD RULE 3: TOTAL MARKS = 40, NOT 50 OR 25.**

Wife wrote: "Art is always out of 40 marks."

**HARD RULE 4: NO BLOOM'S / COGNITIVE LEVEL ANALYSIS TABLE.**

Wife wrote: "Bloom's not necessary for this paper." Phase 3B must skip the cognitive-analysis generation step for Creative Arts. Replace it with the practical assessment rubric only.

Output format Phase 2 should produce for Creative Arts (rough scaffold):

```
GRADE 6 — TERM 2 — CREATIVE ARTS — PERFORMING ARTS TASK
Total: 40 marks | Duration: [practical time + performance day]

1. STIMULUS / THEME
   [Brief context — e.g. "School Arts Festival"]

2. THE TASK
   [What the learner must create or perform — concrete brief]

3. WHAT YOU MUST DO (step-by-step)
   3.1 Planning phase ...
   3.2 Rehearsal / construction phase ...
   3.3 Performance / submission ...

4. MATERIALS / RESOURCES NEEDED
   [bullet list]

5. ASSESSMENT RUBRIC (visible to learner)
   [Real rubric table, not black bars — criteria × levels grid]

6. EXTENSION (optional, for early finishers)
```

Other fixes (lower priority but logged):

- Duplicated header bug "SECTION A: SECTION A:" — concatenation issue in template.
- Q2.3 mark-arithmetic error: "(2 features × 2 dances = 3 marks)" — should be 4. Phase 2b must validate stated arithmetic in question instructions.
- Match-Column-A-with-Column-B questions must render as a two-column table, not as inline run-on text.

---

## 4. EVALUATION RUBRIC — LIVE TEST SCORECARD

Use this to grade every live-test output before accepting it. Score each criterion 0 / 1 / 2 (0 = fails, 1 = partial, 2 = passes). Total possible: 30. **A paper scoring under 24 should not ship.**

| # | Criterion | 0 | 1 | 2 |
|---|---|---|---|---|
| 1 | Section mark totals match CAPS prescription for subject+grade+term | Wrong totals | Off ≤2 marks | Exact match |
| 2 | Sum of section totals = printed cover total = printed end total | Mismatch | Off ≤2 | Exact match |
| 3 | No markdown asterisks visible in rendered output | Visible `**` | Visible in 1 spot | None |
| 4 | Multi-part questions stack vertically with per-part answer space | Inline run-on | Mixed | All vertical |
| 5 | All tables render as real grids (not black bars or pipe ASCII) | None render | Some render | All render |
| 6 | Every visual asset is embedded OR has a source citation | Missing, no cite | Cite, no asset | Asset embedded |
| 7 | No question tests content outside the Term's ATP | ≥1 violation | Edge case | Clean |
| 8 | No question above Grade 6 cognitive demand | Multiple | One | None |
| 9 | Questions are placed in correct sections (Lang ≠ Comp) | Multiple misfits | One | All correct |
| 10 | No question gives away its own answer in the stem | ≥1 | Borderline | None |
| 11 | Stated mark counts in instructions match awarded marks | Errors | One error | All consistent |
| 12 | Multiple Choice sections include options (a)(b)(c)(d) | Missing | Partial | All present |
| 13 | Abbreviations spelled out on first use (HCF, LCM, etc.) | Bare abbrev | Inconsistent | Always spelled out |
| 14 | Cognitive-level taxonomy matches subject (Barrett's / Maths / none) | Wrong | Mixed | Correct |
| 15 | Subject-specific structural rules met (see Section 3) | Major fail | Minor fail | Pass |

**Phase-level pass criteria for production rollout:** average ≥28/30 across 10 generated papers per subject for two consecutive batches.

---

## 5. APPENDIX — VERBATIM REMARKS (traceability)

Every rule above maps to an actual handwritten remark on a specific page. Preserved here so future contributors can verify the source.

### 5.1 English HL Gr6 T1

- p1 (cover): "Comprehension - 20 marks / Visual text - 10 marks / Summary - 5 marks / Language - 15 marks / Total 50 marks"
- p4 (Q3.1 nouns): "List a) b) c)" AND "Nouns are not underlined"
- p5 (Q4.2 tenses): "Change format to a) with a space to write answer. b) with a space to write answer. etc."
- p5 (Q5.1 syllables): "5.1 answers already given"
- p6 (Section D writing): "There must only be a summary question, not an essay question."

### 5.2 English HL Gr6 T2

- p2 (Section A header): "(24 marks) Must be 20 marks"
- p3 (Section B header): "(2 marks) Must be 5 marks"
- p4 (Section C header): "(7 marks) Must be 10 marks"
- p4 (Section D header): "(17 marks) Must be 15 marks"
- p5 (Q4.4 conditionals): "Too difficult for grade 6" (circling "Type 1 or Type 2")
- p5 (Q5.1 nouns): "Not underlined"
- p5 (Q5.3, 5.4 multi-part): "List a) b) c) d)"

### 5.3 English FAL Gr6 T2

- p2 (Section A header): "20 marks, not 19"
- p3 (Q1.8 area): "Great questions" (positive feedback on Section A content quality)
- p3 (Section B header): "Must be 5 marks"
- p4 (above ADVERTISEMENT heading): "Perhaps state where source can be found to add visual text"
- p4 (Section C header): "10 marks, not 11"
- p4 (Q3.1 area): "Perhaps add a variety of questions and not just 4. Only for this section."
- p5 (Q4.1 nouns): "Words for 4.1 isn't underlined. Fix layout: example a) b) c) d)"
- p5 (Q4.2 pronouns): "Rather list a) b) c) d)"
- p5 (Q5.4 conditional): "State question in grade 6 language."
- p6 (Q6.2 verbs): "List a) b) words are not underlined"
- p6 (Q6.3 tone): "6.3 isn't a language structure question."

### 5.4 Mathematics Gr6 T2

- p1 (cover, instructions): ✓ (green tick approving the 5-section, 50-mark structure)
- p2 (Section A area): "There are no multiple choice options given for 1.1 - 1.7"
- p2 (Q1.3 HCF): "Use full word, not abbreviation"
- p2 (Q1.5/1.6 area): "Questions are good" (positive)
- p2 (Q2.5 LCM): "Use the whole word, not the abbreviation"
- p4 (Q4.3 input-output table): "Good question. Format of diagram is wrong."
- p4 (Equivalent Forms Table heading): "What is this?" (circled)
- p4 (Q5.2): "5.2 doesn't show a table."
- p4 (Q5.4 profit): "Money isn't part of the term 1 or 2 ATPs"

### 5.5 Life Skills — Creative Arts Gr6 T2

- p1 (cover): "Visual art and performing art should be rotated each term. They should not be done in the same paper. Example: Term 1 → only visual art, Term 2 → only performing arts."
- p1 (cover): "Bloom's not necessary for this paper."
- p1 (cover): "Art is always out of 40 marks."
- p1 (cover): "It is not a question paper, but instead an instruction of art that needs to be created or a performance that must be prepared."

---

## 6. INTEGRATION POINTS WITH `api/generate.js` PIPELINE

Cross-reference with the 4-phase pipeline:

**Phase 1 (Plan generation):** Section 2.3 (mark allocation), 2.4 (ATP scope), 3.1-3.5 (subject structures) feed the JSON blueprint validator. Add a hard structural-validation pass that rejects plans where:
- (a) section marks don't match the subject's prescribed structure,
- (b) Creative Arts mixes both art forms,
- (c) any topic falls outside the term's ATP.

**Phase 2 (Question paper writing):** Section 2.1 (rendering), 2.2 (visuals), 2.5 (question quality) belong in the system prompt. The "no markdown asterisks" rule needs both prompt-level and post-processing enforcement (regex strip of `**` from final text before `.docx` assembly).

**Phase 2b (Quality check):** Section 2.5 patterns (answer-in-stem, MC without options, mark arithmetic errors, wrong-section placement) become explicit checks in the JSON flaw list.

**Phase 3A (Memo table):** Section 2.2 final bullet — do not generate memo answers that depend on visuals not present in the paper.

**Phase 3B (Cognitive analysis + rubric):** Section 2.6 routes to the correct taxonomy. Creative Arts skips this phase entirely (Section 3.5 Hard Rule 4) and emits a rubric-only artifact.

**Phase 4 (Memo verification):** Add a final cross-check that section-mark totals in the question paper equal the section-mark totals in the memo's cognitive-level analysis table.
