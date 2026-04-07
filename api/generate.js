export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    subject, topic, resourceType, language, duration, difficulty,
    includeRubric, diagramCount, diagramType,
    grade, term, allTopics
  } = req.body;

  if (!subject || !resourceType || !language) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const g = parseInt(grade) || 6;
  const t = parseInt(term) || 3;
  const phase = g <= 3 ? 'Foundation Phase' : g <= 6 ? 'Intermediate Phase' : 'Senior Phase';

  // Parse duration string: "50 marks, 1 hour" → marks=50, time="1 hour"
  const durParts = (duration || '50 marks, 1 hour').split(',').map(s => s.trim());
  const totalMarks = parseInt(durParts[0]) || 50;
  const timeAllocation = durParts[1] || '1 hour';

  function getDoERatios(subj, gradeNum) {
    const s = (subj || '').toLowerCase();
    if (s.includes('math') || s.includes('wiskunde'))
      return gradeNum <= 3
        ? 'Knowledge 25% | Routine Procedures 45% | Complex Procedures 20% | Problem Solving 10%'
        : 'Knowledge 25% | Routine Procedures 45% | Complex Procedures 25% | Problem Solving 10%';
    if (s.includes('home language') || s.includes('huistaal'))
      return 'Lower Order/Literal 30% | Middle Order/Inferential 40% | Higher Order/Critical 30%';
    if (s.includes('additional') || s.includes('addisionele'))
      return 'Lower Order/Literal 40% | Middle Order/Inferential 35% | Higher Order/Critical 25%';
    if (s.includes('natural') || s.includes('natuur'))
      return 'Recall 25% | Comprehension 30% | Application/Analysis 30% | Synthesis/Evaluation 15%';
    if (s.includes('social') || s.includes('sosiale'))
      return 'Knowledge/Recall 30% | Comprehension 30% | Application/Analysis 25% | Synthesis/Evaluation 15%';
    if (s.includes('technolog') || s.includes('tegnol'))
      return 'Knowledge 20% | Comprehension 30% | Application 35% | Analysis/Evaluation 15%';
    if (s.includes('economic') || s.includes('ekonom'))
      return 'Knowledge 25% | Application 45% | Analysis/Synthesis 30%';
    if (s.includes('life') || s.includes('lewens'))
      return 'Knowledge 30% | Understanding 40% | Application 30%';
    return 'Lower Order 30% | Middle Order 40% | Higher Order 30%';
  }

  const doeRatios = getDoERatios(subject, g);

  // Calculate prescribed marks per cognitive level
  function getCognitiveLevelMarks(subj, gradeNum, total) {
    const s = (subj || '').toLowerCase();
    if (s.includes('math') || s.includes('wiskunde')) {
      if (gradeNum <= 3) return {levels: ['Knowledge','Routine Procedures','Complex Procedures','Problem Solving'], pcts: [25,45,20,10]};
      return {levels: ['Knowledge','Routine Procedures','Complex Procedures','Problem Solving'], pcts: [25,45,25,10]};
    }
    if (s.includes('home language') || s.includes('huistaal'))
      return {levels: ['Lower Order/Literal','Middle Order/Inferential','Higher Order/Critical'], pcts: [30,40,30]};
    if (s.includes('additional') || s.includes('addisionele'))
      return {levels: ['Lower Order/Literal','Middle Order/Inferential','Higher Order/Critical'], pcts: [40,35,25]};
    if (s.includes('natural') || s.includes('natuur'))
      return {levels: ['Recall','Comprehension','Application/Analysis','Synthesis/Evaluation'], pcts: [25,30,30,15]};
    if (s.includes('social') || s.includes('sosiale'))
      return {levels: ['Knowledge/Recall','Comprehension','Application/Analysis','Synthesis/Evaluation'], pcts: [30,30,25,15]};
    if (s.includes('technolog') || s.includes('tegnol'))
      return {levels: ['Knowledge','Comprehension','Application','Analysis/Evaluation'], pcts: [20,30,35,15]};
    if (s.includes('economic') || s.includes('ekonom'))
      return {levels: ['Knowledge','Application','Analysis/Synthesis'], pcts: [25,45,30]};
    if (s.includes('life') || s.includes('lewens'))
      return {levels: ['Knowledge','Understanding','Application'], pcts: [30,40,30]};
    return {levels: ['Lower Order','Middle Order','Higher Order'], pcts: [30,40,30]};
  }

  const cogLevels = getCognitiveLevelMarks(subject, g, totalMarks);
  const cogLevelTable = cogLevels.levels.map((level, i) => {
    const marks = Math.round(totalMarks * cogLevels.pcts[i] / 100);
    return level + ' ' + cogLevels.pcts[i] + '% = ' + marks + ' marks';
  }).join('\n');
  const cogLevelLabels = cogLevels.levels.join(', ');

  const diffNote = difficulty === 'below' ? 'BELOW grade level — use simpler vocabulary, more scaffolding, shorter questions'
    : difficulty === 'above' ? 'ABOVE grade level — extension-level, higher-order thinking, less scaffolding'
    : 'ON grade level — standard CAPS difficulty';

  // ═══════════════════════════════════════════════════════════
  // RESOURCE-TYPE-SPECIFIC INSTRUCTIONS
  // ═══════════════════════════════════════════════════════════
  const isExam = resourceType === 'Exam';
  const isFinalExam = resourceType === 'Final Exam';
  const isWorksheet = resourceType === 'Worksheet';
  const isTest = resourceType === 'Test';

  // Determine topic content for the prompt
  let topicInstruction = '';
  if (isFinalExam && allTopics) {
    topicInstruction = 'FINAL EXAM — cover ALL topics from the entire year. Spread questions across all topics proportionally. Every major topic must have at least one question.\n\nTopics to cover:\n' + allTopics;
  } else if (isExam && allTopics) {
    topicInstruction = 'TERM EXAM — cover ALL topics from Term ' + t + '. Spread questions across all topics proportionally. Every topic must have at least one question.\n\nTopics to cover:\n' + allTopics;
  } else {
    topicInstruction = 'TOPIC: ' + (topic || subject);
  }

  // Resource-specific format instructions
  let formatInstructions = '';
  let markGuidance = '';

  if (isTest) {
    markGuidance = 'TOTAL MARKS: ' + totalMarks + '. TIME: ' + timeAllocation + '. The resource must total EXACTLY ' + totalMarks + ' marks.';
    formatInstructions = `
TEST FORMAT:
- Formal cover page with all fields
- Questions grouped by topic sections if covering multiple sub-topics
- Mix of question types (multiple choice, short answer, explain, source-based)
- Full memorandum with tick marks
- Cognitive level analysis table at the end`;
  } else if (isExam) {
    markGuidance = 'TOTAL MARKS: ' + totalMarks + '. TIME: ' + timeAllocation + '. The exam must total EXACTLY ' + totalMarks + ' marks. Spread marks across ALL topics from the term.';
    formatInstructions = `
EXAM FORMAT:
- Formal cover page with all fields
- SECTION A: Objective questions (multiple choice, true/false, matching columns) — covers breadth across all term topics — approximately 30% of marks
- SECTION B: Short answer questions — 2-3 marks each, covering different topics — approximately 30% of marks
- SECTION C: Structured/longer questions — source-based, explain, calculate, describe — approximately 40% of marks
- Each section must draw from DIFFERENT topics across the term
- Full memorandum with tick marks
- Cognitive level analysis table at the end`;
  } else if (isFinalExam) {
    markGuidance = 'TOTAL MARKS: ' + totalMarks + '. TIME: ' + timeAllocation + '. The final exam must total EXACTLY ' + totalMarks + ' marks. Cover ALL 4 terms with heavier weighting on Terms 3-4.';
    formatInstructions = `
FINAL EXAM FORMAT:
- Formal cover page with all fields
- SECTION A: Objective questions (multiple choice, true/false, matching columns) — covers breadth across ALL terms — approximately 25% of marks
- SECTION B: Short answer questions — covers Terms 1-4 — approximately 25% of marks
- SECTION C: Structured/longer questions from Terms 1-2 — approximately 20% of marks
- SECTION D: Structured/longer questions from Terms 3-4 — approximately 30% of marks (heavier weighting on recent work)
- Each section must draw from DIFFERENT topics and terms
- Full memorandum with tick marks
- Cognitive level analysis table at the end`;
  } else if (isWorksheet) {
    markGuidance = 'TOTAL MARKS: ' + totalMarks + '. TIME: ' + timeAllocation + '. The worksheet must total EXACTLY ' + totalMarks + ' marks.';
    formatInstructions = `
WORKSHEET FORMAT:
- NO formal cover page — just a simple header line with: Subject | Grade | Term | Topic | Name: ______ Date: ______
- Focused on ONE topic only — practice and reinforcement
- 8-15 questions, progressing from easy to harder
- Mix of question types but simpler than a test
- Answer lines after each question
- Short memorandum at the end
- NO cognitive level analysis table needed
- Keep it to 2-3 pages maximum`;
  }

  const rubricNote = includeRubric
    ? `

═══════════════════════════════════════════════════════
MARKING RUBRIC
═══════════════════════════════════════════════════════

Create a rubric table with these columns:
CRITERIA | Level 5 (Outstanding) | Level 4 (Good) | Level 3 (Satisfactory) | Level 2 (Needs Improvement) | Level 1 (Not Achieved)

Include 3-4 criteria rows relevant to this ${resourceType}, for example:
- For Languages: Planning/Organisation, Language use/Style/Editing, Structure, Content
- For Maths: Mathematical reasoning, Accuracy of calculations, Presentation of working, Problem-solving approach
- For Sciences: Scientific knowledge, Application of concepts, Analysis/Interpretation, Communication
- For Social Sciences: Knowledge of content, Source interpretation, Writing/Argument, Use of evidence

Each cell must have a brief description of what that level looks like for that criteria.
Add a marks row at the bottom showing the mark range per level.`
    : '';

  // ═══════════════════════════════════════════════════════════
  // SYSTEM PROMPT
  // ═══════════════════════════════════════════════════════════
  const systemText = `You are an expert South African CAPS ${phase} teacher creating professional ${resourceType} resources. Write entirely in ${language}. Use SA context throughout (rands, SA names like Sipho, Ayanda, Zanele, Thandi, Pieter, Anri, local places and scenarios).

DIFFICULTY: ${diffNote}

DoE COGNITIVE LEVELS — MANDATORY MARK SPLIT:
${cogLevelTable}
Total: ${totalMarks} marks

CRITICAL: Do NOT write cognitive level labels like [Knowledge] or [Routine Procedures] anywhere in the LEARNER paper. Cognitive levels are TEACHER-ONLY information and must ONLY appear in the MEMORANDUM section. Learners must never see what cognitive level a question is.

CAPS: Grade ${g} Term ${t} ${subject}
${topicInstruction}
${markGuidance}

Return JSON only: {"content":"the complete resource text"}

═══════════════════════════════════════════════════════
${formatInstructions}
═══════════════════════════════════════════════════════

${isWorksheet ? `WORKSHEET HEADER FORMAT:
${subject} — Worksheet
Grade ${g} | Term ${t} | ${language}
Name: ___________________________    Date: ___________________
Total: ${totalMarks} marks

` : `COVER PAGE FORMAT:

${resourceType.toUpperCase()}
${subject}
Grade ${g}                                                          Term ${t}
Name: ___________________________    Date: ___________________
Surname: ________________________
Examiner: ______________________     Time: ${timeAllocation}

Total: ${totalMarks}    |    %: _____    |    Code: _____

Comments: _______________________________________________

Instructions:
• Read the questions properly.
  o Answer ALL the questions.
  o Show all working where required.
  o Pay special attention to the mark allocation of each question.

`}
═══════════════════════════════════════════════════════

QUESTION PAPER FORMAT RULES:
${isTest ? `- Do NOT use SECTION A / SECTION B headers for a topic test. Just use Question 1, Question 2, etc.
- Each question can focus on a different ASPECT of the topic (e.g. Question 1: definitions, Question 2: calculations)` : ''}
${(isExam || isFinalExam) ? `- USE SECTION A / SECTION B / SECTION C headers to organise the exam by question type.` : ''}
- Number questions hierarchically: Question 1: [topic/heading] → 1.1 → 1.1.1
- Marks in brackets at the END of each question line: (2)
- Answer lines as underscores: _______________________________________________
  • For 1-mark answers: one answer line
  • For 2+ mark answers: two or more answer lines
  • For calculations: add "Working:" line ONLY for calculation questions, then answer line below
  • For multiple choice: list a. b. c. d. on separate lines — NO answer line needed, just "Answer: ___"
  • For true/false: write the statement, then ___________ on the same line or next line
  • For matching columns: present Column A and Column B in a clear table format
- Do NOT write "Working:" for non-calculation questions — just put answer lines
- Do NOT put any cognitive level labels in the question paper

QUESTION TYPE MIX — use at least 3 different types:
- Multiple choice (a, b, c, d) — for knowledge recall
- True or False — for quick knowledge checks
- Fill in the blank / Give the term — "Name two...", "What is the term for..."
- Source-based — provide a short extract, table, data, or scenario, then ask questions about it
- Explain / Describe — "Explain why...", "Describe how..." — for higher-order thinking
- Match columns — Column A and Column B
- Calculate / Show working — for Mathematics (show "Working:" and "Answer:" lines)
- Order / Arrange — "Arrange the following from smallest to greatest"

TOTAL: _____ / ${totalMarks} marks

═══════════════════════════════════════════════════════
MEMORANDUM
═══════════════════════════════════════════════════════

Format the memorandum as a clear table. Include the COGNITIVE LEVEL for each question in the memo — this is the ONLY place cognitive levels should appear:

NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK

Example rows:
1.1 | B | | Knowledge | 1
1.2 | Five hundred and six thousand and twenty-six | 1 mark per correct part | Knowledge | 2
4.1 | (Any two): evaporation, condensation, precipitation | Accept any two from list | Comprehension | 2
7.3 | 5h 45min | 1 mark for calculation, 1 mark for answer | Complex Procedures | 2

Memo rules:
- EVERY question must have a corresponding answer — no gaps
- For multiple choice: just give the letter (A, B, C, or D)
- For True/False: just give True or False
- For short answers: give the expected answer
- For longer answers: give the full model answer with marking guidance
- Where multiple answers are acceptable: "(Any two)" or "(Any three)" + list all acceptable options
- For calculations: show working AND answer, specify marks per step
- The COGNITIVE LEVEL column shows which level each question belongs to — this is TEACHER INFORMATION
- Marks in the memo must add up to EXACTLY ${totalMarks}

TOTAL: ${totalMarks} marks

${isWorksheet ? `
═══════════════════════════════════════════════════════
ANSWERS
═══════════════════════════════════════════════════════
[Numbered answers for all questions. For calculations show working.]
` : `
COGNITIVE LEVEL ANALYSIS TABLE:
Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual %
${cogLevels.levels.map((level, i) => {
    const marks = Math.round(totalMarks * cogLevels.pcts[i] / 100);
    return level + ' | ' + cogLevels.pcts[i] + '% | ' + marks + ' | [actual] | [actual %]';
  }).join('\n')}
Total | 100% | ${totalMarks} | ${totalMarks} | 100%

Then list which questions fall under each cognitive level:
[Level name] ([X] marks): Q1.1 (1) + Q1.2 (1) + ... = [X]
`}
${!isWorksheet ? `
═══════════════════════════════════════════════════════
EXTENSION ACTIVITY
═══════════════════════════════════════════════════════
[One challenging higher-order question with model answer for fast finishers.]
` : ''}
${rubricNote}

CRITICAL RULES (in order of priority):
1. ${markGuidance}
2. COMPLETENESS IS NON-NEGOTIABLE: The resource MUST include ALL sections — questions, TOTAL line, MEMORANDUM with every answer, COGNITIVE LEVEL ANALYSIS table${includeRubric ? ', and MARKING RUBRIC' : ''}. If you run out of space, keep questions shorter — NEVER cut off the memorandum.
3. Keep questions concise and focused. Do NOT write overly long question stems.
4. NO cognitive level labels anywhere in the learner question paper. They belong ONLY in the memorandum.
5. ${isWorksheet ? 'Include 8-15 question items.' : 'Include at least 10 numbered question items (sub-questions count).'}
6. Every question MUST have marks in brackets and answer lines.
7. ${isWorksheet ? 'Include answers for every question.' : 'The MEMORANDUM must include answers for EVERY SINGLE question. No gaps. Marks must add up to EXACTLY ' + totalMarks + '.'}
8. Use South African context, names, currency (rands), and scenarios throughout.
9. Stay within CAPS ATP scope for Grade ${g} ${isFinalExam ? 'Terms 1-4' : 'Term ' + t} ${subject}.
${isWorksheet ? '' : '10. Include the COGNITIVE LEVEL ANALYSIS table after the memorandum with question-level breakdown.'}
${(isExam || isFinalExam) ? '11. EVERY topic listed above must have at least one question. Spread questions across ALL topics.' : ''}
${includeRubric ? '12. Include the MARKING RUBRIC section at the end. This is required — do not skip it.' : ''}`;

  const userText = `Create a ${resourceType} for ${subject}. Grade ${g}, Term ${t}, ${language}, ${duration || '1 hour'}, ${difficulty || 'on'} grade level. ${topicInstruction}${includeRubric ? ' Include a marking rubric.' : ''} Apply DoE cognitive level ratios. JSON only: {"content":"resource text"}`;

  async function callAPI(system, user, maxTok) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTok,
        system,
        messages: [{ role: 'user', content: user }]
      })
    });
    const text = await response.text();
    if (!response.ok) {
      let msg = 'API error ' + response.status;
      try { msg = JSON.parse(text).error?.message || msg; } catch(e) {}
      throw new Error(msg);
    }
    let raw = '';
    try { raw = JSON.parse(text).content?.map(c => c.text || '').join('') || ''; }
    catch(e) { throw new Error('Parse error: ' + text.substring(0, 100)); }
    return raw.replace(/```json|```/g, '').trim();
  }

  try {
    const rubricExtra = includeRubric ? 1500 : 0;

    if (isExam || isFinalExam) {
      // ═══════════════════════════════════════════════════════════
      // TWO-CALL STRATEGY for Exams and Final Exams
      // Call 1: Question paper only (no memo, no cognitive table)
      // Call 2: Memo + cognitive table + extension + rubric
      // ═══════════════════════════════════════════════════════════

      // Call 1: Questions only
      const questionsPrompt = systemText.replace(
        /═+\nMEMORANDUM[\s\S]*$/,
        'TOTAL: _____ / ' + totalMarks + ' marks\n\nDo NOT include a memorandum, cognitive level table, extension, or rubric in this response. ONLY generate the question paper up to and including the TOTAL line.'
      );
      const questionsUser = `Create ONLY the question paper (NO memorandum) for a ${resourceType} for ${subject}. Grade ${g}, Term ${t}, ${language}, ${timeAllocation}, ${difficulty || 'on'} grade level. ${topicInstruction} JSON only: {"content":"question paper text"}`;

      const raw1 = await callAPI(questionsPrompt, questionsUser, 5000);

      let questionPaper = '';
      try {
        const parsed1 = JSON.parse(raw1);
        questionPaper = parsed1.content || raw1;
      } catch(e) {
        let cleaned = raw1;
        cleaned = cleaned.replace(/^\s*\{\s*"content"\s*:\s*"/, '');
        cleaned = cleaned.replace(/"\s*\}\s*$/, '');
        cleaned = cleaned.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
        questionPaper = cleaned;
      }

      // Call 2: Memo + cognitive table + extension + rubric
      const memoSystem = `You are a South African CAPS ${phase} teacher. You have just created a ${resourceType} for Grade ${g} Term ${t} ${subject} in ${language}. Now create the COMPLETE memorandum and supporting sections for this question paper.

DoE COGNITIVE LEVELS:
${cogLevelTable}
Total: ${totalMarks} marks

Return JSON only: {"content":"memorandum text"}`;

      const memoUser = `Here is the question paper you created:

${questionPaper}

Now create ALL of the following sections for this question paper:

1. MEMORANDUM — a table with columns: NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK
   - Answer for EVERY question — no gaps
   - Marks must add up to EXACTLY ${totalMarks}
   - Use (Any two) / (Any three) where multiple answers are acceptable

2. COGNITIVE LEVEL ANALYSIS TABLE:
   Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual %
   ${cogLevels.levels.map((level, i) => {
       const marks = Math.round(totalMarks * cogLevels.pcts[i] / 100);
       return level + ' | ' + cogLevels.pcts[i] + '% | ' + marks;
     }).join('\n   ')}
   Then list which questions fall under each level.

3. EXTENSION ACTIVITY — One challenging higher-order question with model answer.

${includeRubric ? '4. MARKING RUBRIC — 5-level rubric (Outstanding/Good/Satisfactory/Needs Improvement/Not Achieved) with 3-4 criteria rows relevant to ' + subject + '.' : ''}

JSON only: {"content":"memorandum and all sections"}`;

      const raw2 = await callAPI(memoSystem, memoUser, 8192);

      let memoContent = '';
      try {
        const parsed2 = JSON.parse(raw2);
        memoContent = parsed2.content || raw2;
      } catch(e) {
        let cleaned = raw2;
        cleaned = cleaned.replace(/^\s*\{\s*"content"\s*:\s*"/, '');
        cleaned = cleaned.replace(/"\s*\}\s*$/, '');
        cleaned = cleaned.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
        memoContent = cleaned;
      }

      // Combine question paper + memo
      const fullResource = questionPaper + '\n\n' + memoContent;

      return res.status(200).json({
        content: fullResource,
        diagrams: null
      });

    } else {
      // ═══════════════════════════════════════════════════════════
      // SINGLE CALL for Tests and Worksheets (they fit in one call)
      // ═══════════════════════════════════════════════════════════
      let tokenLimit = 7000 + rubricExtra;
      if (isWorksheet) tokenLimit = 4500 + rubricExtra;
      const raw1 = await callAPI(systemText, userText, tokenLimit);

      let resourceContent = '';
      try {
        const parsed1 = JSON.parse(raw1);
        resourceContent = parsed1.content || raw1;
      } catch(e) {
        let cleaned = raw1;
        cleaned = cleaned.replace(/^\s*\{\s*"content"\s*:\s*"/, '');
        cleaned = cleaned.replace(/"\s*\}\s*$/, '');
        cleaned = cleaned.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
        resourceContent = cleaned;
      }

      return res.status(200).json({
        content: resourceContent,
        diagrams: null
      });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
