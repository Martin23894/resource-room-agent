// Grade 4 Mathematics Term 1 Test — 40 marks
// CAPS-aligned fixture for the resource-room-agent schema v1.0

const TOPICS = {
  WHOLE_NUMBERS_PLACE_VALUE: "Whole numbers: counting, ordering, comparing, representing and place value (up to 4-digit numbers)",
  WHOLE_NUMBERS_PROPERTIES: "Whole numbers: properties of operations (commutative, associative, distributive)",
  NUMBER_SENTENCES: "Number sentences: writing and solving",
  WHOLE_NUMBERS_ADD_SUB: "Whole numbers: addition and subtraction of at least 4-digit numbers",
  WHOLE_NUMBERS_MULT: "Whole numbers: multiplication of 2-digit by 2-digit numbers",
  WHOLE_NUMBERS_MULTIPLES_FACTORS: "Whole numbers: multiples and factors",
};

const meta = {
  schemaVersion: "1.0",
  subject: "Mathematics",
  grade: 4,
  term: 1,
  language: "English",
  resourceType: "Test",
  totalMarks: 40,
  duration: { minutes: 60 },
  difficulty: "on",
  cognitiveFramework: {
    name: "Bloom's",
    levels: [
      { name: "Knowledge",            percent: 25, prescribedMarks: 10 },
      { name: "Routine Procedures",   percent: 45, prescribedMarks: 18 },
      { name: "Complex Procedures",   percent: 20, prescribedMarks:  8 },
      { name: "Problem Solving",      percent: 10, prescribedMarks:  4 },
    ],
  },
  topicScope: {
    coversTerms: [1],
    topics: [
      "Whole numbers: counting, ordering, comparing, representing and place value (up to 4-digit numbers)",
      "Whole numbers: properties of operations (commutative, associative, distributive)",
      "Number sentences: writing and solving",
      "Whole numbers: addition and subtraction of at least 4-digit numbers",
      "Whole numbers: multiplication of 2-digit by 2-digit numbers",
      "Whole numbers: multiples and factors",
    ],
  },
};

const cover = {
  resourceTypeLabel: "TEST",
  subjectLine: "Mathematics",
  gradeLine: "Grade 4",
  termLine: "Term 1",
  learnerInfoFields: [
    { kind: "name",     label: "Name and Surname:" },
    { kind: "date",     label: "Date:" },
    { kind: "examiner", label: "Examiner:" },
    { kind: "time",     label: "Time: 60 minutes" },
    { kind: "total",    label: "Total: 40 marks" },
  ],
  instructions: {
    heading: "INSTRUCTIONS AND INFORMATION",
    items: [
      "Answer ALL questions.",
      "Write neatly and show ALL working out in the spaces provided.",
      "Number your answers correctly according to the numbering system used in this question paper.",
      "You may use a pencil for drawings or diagrams.",
    ],
  },
};

const stimuli = [];

// ─── SECTION A — MULTIPLE CHOICE (10 marks, 5 × 2 marks, Knowledge) ─────────

const sectionA = {
  letter: "A",
  title: "MULTIPLE CHOICE",
  instructions: "Choose the ONE correct answer from the options given. Circle the letter of the correct answer.",
  questions: [
    {
      number: "1",
      type: "Composite",
      topic: TOPICS.WHOLE_NUMBERS_PLACE_VALUE,
      stem: "Choose the ONE correct answer for each question. Write only the letter of the correct answer.",
      subQuestions: [
        {
          number: "1.1",
          type: "MCQ",
          topic: TOPICS.WHOLE_NUMBERS_PLACE_VALUE,
          stem: "What is the value of the digit 7 in the number 3 749?",
          marks: 2,
          cognitiveLevel: "Knowledge",
          answerSpace: { kind: "options" },
          options: [
            { label: "a", text: "7",   isCorrect: false },
            { label: "b", text: "70",  isCorrect: false },
            { label: "c", text: "700", isCorrect: true  },
            { label: "d", text: "7 000", isCorrect: false },
          ],
        },
        {
          number: "1.2",
          type: "MCQ",
          topic: TOPICS.WHOLE_NUMBERS_PLACE_VALUE,
          stem: "Which number comes BETWEEN 4 298 and 4 302 when counting in ones?",
          marks: 2,
          cognitiveLevel: "Knowledge",
          answerSpace: { kind: "options" },
          options: [
            { label: "a", text: "4 289", isCorrect: false },
            { label: "b", text: "4 299", isCorrect: true  },
            { label: "c", text: "4 310", isCorrect: false },
            { label: "d", text: "4 320", isCorrect: false },
          ],
        },
        {
          number: "1.3",
          type: "MCQ",
          topic: TOPICS.WHOLE_NUMBERS_MULTIPLES_FACTORS,
          stem: "Which of the following is a factor of 24?",
          marks: 2,
          cognitiveLevel: "Knowledge",
          answerSpace: { kind: "options" },
          options: [
            { label: "a", text: "5",  isCorrect: false },
            { label: "b", text: "7",  isCorrect: false },
            { label: "c", text: "9",  isCorrect: false },
            { label: "d", text: "8",  isCorrect: true  },
          ],
        },
        {
          number: "1.4",
          type: "MCQ",
          topic: TOPICS.WHOLE_NUMBERS_PROPERTIES,
          stem: "Which property is shown by the number sentence: 15 + 23 = 23 + 15?",
          marks: 2,
          cognitiveLevel: "Knowledge",
          answerSpace: { kind: "options" },
          options: [
            { label: "a", text: "Associative property",   isCorrect: false },
            { label: "b", text: "Distributive property",  isCorrect: false },
            { label: "c", text: "Commutative property",   isCorrect: true  },
            { label: "d", text: "Identity property",      isCorrect: false },
          ],
        },
        {
          number: "1.5",
          type: "MCQ",
          topic: TOPICS.WHOLE_NUMBERS_MULT,
          stem: "What is 12 × 10?",
          marks: 2,
          cognitiveLevel: "Knowledge",
          answerSpace: { kind: "options" },
          options: [
            { label: "a", text: "22",  isCorrect: false },
            { label: "b", text: "102", isCorrect: false },
            { label: "c", text: "112", isCorrect: false },
            { label: "d", text: "120", isCorrect: true  },
          ],
        },
      ],
    },
  ],
};

// ─── SECTION B — SHORT QUESTIONS AND CALCULATIONS (30 marks) ─────────────────
// Routine Procedures: 18 marks | Complex Procedures: 8 marks | Problem Solving: 4 marks

const sectionB = {
  letter: "B",
  title: "SHORT QUESTIONS AND CALCULATIONS",
  instructions: "Answer ALL questions. Show ALL working out where applicable.",
  questions: [
    // ── Question 2: Place Value (Routine Procedures) ───────────────────────
    {
      number: "2",
      type: "Composite",
      topic: TOPICS.WHOLE_NUMBERS_PLACE_VALUE,
      stem: "Answer the questions below about the number 5 863.",
      subQuestions: [
        {
          number: "2.1",
          type: "ShortAnswer",
          topic: TOPICS.WHOLE_NUMBERS_PLACE_VALUE,
          stem: "Write the number 5 863 in words.",
          marks: 2,
          cognitiveLevel: "Routine Procedures",
          answerSpace: { kind: "lines", lines: 2 },
        },
        {
          number: "2.2",
          type: "ShortAnswer",
          topic: TOPICS.WHOLE_NUMBERS_PLACE_VALUE,
          stem: "Write the expanded notation for 5 863.",
          marks: 2,
          cognitiveLevel: "Routine Procedures",
          answerSpace: { kind: "lines", lines: 2 },
        },
        {
          number: "2.3",
          type: "ShortAnswer",
          topic: TOPICS.WHOLE_NUMBERS_PLACE_VALUE,
          stem: "Round 5 863 to the nearest hundred.",
          marks: 1,
          cognitiveLevel: "Routine Procedures",
          answerSpace: { kind: "lines", lines: 1 },
        },
      ],
    },

    // ── Question 3: Ordering and Comparing (Routine Procedures) ───────────
    {
      number: "3",
      type: "Composite",
      topic: TOPICS.WHOLE_NUMBERS_PLACE_VALUE,
      stem: "Use the numbers: 3 047  |  3 704  |  3 470  |  3 407",
      subQuestions: [
        {
          number: "3.1",
          type: "ShortAnswer",
          topic: TOPICS.WHOLE_NUMBERS_PLACE_VALUE,
          stem: "Arrange the four numbers from SMALLEST to LARGEST.",
          marks: 2,
          cognitiveLevel: "Routine Procedures",
          answerSpace: { kind: "lines", lines: 2 },
        },
        {
          number: "3.2",
          type: "ShortAnswer",
          topic: TOPICS.WHOLE_NUMBERS_PLACE_VALUE,
          stem: "Write the correct symbol (< or >) between the numbers: 3 407 ___ 3 470",
          marks: 1,
          cognitiveLevel: "Routine Procedures",
          answerSpace: { kind: "lines", lines: 1 },
        },
      ],
    },

    // ── Question 4: Addition and Subtraction (Routine Procedures) ─────────
    {
      number: "4",
      type: "Composite",
      topic: TOPICS.WHOLE_NUMBERS_ADD_SUB,
      stem: "Calculate the following. Show ALL working out.",
      subQuestions: [
        {
          number: "4.1",
          type: "Calculation",
          topic: TOPICS.WHOLE_NUMBERS_ADD_SUB,
          stem: "2 456 + 3 187 = ___",
          marks: 2,
          cognitiveLevel: "Routine Procedures",
          answerSpace: { kind: "workingPlusAnswer" },
        },
        {
          number: "4.2",
          type: "Calculation",
          topic: TOPICS.WHOLE_NUMBERS_ADD_SUB,
          stem: "7 034 − 2 658 = ___",
          marks: 2,
          cognitiveLevel: "Routine Procedures",
          answerSpace: { kind: "workingPlusAnswer" },
        },
      ],
    },

    // ── Question 5: Multiplication (Routine Procedures) ────────────────────
    {
      number: "5",
      type: "Composite",
      topic: TOPICS.WHOLE_NUMBERS_MULT,
      stem: "Calculate the following. Show ALL working out.",
      subQuestions: [
        {
          number: "5.1",
          type: "Calculation",
          topic: TOPICS.WHOLE_NUMBERS_MULT,
          stem: "24 × 13 = ___",
          marks: 2,
          cognitiveLevel: "Routine Procedures",
          answerSpace: { kind: "workingPlusAnswer" },
        },
        {
          number: "5.2",
          type: "Calculation",
          topic: TOPICS.WHOLE_NUMBERS_MULT,
          stem: "35 × 21 = ___",
          marks: 1,
          cognitiveLevel: "Routine Procedures",
          answerSpace: { kind: "workingPlusAnswer" },
        },
      ],
    },

    // ── Question 6: Multiples and Factors (Routine Procedures) ────────────
    {
      number: "6",
      type: "Composite",
      topic: TOPICS.WHOLE_NUMBERS_MULTIPLES_FACTORS,
      stem: "Answer the questions about multiples and factors.",
      subQuestions: [
        {
          number: "6.1",
          type: "ShortAnswer",
          topic: TOPICS.WHOLE_NUMBERS_MULTIPLES_FACTORS,
          stem: "Write down the first five multiples of 6.",
          marks: 1,
          cognitiveLevel: "Routine Procedures",
          answerSpace: { kind: "lines", lines: 1 },
        },
        {
          number: "6.2",
          type: "ShortAnswer",
          topic: TOPICS.WHOLE_NUMBERS_MULTIPLES_FACTORS,
          stem: "List ALL the factors of 36.",
          marks: 2,
          cognitiveLevel: "Routine Procedures",
          answerSpace: { kind: "lines", lines: 2 },
        },
      ],
    },

    // ── Question 7: Number Sentences — Complex Procedures ──────────────────
    {
      number: "7",
      type: "Composite",
      topic: TOPICS.NUMBER_SENTENCES,
      stem: "Write and solve number sentences.",
      subQuestions: [
        {
          number: "7.1",
          type: "Calculation",
          topic: TOPICS.NUMBER_SENTENCES,
          stem: "Find the value of □ in the number sentence: □ + 1 485 = 4 000",
          marks: 2,
          cognitiveLevel: "Complex Procedures",
          answerSpace: { kind: "workingPlusAnswer" },
        },
        {
          number: "7.2",
          type: "Calculation",
          topic: TOPICS.NUMBER_SENTENCES,
          stem: "Find the value of □: 48 × □ = 48 × 20 + 48 × 3",
          marks: 2,
          cognitiveLevel: "Complex Procedures",
          answerSpace: { kind: "workingPlusAnswer" },
        },
      ],
    },

    // ── Question 8: Complex Procedures — multi-step addition/subtraction ───
    {
      number: "8",
      type: "Composite",
      topic: TOPICS.WHOLE_NUMBERS_ADD_SUB,
      stem: "Answer the questions below.",
      subQuestions: [
        {
          number: "8.1",
          type: "Calculation",
          topic: TOPICS.WHOLE_NUMBERS_ADD_SUB,
          stem: "Thandi has 6 035 beads. She gives away 2 748 beads and then receives 1 506 more. How many beads does Thandi have now?",
          marks: 4,
          cognitiveLevel: "Complex Procedures",
          answerSpace: { kind: "workingPlusAnswer" },
        },
      ],
    },

    // ── Question 9: Problem Solving ────────────────────────────────────────
    {
      number: "9",
      type: "Composite",
      topic: TOPICS.WHOLE_NUMBERS_MULT,
      stem: "Read the problem carefully and answer the questions.",
      subQuestions: [
        {
          number: "9.1",
          type: "WordProblem",
          topic: TOPICS.WHOLE_NUMBERS_MULT,
          stem: "Sipho packs oranges into boxes. Each box holds 24 oranges. He has 13 boxes. He wants to share all the oranges equally among 4 classes at his school. How many oranges will each class receive? Show ALL working out.",
          marks: 4,
          cognitiveLevel: "Problem Solving",
          answerSpace: { kind: "workingPlusAnswer" },
        },
      ],
    },
  ],
};

const sections = [sectionA, sectionB];

// ─── MEMO ────────────────────────────────────────────────────────────────────

const memo = {
  answers: [
    // Section A — MCQ (Knowledge, 2 marks each)
    { questionNumber: "1.1", answer: "c) 700",                              cognitiveLevel: "Knowledge",           marks: 2 },
    { questionNumber: "1.2", answer: "b) 4 299",                            cognitiveLevel: "Knowledge",           marks: 2 },
    { questionNumber: "1.3", answer: "d) 8",                                cognitiveLevel: "Knowledge",           marks: 2 },
    { questionNumber: "1.4", answer: "c) Commutative property",             cognitiveLevel: "Knowledge",           marks: 2 },
    { questionNumber: "1.5", answer: "d) 120",                              cognitiveLevel: "Knowledge",           marks: 2 },

    // Section B — Question 2
    { questionNumber: "2.1", answer: "Five thousand eight hundred and sixty-three",
      markingGuidance: "Award 2 marks for fully correct wording; 1 mark if thousands/hundreds/tens/units are all present but minor word error.",
      cognitiveLevel: "Routine Procedures", marks: 2 },
    { questionNumber: "2.2", answer: "5 000 + 800 + 60 + 3",
      cognitiveLevel: "Routine Procedures", marks: 2 },
    { questionNumber: "2.3", answer: "5 900",
      cognitiveLevel: "Routine Procedures", marks: 1 },

    // Question 3
    { questionNumber: "3.1", answer: "3 047  ;  3 407  ;  3 470  ;  3 704",
      cognitiveLevel: "Routine Procedures", marks: 2 },
    { questionNumber: "3.2", answer: "3 407 < 3 470",
      cognitiveLevel: "Routine Procedures", marks: 1 },

    // Question 4
    { questionNumber: "4.1", answer: "5 643",
      markingGuidance: "Award 2 marks for correct answer. 1 mark if method correct but arithmetic slip.",
      cognitiveLevel: "Routine Procedures", marks: 2 },
    { questionNumber: "4.2", answer: "4 376",
      markingGuidance: "Award 2 marks for correct answer. 1 mark if regrouping evident but arithmetic slip.",
      cognitiveLevel: "Routine Procedures", marks: 2 },

    // Question 5
    { questionNumber: "5.1", answer: "312",
      markingGuidance: "Award 2 marks for correct answer. 1 mark if partial products shown correctly (e.g. 24×10=240, 24×3=72) but final addition wrong.",
      cognitiveLevel: "Routine Procedures", marks: 2 },
    { questionNumber: "5.2", answer: "735",
      markingGuidance: "Award 1 mark for correct answer.",
      cognitiveLevel: "Routine Procedures", marks: 1 },

    // Question 6
    { questionNumber: "6.1", answer: "6, 12, 18, 24, 30",
      cognitiveLevel: "Routine Procedures", marks: 1 },
    { questionNumber: "6.2", answer: "1, 2, 3, 4, 6, 9, 12, 18, 36",
      markingGuidance: "Award 2 marks for all nine factors correct; 1 mark for at least six factors correct.",
      cognitiveLevel: "Routine Procedures", marks: 2 },

    // Question 7
    { questionNumber: "7.1", answer: "□ = 2 515  (working: 4 000 − 1 485 = 2 515)",
      cognitiveLevel: "Complex Procedures", marks: 2 },
    { questionNumber: "7.2", answer: "□ = 23  (working: 48 × 23 = 48 × 20 + 48 × 3 = 960 + 144 = 1 104; or identify □ = 20 + 3 = 23)",
      cognitiveLevel: "Complex Procedures", marks: 2 },

    // Question 8
    { questionNumber: "8.1", answer: "4 793 beads  (6 035 − 2 748 = 3 287; 3 287 + 1 506 = 4 793)",
      markingGuidance: "Award 4 marks for correct final answer with both steps shown. 3 marks if both steps attempted correctly but one arithmetic error. 2 marks if one step correct. 1 mark for recognising two-step operation.",
      cognitiveLevel: "Complex Procedures", marks: 4 },

    // Question 9
    { questionNumber: "9.1", answer: "78 oranges per class  (Step 1: 24 × 13 = 312 oranges total; Step 2: 312 ÷ 4 = 78 oranges each class)",
      markingGuidance: "Award 4 marks for correct answer with full working. 3 marks if multiplication correct (312) but division step has error. 2 marks if strategy identified (two steps) and one step correct. 1 mark for recognising multiplication of 24 × 13 is required.",
      cognitiveLevel: "Problem Solving", marks: 4 },
  ],
};

export default { meta, cover, stimuli, sections, memo };
