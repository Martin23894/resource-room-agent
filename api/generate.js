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
    ? '\n\nInclude a MARKING RUBRIC section: 4-level rubric (Level 1-4) with criteria and marks.'
    : '';

  // ═══════════════════════════════════════════════════════════
  // SYSTEM PROMPT
  // ═══════════════════════════════════════════════════════════
  const systemText = `You are an expert South African CAPS ${phase} teacher creating professional ${resourceType} resources. Write entirely in ${language}. Use SA context throughout (rands, SA names like Sipho, Ayanda, Zanele, Thandi, Pieter, Anri, local places and scenarios).

DIFFICULTY: ${diffNote}

DoE COGNITIVE LEVELS — MANDATORY MARK SPLIT:
${cogLevelTable}
Total: ${totalMarks} marks

IMPORTANT: Label each question or section with its cognitive level in brackets, e.g. [Knowledge] or [Routine Procedures]. The marks per cognitive level MUST match the prescribed split above.

CAPS: Grade ${g} Term ${t} ${subject}
${topicInstruction}
${markGuidance}

Return JSON only: {"content":"the complete resource text"}

═══════════════════════════════════════════════════════
${formatInstructions}
═══════════════════════════════════════════════════════

${isWorksheet ? `WORKSHEET HEADER:
THE RESOURCE ROOM
${subject} Worksheet — ${topic || 'Term ' + t}
Grade ${g} | Term ${t} | ${language}
Name: ___________________________    Date: ___________________
Total: ${totalMarks} marks
` : `COVER PAGE:
THE RESOURCE ROOM

${resourceType}
${subject}
Grade ${g}                                                          Term ${t}
Name: ___________________________    Date: ___________________
Surname: ________________________
Time: ${timeAllocation}                                      Total: ${totalMarks} marks

Instructions:
- Read the questions properly.
- Answer ALL the questions.
- Pay special attention to the mark allocation of each question.
`}
═══════════════════════════════════════════════════════

QUESTION FORMAT RULES:
- Number questions hierarchically: Question 1 → 1.1 → 1.1.1
- ALWAYS put mark allocation in brackets at the end: (2)
- ALWAYS add answer lines (___________) after each question for learners to write on
- For 1-mark questions: one answer line
- For 2+ mark questions: two or more answer lines
- For multiple choice: list options as a. b. c. d. on separate lines
- For true/false: add _________ after each statement
- For matching columns: present Column A and Column B clearly

QUESTION TYPE MIX — use at least 3 different types:
- Multiple choice (a, b, c, d)
- True or False
- Short answer / fill in the blank
- Source-based — provide a short text extract, table, or scenario then ask questions
- Explain / Describe
- Match columns
- Order / Sequence
- Calculate / Show working (for Maths)

${isWorksheet ? '' : `TOTAL: _____ / ${totalMarks} marks

═══════════════════════════════════════════════════════
MEMORANDUM
═══════════════════════════════════════════════════════

Question 1:
1.1  [Answer] ✓✓ (2)
1.2  [Answer] ✓ (1)
[Number every answer. Use ✓ marks to show mark allocation.]

TOTAL: ${totalMarks} marks
`}
${isWorksheet ? `
═══════════════════════════════════════════════════════
ANSWERS
═══════════════════════════════════════════════════════
[Numbered answers for all questions]
` : `
COGNITIVE LEVEL ANALYSIS:
Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual %
${cogLevels.levels.map((level, i) => {
    const marks = Math.round(totalMarks * cogLevels.pcts[i] / 100);
    return level + ' | ' + cogLevels.pcts[i] + '% | ' + marks + ' | [fill in] | [fill in]';
  }).join('\n')}
Total | 100% | ${totalMarks} | ${totalMarks} | 100%
`}
${!isWorksheet ? `
═══════════════════════════════════════════════════════
EXTENSION ACTIVITY
═══════════════════════════════════════════════════════
[One challenging higher-order question with model answer for fast finishers.]
` : ''}
${rubricNote}

CRITICAL RULES:
1. ${markGuidance}
2. Distribute marks across cognitive levels matching DoE ratios.
3. ${isWorksheet ? 'Include 8-15 question items.' : 'Include at least 10 numbered question items (sub-questions count).'}
4. Every question MUST have marks in brackets and answer lines.
5. ${isWorksheet ? 'Include answers for every question.' : 'The memorandum must have answers for EVERY question with ✓ marks.'}
6. Use South African context, names, currency (rands), and scenarios.
7. Stay within CAPS ATP scope for Grade ${g} ${isFinalExam ? 'Terms 1-4' : 'Term ' + t} ${subject}.
${(isExam || isFinalExam) ? '8. EVERY topic listed above must have at least one question. Spread questions across ALL topics.' : ''}`;

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
    // Exams and Final Exams need more tokens due to covering multiple topics
    const tokenLimit = (isExam || isFinalExam) ? 6000 : 4096;
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

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
