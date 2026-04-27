export default {
  meta: {
    schemaVersion: "1.0",
    subject: "Social Sciences — History",
    grade: 7,
    term: 2,
    language: "English",
    resourceType: "Exam",
    totalMarks: 25,
    difficulty: "on",
    duration: { minutes: 45 },
    cognitiveFramework: {
      name: "Bloom's",
      levels: [
        { name: "Low Order",    percent: 30, prescribedMarks: 8  },
        { name: "Middle Order", percent: 50, prescribedMarks: 12 },
        { name: "High Order",   percent: 20, prescribedMarks: 5  },
      ],
    },
    topicScope: {
      coversTerms: [1, 2],
      topics: [
        "The Kingdom of Mali and the city of Timbuktu",
        "The transatlantic slave trade",
        "Co-operation and conflict on the Highveld in the early 1800s",
        "Slavery at the Cape",
      ],
    },
  },

  cover: {
    resourceTypeLabel: "EXAM",
    subjectLine: "Social Sciences — History",
    gradeLine: "Grade 7",
    termLine: "Term 2",
    learnerInfoFields: [
      { kind: "name",     label: "Name" },
      { kind: "surname",  label: "Surname" },
      { kind: "date",     label: "Date" },
      { kind: "examiner", label: "Examiner" },
      { kind: "time",     label: "Time" },
      { kind: "total",    label: "Total" },
    ],
    instructions: {
      heading: "INSTRUCTIONS",
      items: [
        "Read all questions carefully before answering.",
        "Answer ALL questions in BOTH sections.",
        "Write neatly and legibly in the spaces provided.",
        "The total mark allocation for this exam is 25 marks.",
      ],
    },
  },

  stimuli: [
    {
      id: "source-1",
      kind: "passage",
      heading: "Source A",
      body: "Every morning before sunrise I rose to light the fire and heat water for the household. My day ended long after dark, scrubbing floors and tending to the children of my owner. We were not permitted to leave the farm without a pass signed by the master. On Sundays some of us gathered quietly behind the stable to pray and to sing in the language we had not yet forgotten. Even those small moments of peace could be taken away at a word. We owned nothing — not our time, not our names, not ourselves.",
      wordCount: 94,
    },
  ],

  sections: [
    {
      letter: "A",
      title: "SOURCE-BASED QUESTIONS",
      instructions: "Study Source A and answer the questions that follow.",
      stimulusRefs: ["source-1"],
      questions: [
        {
          number: "1.1",
          type: "Identify",
          topic: "Slavery at the Cape",
          stem: "Identify TWO tasks that the enslaved person had to perform each day, according to Source A.",
          stimulusRef: "source-1",
          marks: 2,
          cognitiveLevel: "Low Order",
          answerSpace: { kind: "lines", lines: 3 },
        },
        {
          number: "1.2",
          type: "ShortAnswer",
          topic: "Slavery at the Cape",
          stem: "What rule restricted the movement of enslaved people, as stated in Source A? Quote the relevant part of the source in your answer.",
          stimulusRef: "source-1",
          marks: 2,
          cognitiveLevel: "Low Order",
          answerSpace: { kind: "lines", lines: 3 },
        },
        {
          number: "1.3",
          type: "Explain",
          topic: "Slavery at the Cape",
          stem: "Explain what the last sentence of Source A — 'We owned nothing — not our time, not our names, not ourselves' — reveals about the nature of slavery at the Cape. Use evidence from the source to support your answer.",
          stimulusRef: "source-1",
          marks: 4,
          cognitiveLevel: "Middle Order",
          answerSpace: { kind: "lines", lines: 6 },
        },
        {
          number: "1.4",
          type: "Compare",
          topic: "The transatlantic slave trade",
          stem: "Compare the experience of enslaved people at the Cape as depicted in Source A with the conditions endured by enslaved Africans during the transatlantic slave trade. Identify ONE similarity and ONE difference.",
          stimulusRef: "source-1",
          marks: 4,
          cognitiveLevel: "Middle Order",
          answerSpace: { kind: "lines", lines: 6 },
        },
      ],
    },
    {
      letter: "B",
      title: "EXTENDED RESPONSE",
      instructions: "Answer ALL questions in this section. Write in full sentences.",
      questions: [
        {
          number: "2.1",
          type: "Describe",
          topic: "The Kingdom of Mali and the city of Timbuktu",
          stem: "Describe the importance of Timbuktu as a centre of trade and learning during the height of the Kingdom of Mali. Refer to at least TWO specific features in your answer.",
          marks: 4,
          cognitiveLevel: "Low Order",
          answerSpace: { kind: "lines", lines: 6 },
        },
        {
          number: "2.2",
          type: "Explain",
          topic: "Co-operation and conflict on the Highveld in the early 1800s",
          stem: "Explain how the Mfecane/Difaqane led to both co-operation and conflict among communities on the Highveld in the early 1800s. Use specific examples of groups involved.",
          marks: 4,
          cognitiveLevel: "Middle Order",
          answerSpace: { kind: "lines", lines: 6 },
        },
        {
          number: "2.3",
          type: "ExtendedResponse",
          topic: "Slavery at the Cape",
          stem: "To what extent did resistance by enslaved people challenge the institution of slavery at the Cape? In your response, discuss the forms of resistance used, the obstacles they faced, and evaluate how effective this resistance was in bringing about change. Write a well-structured paragraph of approximately 10–12 lines.",
          marks: 5,
          cognitiveLevel: "High Order",
          answerSpace: { kind: "lines", lines: 12 },
        },
      ],
    },
  ],

  memo: {
    answers: [
      {
        questionNumber: "1.1",
        answer: "Any TWO of: lighting the fire / heating water for the household / scrubbing floors / tending to the children of the owner.",
        markingGuidance: "1 mark per correct task identified, max 2. Must come from Source A.",
        cognitiveLevel: "Low Order",
        marks: 2,
      },
      {
        questionNumber: "1.2",
        answer: "Enslaved people were not allowed to leave the farm without a signed pass from the master. Quote: 'We were not permitted to leave the farm without a pass signed by the master.'",
        markingGuidance: "1 mark for the rule; 1 mark for correctly quoting or closely paraphrasing the source.",
        cognitiveLevel: "Low Order",
        marks: 2,
      },
      {
        questionNumber: "1.3",
        answer: "The sentence reveals that enslaved people had no legal personhood or rights: they could not control their own time (working from before sunrise to after dark), their names could be changed by owners, and they were considered property. Evidence: daily labour schedule described in the source; restriction on movement; the fact that even Sunday gatherings 'could be taken away at a word'.",
        markingGuidance: "2 marks for a clear explanation of what the sentence means (total loss of autonomy/personhood); 2 marks for relevant evidence from the source. Deduct 1 mark if no source evidence is cited.",
        cognitiveLevel: "Middle Order",
        marks: 4,
      },
      {
        questionNumber: "1.4",
        answer: "Similarity: In both contexts enslaved people were treated as property with no freedom of movement or self-determination. Difference: Transatlantic enslaved Africans experienced the added trauma of violent capture, the Middle Passage crossing, and complete cultural dislocation, whereas Cape enslaved people, though equally oppressed, lived on farms/in households and could sometimes maintain fragments of language and communal worship (as shown in Source A).",
        markingGuidance: "2 marks for a valid similarity with explanation; 2 marks for a valid difference with explanation. Award only if both contexts are clearly referenced.",
        cognitiveLevel: "Middle Order",
        marks: 4,
      },
      {
        questionNumber: "2.1",
        answer: "Timbuktu was a wealthy trans-Saharan trade hub where gold and salt were exchanged; it also became a renowned Islamic centre of learning with universities such as Sankore attracting scholars from across Africa and the Middle East. Its wealth funded impressive mosques and manuscripts still preserved today.",
        markingGuidance: "1 mark per relevant feature described (trade role, learning/university, wealth/architecture), max 4. Requires at least 2 distinct features for full marks.",
        cognitiveLevel: "Low Order",
        marks: 4,
      },
      {
        questionNumber: "2.2",
        answer: "The Mfecane/Difaqane was a period of widespread warfare triggered largely by Zulu expansion under Shaka, causing mass displacement across the Highveld. Conflict: groups such as the Ndebele under Mzilikazi clashed violently with established communities. Co-operation: displaced groups formed new alliances — e.g. the Sotho united under Moshoeshoe I at Thaba Bosiu, absorbing refugees and building a stronger nation through diplomacy and shared defence.",
        markingGuidance: "2 marks for explaining conflict with a named example; 2 marks for explaining co-operation with a named example. Generic answers without examples max 2/4.",
        cognitiveLevel: "Middle Order",
        marks: 4,
      },
      {
        questionNumber: "2.3",
        answer: "Enslaved people at the Cape resisted in both overt and covert ways. Overt resistance included armed uprisings such as the Slave Revolt of 1808 led by Louis of Mauritius, which directly challenged the authority of slave owners. Covert resistance included feigning illness, deliberately working slowly, breaking tools, running away, and maintaining cultural and religious practices (as seen in Source A). However, resisters faced severe obstacles: brutal punishment, the pass system, lack of legal rights, and isolation on farms. While individual acts of resistance preserved enslaved people's dignity and humanity, they rarely succeeded in dismantling slavery as a whole — that required broader political changes such as British abolitionist pressure and the Emancipation Act of 1834. Overall, resistance was meaningful but structurally limited.",
        markingGuidance: "See rubric for question 2.3. Award marks according to descriptors for Content, Structure, Use of Evidence, and Language.",
        cognitiveLevel: "High Order",
        marks: 5,
      },
    ],

    rubric: {
      title: "Question 2.3 — Marking Rubric (5 marks)",
      criteria: [
        {
          name: "Content",
          descriptors: [
            { level: "Limited",   descriptor: "Mentions only one form of resistance with no explanation; no reference to obstacles or evaluation.", marks: 0 },
            { level: "Adequate",  descriptor: "Identifies at least two forms of resistance and notes one obstacle; limited evaluation.", marks: 1 },
            { level: "Excellent", descriptor: "Identifies both overt and covert resistance with examples, explains obstacles clearly, and evaluates effectiveness with supporting evidence.", marks: 2 },
          ],
        },
        {
          name: "Structure",
          descriptors: [
            { level: "Limited",   descriptor: "No clear paragraph structure; ideas are listed or disjointed.", marks: 0 },
            { level: "Adequate",  descriptor: "Has an opening and some linking sentences but conclusion is weak or absent.", marks: 0 },
            { level: "Excellent", descriptor: "Well-structured paragraph with clear topic sentence, developed body, and evaluative conclusion.", marks: 1 },
          ],
        },
        {
          name: "Use of evidence",
          descriptors: [
            { level: "Limited",   descriptor: "No specific historical examples cited.", marks: 0 },
            { level: "Adequate",  descriptor: "One specific example (e.g. 1808 revolt or pass system) used correctly.", marks: 1 },
            { level: "Excellent", descriptor: "At least two specific historical examples used accurately and integrated into the argument.", marks: 1 },
          ],
        },
        {
          name: "Language",
          descriptors: [
            { level: "Limited",   descriptor: "Frequent errors impede meaning; vocabulary is basic.", marks: 0 },
            { level: "Adequate",  descriptor: "Generally clear with occasional errors; appropriate register.", marks: 0 },
            { level: "Excellent", descriptor: "Fluent, accurate language with subject-appropriate vocabulary throughout.", marks: 1 },
          ],
        },
      ],
    },
  },
};
