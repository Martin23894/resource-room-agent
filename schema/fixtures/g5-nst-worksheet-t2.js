// Grade 5 Natural Sciences and Technology — Term 2 Worksheet (25 marks)
// Schema version: 1.0
//
// Cognitive distribution (Bloom's):
//   Low Order    50 %  13 marks  Q1(2)+Q2(1)+Q3(1)+Q4(1)+Q5(1)+Q6(1)+Q7(4)+Q8(2) = 13
//   Middle Order 35 %   9 marks  Q9(3)+Q10(3)+Q11(3) = 9
//   High Order   15 %   3 marks  Q12(3) = 3
//   TOTAL                25 marks

const resource = {
  meta: {
    schemaVersion: "1.0",
    subject: "Natural Sciences and Technology",
    grade: 5,
    term: 2,
    language: "English",
    resourceType: "Worksheet",
    totalMarks: 25,
    duration: { minutes: 30 },
    difficulty: "on",
    cognitiveFramework: {
      name: "Bloom's",
      levels: [
        { name: "Low Order",    percent: 50, prescribedMarks: 13 },
        { name: "Middle Order", percent: 35, prescribedMarks: 9  },
        { name: "High Order",   percent: 15, prescribedMarks: 3  },
      ],
    },
    topicScope: {
      coversTerms: [2],
      topics: [
        "Matter and Materials: solid materials and their properties (strength, flexibility, waterproofness)",
        "Matter and Materials: classifying materials (natural vs man-made)",
        "Matter and Materials: uses of materials in everyday life",
        "Matter and Materials: building structures from materials",
        "Technology: design process — investigate, design, make, evaluate",
      ],
    },
  },

  cover: {
    resourceTypeLabel: "WORKSHEET",
    subjectLine: "Natural Sciences and Technology",
    gradeLine: "Grade 5",
    termLine: "Term 2",
    learnerInfoFields: [
      { kind: "name", label: "Name" },
      { kind: "date", label: "Date" },
    ],
    instructions: {
      heading: "Instructions",
      items: [
        "Read each question carefully.",
        "Answer in the space provided.",
        "Use full sentences where asked.",
      ],
    },
  },

  stimuli: [
    {
      id: "materials-table",
      kind: "dataSet",
      heading: "Properties of Common Materials",
      table: {
        headers: ["Material", "Strength", "Flexible?", "Waterproof?"],
        rows: [
          ["Wood",    "High",   "No",  "No" ],
          ["Plastic", "Medium", "Yes", "Yes"],
          ["Metal",   "High",   "No",  "Yes"],
          ["Glass",   "Medium", "No",  "Yes"],
        ],
      },
    },
  ],

  sections: [
    {
      letter: null,
      title: "QUESTIONS",
      questions: [
        // ── Q1  MCQ · Low Order · 2 marks ──────────────────────────────
        {
          number: "1",
          type: "MCQ",
          topic: "Matter and Materials: solid materials and their properties (strength, flexibility, waterproofness)",
          stem: "Which property describes a material that bends without breaking?",
          marks: 2,
          cognitiveLevel: "Low Order",
          answerSpace: { kind: "options" },
          options: [
            { label: "a", text: "Strength",       isCorrect: false },
            { label: "b", text: "Flexibility",    isCorrect: true  },
            { label: "c", text: "Waterproofness", isCorrect: false },
            { label: "d", text: "Hardness",       isCorrect: false },
          ],
        },

        // ── Q2  TrueFalse · Low Order · 1 mark ─────────────────────────
        {
          number: "2",
          type: "TrueFalse",
          topic: "Matter and Materials: classifying materials (natural vs man-made)",
          stem: "True or False: Cotton is a man-made material.",
          marks: 1,
          cognitiveLevel: "Low Order",
          answerSpace: { kind: "none" },
          trueFalseAnswer: false,
        },

        // ── Q3  TrueFalse · Low Order · 1 mark ─────────────────────────
        {
          number: "3",
          type: "TrueFalse",
          topic: "Matter and Materials: classifying materials (natural vs man-made)",
          stem: "True or False: Plastic is a man-made material.",
          marks: 1,
          cognitiveLevel: "Low Order",
          answerSpace: { kind: "none" },
          trueFalseAnswer: true,
        },

        // ── Q4  FillBlank · Low Order · 1 mark ─────────────────────────
        {
          number: "4",
          type: "FillBlank",
          topic: "Matter and Materials: solid materials and their properties (strength, flexibility, waterproofness)",
          stem: "A material that does not allow water to pass through it is described as _____________.",
          marks: 1,
          cognitiveLevel: "Low Order",
          answerSpace: { kind: "inlineBlank" },
        },

        // ── Q5  OneWordAnswer · Low Order · 1 mark ──────────────────────
        {
          number: "5",
          type: "OneWordAnswer",
          topic: "Matter and Materials: uses of materials in everyday life",
          stem: "Name ONE material commonly used to make windows.",
          marks: 1,
          cognitiveLevel: "Low Order",
          answerSpace: { kind: "lines", lines: 1 },
        },

        // ── Q6  FillBlank · Low Order · 1 mark ─────────────────────────
        {
          number: "6",
          type: "FillBlank",
          topic: "Technology: design process — investigate, design, make, evaluate",
          stem: "The first step of the technology design process is to _____________.",
          marks: 1,
          cognitiveLevel: "Low Order",
          answerSpace: { kind: "inlineBlank" },
        },

        // ── Q7  MCQ · Low Order · 4 marks (2 parts, each 2 marks) ───────
        // Uses stimulus — material properties table
        {
          number: "7",
          type: "MCQ",
          topic: "Matter and Materials: solid materials and their properties (strength, flexibility, waterproofness)",
          stem: "Use the table above. According to the table, which materials are waterproof? Select the correct answer.",
          stimulusRef: "materials-table",
          marks: 4,
          cognitiveLevel: "Low Order",
          answerSpace: { kind: "options" },
          options: [
            { label: "a", text: "Wood and glass",           isCorrect: false },
            { label: "b", text: "Wood and plastic",         isCorrect: false },
            { label: "c", text: "Plastic, metal and glass", isCorrect: true  },
            { label: "d", text: "Metal and wood",           isCorrect: false },
          ],
        },

        // ── Q8  ShortAnswer · Low Order · 2 marks ───────────────────────
        {
          number: "8",
          type: "ShortAnswer",
          topic: "Matter and Materials: uses of materials in everyday life",
          stem: "Give TWO examples of how metal is used in everyday life.",
          marks: 2,
          cognitiveLevel: "Low Order",
          answerSpace: { kind: "lines", lines: 3 },
        },

        // ── Q9  ShortAnswer · Middle Order · 3 marks ────────────────────
        {
          number: "9",
          type: "ShortAnswer",
          topic: "Matter and Materials: classifying materials (natural vs man-made)",
          stem: "Give TWO examples of natural materials and ONE example of a man-made material. For each, state where it comes from or how it is produced. (3 marks)",
          marks: 3,
          cognitiveLevel: "Middle Order",
          answerSpace: { kind: "lines", lines: 4 },
        },

        // ── Q10 ShortAnswer · Middle Order · 3 marks ────────────────────
        {
          number: "10",
          type: "ShortAnswer",
          topic: "Matter and Materials: building structures from materials",
          stem: "Use the table above. A builder needs a material that is both strong AND waterproof for an outdoor wall. Identify the best material from the table and explain why it is suitable, using TWO properties from the table. (3 marks)",
          stimulusRef: "materials-table",
          marks: 3,
          cognitiveLevel: "Middle Order",
          answerSpace: { kind: "lines", lines: 4 },
        },

        // ── Q11 ShortAnswer · Middle Order · 3 marks ────────────────────
        {
          number: "11",
          type: "ShortAnswer",
          topic: "Technology: design process — investigate, design, make, evaluate",
          stem: "List the FOUR steps of the technology design process in the correct order and briefly describe what happens in each step. (3 marks)",
          marks: 3,
          cognitiveLevel: "Middle Order",
          answerSpace: { kind: "lines", lines: 5 },
        },

        // ── Q12 ShortAnswer · High Order · 3 marks ──────────────────────
        {
          number: "12",
          type: "ShortAnswer",
          topic: "Matter and Materials: uses of materials in everyday life",
          stem: "A school wants to build a new playground shelter. The shelter must be strong, keep out rain, and be safe for learners. Recommend TWO materials that should be used and justify each choice by linking it to a specific property it provides. (3 marks)",
          marks: 3,
          cognitiveLevel: "High Order",
          answerSpace: { kind: "lines", lines: 5 },
        },
      ],
    },
  ],

  memo: {
    answers: [
      {
        questionNumber: "1",
        answer: "b) Flexibility",
        cognitiveLevel: "Low Order",
        marks: 2,
      },
      {
        questionNumber: "2",
        answer: "False — Cotton is a natural material obtained from the cotton plant.",
        cognitiveLevel: "Low Order",
        marks: 1,
      },
      {
        questionNumber: "3",
        answer: "True — Plastic is manufactured from chemicals derived from crude oil.",
        cognitiveLevel: "Low Order",
        marks: 1,
      },
      {
        questionNumber: "4",
        answer: "waterproof",
        cognitiveLevel: "Low Order",
        marks: 1,
      },
      {
        questionNumber: "5",
        answer: "Glass",
        markingGuidance: "Accept only: glass.",
        cognitiveLevel: "Low Order",
        marks: 1,
      },
      {
        questionNumber: "6",
        answer: "investigate",
        markingGuidance: "Accept: investigate / identify the problem.",
        cognitiveLevel: "Low Order",
        marks: 1,
      },
      {
        questionNumber: "7",
        answer: "c) Plastic, metal and glass",
        markingGuidance: "Full 4 marks for correct option. No part marks for MCQ.",
        cognitiveLevel: "Low Order",
        marks: 4,
      },
      {
        questionNumber: "8",
        answer: "Any two correct examples, e.g.: (1) metal is used to make pots and pans for cooking; (2) metal is used to make cars and bicycles.",
        markingGuidance: "1 mark per valid example. Max 2.",
        cognitiveLevel: "Low Order",
        marks: 2,
      },
      {
        questionNumber: "9",
        answer: "Natural materials (any two): wood — from trees; cotton — from the cotton plant; wool — from sheep; stone — found in the ground. Man-made material (any one): plastic — manufactured from oil chemicals; glass — made by melting sand; nylon — manufactured in a factory.",
        markingGuidance: "1 mark per correct natural example with source (max 2); 1 mark for correct man-made example with production method. Max 3.",
        cognitiveLevel: "Middle Order",
        marks: 3,
      },
      {
        questionNumber: "10",
        answer: "Metal is the best choice. According to the table, metal has high strength (supports heavy loads) and is waterproof (keeps water out), making it ideal for an outdoor wall.",
        markingGuidance: "1 mark — identifies metal; 1 mark — links to high strength; 1 mark — links to waterproof property.",
        cognitiveLevel: "Middle Order",
        marks: 3,
      },
      {
        questionNumber: "11",
        answer: "1. Investigate — identify the problem and gather information about possible solutions. 2. Design — draw a plan and choose materials. 3. Make — build or construct the solution using the chosen materials. 4. Evaluate — test whether the solution solves the problem and suggest improvements.",
        markingGuidance: "Award 1 mark for correct steps 1–2 described; 1 mark for correct steps 3–4 described; 1 mark for all four in correct order with clear descriptions. Max 3.",
        cognitiveLevel: "Middle Order",
        marks: 3,
      },
      {
        questionNumber: "12",
        answer: "Acceptable recommendations (any two from): Metal — high strength supports the roof structure; waterproof keeps rain out. Plastic — waterproof sheds water; flexible allows shaping into panels. Glass — waterproof keeps rain out; allows natural light in. Each material must be linked to a specific property that meets the shelter's requirements.",
        markingGuidance: "1 mark per material correctly named; 1 mark per justified property linked to a shelter requirement. Award maximum 3 marks (e.g., 1+1+1 or 1.5+1.5 rounded). Deduct marks for unsupported choices.",
        cognitiveLevel: "High Order",
        marks: 3,
      },
    ],
  },
};

export default resource;
