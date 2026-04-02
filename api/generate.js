export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    subject, topic, resourceType, language, duration, difficulty,
    includeRubric, diagramCount, diagramType,
    grade, term, bloomsMode, bloomsLevels
  } = req.body;

  if (!subject || !topic || !resourceType || !language) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const g = parseInt(grade) || 6;
  const t = parseInt(term) || 3;
  const numDiag = Math.min(parseInt(diagramCount) || 0, 3);
  const phase = g <= 3 ? 'Foundation Phase' : g <= 6 ? 'Intermediate Phase' : 'Senior Phase';

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

  let bloomsNote = '';
  if (bloomsMode === 'single' && bloomsLevels && bloomsLevels.length > 0)
    bloomsNote = '\nBloom\'s focus: ' + bloomsLevels[0] + ' — weight questions toward this level.';
  else if (bloomsMode === 'mixed' && bloomsLevels && bloomsLevels.length > 0)
    bloomsNote = '\nBloom\'s focus: blend of ' + bloomsLevels.join(', ') + '.';

  const diffNote = difficulty === 'below' ? 'BELOW grade level — use simpler vocabulary, more scaffolding, shorter questions'
    : difficulty === 'above' ? 'ABOVE grade level — extension-level, higher-order thinking, less scaffolding'
    : 'ON grade level — standard CAPS difficulty';

  const rubricNote = includeRubric
    ? '\n\n═══════════════════════════════════════\nMARKING RUBRIC\n═══════════════════════════════════════\n[Create a 4-level rubric (Level 1-4) with criteria aligned to the DoE cognitive levels. Format as a clear table with Level | Description | Marks columns.]'
    : '';

  // ═══════════════════════════════════════════════════════════
  // SYSTEM PROMPT — modelled on real SA teacher resource format
  // ═══════════════════════════════════════════════════════════
  const systemText = `You are an expert South African CAPS ${phase} teacher creating professional assessment resources. Write entirely in ${language}. Use SA context throughout (rands, SA names like Sipho, Ayanda, Zanele, Thandi, Pieter, Anri, local places and scenarios).

DIFFICULTY: ${diffNote}
DoE COGNITIVE LEVELS — MANDATORY: ${doeRatios}${bloomsNote}
CAPS: Grade ${g} Term ${t} ${subject} — ${topic}

Return JSON only: {"content":"the complete resource text"}

═══════════════════════════════════════════════════════
FORMAT YOUR RESOURCE EXACTLY LIKE THIS:
═══════════════════════════════════════════════════════

THE RESOURCE ROOM

${resourceType}
${subject}
Grade ${g}                                                          Term ${t}
Name: ___________________________    Date: ___________________
Surname: ________________________
Time: ${duration || '1 hour'}                                      Total: [X] marks

Instructions:
- Read the questions properly.
- Answer ALL the questions.
- Pay special attention to the mark allocation of each question.

═══════════════════════════════════════════════════════

Question 1: [Topic heading]
1.1  [Question text]                                               (2)
___________________________________________________________________________
___________________________________________________________________________

1.2  [Question text]                                               (1)
___________________________________________________________________________

1.3  [Question with sub-parts]                                     (4)
1.3.1  [Sub-question]                                              (2)
___________________________________________________________________________
1.3.2  [Sub-question]                                              (2)
___________________________________________________________________________

Question 2: [Different topic heading or question type]
[Continue with hierarchical numbering: 2.1, 2.2, 2.3 etc.]

═══════════════════════════════════════════════════════

QUESTION FORMAT RULES:
- Number questions hierarchically: Question 1 → 1.1 → 1.1.1
- ALWAYS put mark allocation in brackets at the end of each question: (2)
- ALWAYS add answer lines (underscores ___________) after each question for learners to write on
- For 1-mark questions: one answer line
- For 2+ mark questions: two or more answer lines
- For multiple choice: list options as a. b. c. d. on separate lines, NO answer lines needed
- For true/false: add _________ after each statement

QUESTION TYPE MIX — use at least 3 different types:
- Multiple choice (a, b, c, d) — good for knowledge recall
- True or False — good for quick knowledge checks
- Short answer / fill in the blank — "Name two..." / "Give the term for..."
- Source-based — provide a short text extract, table, or scenario, then ask questions about it
- Explain / Describe — "Explain why..." / "Describe how..." — good for higher-order
- Match columns — Column A and Column B matching
- Order / Sequence — "Arrange the following..."
- Calculate / Show working — for Maths

TOTAL: _____ / [X] marks

═══════════════════════════════════════════════════════
MEMORANDUM
═══════════════════════════════════════════════════════

Question 1:
1.1  [Answer] ✓✓ (2)
1.2  [Answer] ✓ (1)
1.3.1  [Answer with detail] ✓✓ (2)
[Number every answer to match the question. Use ✓ marks to show mark allocation.]

TOTAL: [X] marks

COGNITIVE LEVEL ANALYSIS:
Cognitive Level | Prescribed % | Actual Marks | Actual %
${doeRatios.split('|').map(r => r.trim()).join('\n')}
Total: [X] marks | 100%

═══════════════════════════════════════════════════════
EXTENSION ACTIVITY
═══════════════════════════════════════════════════════
[One challenging higher-order question with a model answer. This is for fast finishers.]

═══════════════════════════════════════════════════════

CRITICAL RULES:
1. Calculate the TOTAL marks to match the time allocation (roughly 1 mark per minute).
2. Distribute marks across cognitive levels matching the DoE ratios above.
3. Include at least 10 numbered question items (sub-questions count).
4. Every question MUST have marks in brackets and answer lines.
5. The memorandum must have answers for EVERY question with ✓ marks.
6. Use South African context, names, currency (rands), and scenarios throughout.
7. Stay within the CAPS ATP scope for Grade ${g} Term ${t} ${subject} — ${topic}.`;

  const userText = `Create a ${resourceType} for ${subject} — ${topic}. Grade ${g}, Term ${t}, ${language}, ${duration || '1 hour'}, ${difficulty || 'on'} grade level.${includeRubric ? ' Include a marking rubric.' : ''} Apply DoE cognitive level ratios. Minimum 10 question items. SA context. JSON only: {"content":"resource text"}`;

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
    const raw1 = await callAPI(systemText, userText, 4096);

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
