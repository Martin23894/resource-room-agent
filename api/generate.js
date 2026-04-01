export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    subject, topic, resourceType, language, duration, difficulty,
    includeRubric, diagramCount, diagramType, diagramPlacement,
    grade, term, bloomsMode, bloomsLevels
  } = req.body;

  if (!subject || !topic || !resourceType || !language) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const gradeNum = parseInt(grade) || 6;
  const termNum = parseInt(term) || 3;
  const phase = gradeNum <= 3 ? 'Foundation Phase' : gradeNum <= 6 ? 'Intermediate Phase' : 'Senior Phase';
  const numDiagrams = parseInt(diagramCount) || 0;

  // ═══════════════════════════════════════════════════════════
  // DoE SUBJECT-SPECIFIC COGNITIVE LEVEL RATIOS
  // ═══════════════════════════════════════════════════════════
  function getDoERatios(subj, gradeN) {
    const s = subj.toLowerCase();

    // Mathematics — CAPS/DoE assessment taxonomy
    if (s.includes('mathematics') || s.includes('maths')) {
      if (gradeN <= 3) {
        return {
          name: 'Foundation Phase Mathematics',
          levels: [
            { level: 'Knowledge (K)', percent: 25, desc: 'Recall of facts, definitions, basic number concepts' },
            { level: 'Routine Procedures (RP)', percent: 45, desc: 'Standard calculations, basic algorithms, direct application' },
            { level: 'Complex Procedures (CP)', percent: 20, desc: 'Multi-step problems, choosing methods' },
            { level: 'Problem Solving (PS)', percent: 10, desc: 'Non-routine problems, reasoning and justification' }
          ]
        };
      }
      return {
        name: 'Mathematics (Intermediate/Senior Phase)',
        levels: [
          { level: 'Knowledge (K)', percent: 20, desc: 'Straight recall, definitions, terminology, basic facts' },
          { level: 'Routine Procedures (RP)', percent: 35, desc: 'Perform standard procedures, direct algorithms, simple one-step calculations' },
          { level: 'Complex Procedures (CP)', percent: 30, desc: 'Multi-step procedures, decision-making, non-routine within familiar context' },
          { level: 'Problem Solving (PS)', percent: 15, desc: 'Unfamiliar situations, higher-order reasoning, mathematical justification' }
        ]
      };
    }

    // Languages — Home Language
    if (s.includes('home language') || s.includes('huistaal')) {
      return {
        name: 'Home Language',
        levels: [
          { level: 'Lower Order (LO) — Literal', percent: 30, desc: 'Direct recall from text, literal comprehension, surface features' },
          { level: 'Middle Order (MO) — Inferential', percent: 40, desc: 'Inference, deduction, interpretation of meaning, language use' },
          { level: 'Higher Order (HO) — Critical/Creative', percent: 30, desc: 'Evaluation, synthesis, critical response, own opinion with justification' }
        ]
      };
    }

    // Languages — First Additional Language
    if (s.includes('additional language') || s.includes('addisionele')) {
      return {
        name: 'First Additional Language',
        levels: [
          { level: 'Lower Order (LO) — Literal', percent: 40, desc: 'Direct comprehension, vocabulary in context, factual recall' },
          { level: 'Middle Order (MO) — Inferential', percent: 35, desc: 'Inference, language structures, understanding tone and purpose' },
          { level: 'Higher Order (HO) — Critical', percent: 25, desc: 'Evaluation, personal response, critical reading' }
        ]
      };
    }

    // Natural Sciences & Technology / Natural Sciences
    if (s.includes('natural sciences') || s.includes('natuur')) {
      return {
        name: 'Natural Sciences',
        levels: [
          { level: 'Recall (R)', percent: 25, desc: 'Remember facts, terminology, definitions, basic concepts' },
          { level: 'Comprehension (C)', percent: 30, desc: 'Explain, describe, identify patterns, understand scientific concepts' },
          { level: 'Application/Analysis (AA)', percent: 30, desc: 'Apply knowledge to new situations, analyse data, interpret results' },
          { level: 'Synthesis/Evaluation (SE)', percent: 15, desc: 'Draw conclusions, evaluate evidence, design investigations' }
        ]
      };
    }

    // Social Sciences
    if (s.includes('social sciences') || s.includes('sosiale')) {
      return {
        name: 'Social Sciences',
        levels: [
          { level: 'Knowledge/Recall (K)', percent: 30, desc: 'Facts, dates, places, events — direct recall' },
          { level: 'Comprehension (C)', percent: 30, desc: 'Explain, describe causes and effects, understanding of concepts' },
          { level: 'Application/Analysis (AA)', percent: 25, desc: 'Source analysis, map skills, compare and contrast, cause and effect' },
          { level: 'Synthesis/Evaluation (SE)', percent: 15, desc: 'Evaluate sources, justify arguments, draw own conclusions' }
        ]
      };
    }

    // Technology
    if (s.includes('technology') || s.includes('tegnologie')) {
      return {
        name: 'Technology',
        levels: [
          { level: 'Knowledge (K)', percent: 20, desc: 'Terminology, processes, materials — factual recall' },
          { level: 'Comprehension (C)', percent: 30, desc: 'Explain how systems work, describe design processes' },
          { level: 'Application (A)', percent: 35, desc: 'Apply design process, practical problem solving, evaluation of designs' },
          { level: 'Analysis/Evaluation (AE)', percent: 15, desc: 'Critically evaluate designs, suggest improvements, justify choices' }
        ]
      };
    }

    // Economic and Management Sciences
    if (s.includes('economic') || s.includes('ems') || s.includes('ekonomie')) {
      return {
        name: 'Economic and Management Sciences',
        levels: [
          { level: 'Knowledge (K)', percent: 25, desc: 'Economic concepts, definitions, business terminology' },
          { level: 'Application (A)', percent: 45, desc: 'Apply financial skills, complete documents, calculate, demonstrate understanding' },
          { level: 'Analysis/Synthesis (AS)', percent: 30, desc: 'Interpret financial statements, evaluate business decisions, draw conclusions' }
        ]
      };
    }

    // Life Skills / Life Orientation
    if (s.includes('life skills') || s.includes('life orientation') || s.includes('lewensoriëntering') || s.includes('lewensvaardighede')) {
      return {
        name: 'Life Skills / Life Orientation',
        levels: [
          { level: 'Knowledge (K)', percent: 30, desc: 'Facts about health, safety, society, values — recall' },
          { level: 'Understanding (U)', percent: 40, desc: 'Explain concepts, describe scenarios, demonstrate understanding' },
          { level: 'Application (A)', percent: 30, desc: 'Apply to own life, make decisions, reflect and evaluate choices' }
        ]
      };
    }

    // Default fallback
    return {
      name: 'General',
      levels: [
        { level: 'Lower Order', percent: 30, desc: 'Knowledge and recall' },
        { level: 'Middle Order', percent: 40, desc: 'Understanding and application' },
        { level: 'Higher Order', percent: 30, desc: 'Analysis, evaluation and creation' }
      ]
    };
  }

  const doeRatios = getDoERatios(subject, gradeNum);
  const ratioText = doeRatios.levels
    .map(l => `  • ${l.level} (${l.percent}%): ${l.desc}`)
    .join('\n');

  // ═══════════════════════════════════════════════════════════
  // BLOOM'S OVERRIDE (if teacher selected specific focus)
  // ═══════════════════════════════════════════════════════════
  const bloomsDescriptions = {
    remember: 'REMEMBER — define, list, recall, identify, name',
    understand: 'UNDERSTAND — explain, summarise, classify, describe',
    apply: 'APPLY — use, solve, demonstrate, calculate',
    analyse: 'ANALYSE — compare, differentiate, examine, break down',
    evaluate: 'EVALUATE — judge, justify, critique, argue',
    create: 'CREATE — design, construct, plan, compose, produce'
  };

  let bloomsOverride = '';
  if (bloomsMode === 'single' && bloomsLevels?.length > 0) {
    bloomsOverride = `\nBLOOM'S TEACHER OVERRIDE — Single focus: ${bloomsDescriptions[bloomsLevels[0]] || bloomsLevels[0]}\nApply the DoE ratios above but weight questions toward this Bloom's level.`;
  } else if (bloomsMode === 'mixed' && bloomsLevels?.length > 0) {
    bloomsOverride = `\nBLOOM'S TEACHER OVERRIDE — Mixed focus: ${bloomsLevels.map(l => bloomsDescriptions[l] || l).join(', ')}\nApply DoE ratios but emphasise these Bloom's levels.`;
  }

  // ═══════════════════════════════════════════════════════════
  // DIFFICULTY
  // ═══════════════════════════════════════════════════════════
  const difficultyNote = difficulty === 'below'
    ? `BELOW grade level — Use simplified language, smaller numbers, more scaffolding. Align with Platinum textbook activities that appear at the START of each topic section (introductory exercises).`
    : difficulty === 'above'
    ? `ABOVE grade level — Multi-step problems, higher-order thinking, extended challenges. Align with Platinum textbook EXTENSION activities and the most challenging exercises at the end of each section.`
    : `ON grade level — Standard CAPS expectations. Align with Platinum textbook CORE exercises — the main practice activities in the middle of each lesson section.`;

  // ═══════════════════════════════════════════════════════════
  // PLATINUM TEXTBOOK ALIGNMENT GUIDANCE
  // ═══════════════════════════════════════════════════════════
  const platinumGuidance = gradeNum <= 3
    ? `FOUNDATION PHASE TEXTBOOK STYLE (Grades 1–3):
- Align with Thelma Res / Spot On / Starbright style resources used in SA Foundation Phase classrooms
- Short, clear instructions with visual support where possible
- Simple sentence structures appropriate for early readers
- Practical, hands-on activities grounded in the learner's immediate environment`
    : `PLATINUM TEXTBOOK ALIGNMENT (Grades 4–7, Maskew Miller Longman):
- Match the vocabulary, terminology and language register used in Platinum ${subject} Grade ${gradeNum}
- Use the same worked example format: clearly labelled steps, margin notes, boxed definitions
- Follow Platinum's progression within the topic: concrete → semi-abstract → abstract
- Use similar context and scenario types as Platinum (SA settings, realistic situations, relatable names)
- Questions should feel like they could appear in a Platinum exercise set — same style, same cognitive demand
- For Mathematics: use the same number ranges, operation styles and presentation as Platinum Maths Grade ${gradeNum}
- Include at least one "Did you know?" or contextual note the way Platinum does, embedded in teacher instructions`;

  // ═══════════════════════════════════════════════════════════
  // DIAGRAM INSTRUCTIONS
  // ═══════════════════════════════════════════════════════════
  const diagramTypeMap = {
    agent: 'Choose the most educationally appropriate diagram type for this topic.',
    bar: 'Bar graph or pie chart (data handling)',
    line: 'Line graph (trends over time)',
    science: 'Scientific diagram (food chain, plant parts, water cycle, life cycle)',
    flow: 'Flow diagram (process, cause-and-effect, sequence)',
    map: 'Map, grid or compass rose (Geography)',
    maths: 'Number line, geometric shapes, or mathematical diagram'
  };

  const svgRules = `SVG rules for EVERY diagram:
- viewBox="0 0 520 300" width="520" height="300"
- First element: <rect width="520" height="300" fill="white"/>
- font-family="Arial, sans-serif" on ALL text elements
- Colours: #085041 #1D9E75 #E1F5EE #185FA5 #BA7517 #888780
- Grade-appropriate for Grade ${gradeNum}, clear labels, no JavaScript`;

  const placementDesc = diagramPlacement === 'beginning'
    ? 'ALL diagrams appear BEFORE questions — insert [DIAGRAM_N] placeholder(s) after the learner header, before SECTION A.'
    : diagramPlacement === 'end'
    ? 'ALL diagrams appear AFTER questions — insert [DIAGRAM_N] placeholder(s) after the TOTAL line, before the memorandum.'
    : 'INLINE — insert [DIAGRAM_N] placeholder directly below the question it illustrates. Include 2–3 questions referring to each diagram.';

  let diagramInstruction = '';
  if (numDiagrams > 0) {
    const diagNums = Array.from({length: numDiagrams}, (_, i) => `[DIAGRAM_${i+1}]`).join(', ');
    diagramInstruction = `\nDIAGRAMS: ${numDiagrams} required. Type: ${diagramTypeMap[diagramType] || diagramTypeMap['agent']}. Placement: ${placementDesc}\nInsert placeholders ${diagNums} at correct positions in "content".\n${svgRules}\n\nIn diagrams JSON:\n${Array.from({length: numDiagrams}, (_, i) => `"diagram${i+1}": {"title":"Figure ${i+1}: [title]","caption":"[explanation]","svg":"[complete SVG]"}`).join('\n')}`;
  }

  const rubricSection = includeRubric
    ? `\n\n═══════════════════════════════════\nMARKING RUBRIC\n═══════════════════════════════════\n[4-level rubric aligned to the DoE cognitive levels used in this resource. Level 1 = not achieved, Level 4 = outstanding.]`
    : '';

  const ageGuidance = gradeNum <= 3
    ? `Foundation Phase: Very simple language, short sentences, fun and encouraging. Age-appropriate for ${5 + gradeNum}-${6 + gradeNum} year olds. Large clear text in mind when formatting.`
    : gradeNum <= 6
    ? `Intermediate Phase: Clear and engaging for ${9 + (gradeNum - 4)}-${10 + (gradeNum - 4)} year olds. Mix of question types. Strong SA context.`
    : `Senior Phase: Formal academic language appropriate for teenagers. Higher complexity, critical thinking expected.`;

  // ═══════════════════════════════════════════════════════════
  // SYSTEM PROMPT
  // ═══════════════════════════════════════════════════════════
  const system = `You are an expert South African CAPS curriculum specialist and experienced ${phase} teacher creating teaching resources for The Resource Room.

WRITING STYLE:
- Warm, professional — sounds like an experienced SA teacher, not a computer
- Use South African context: rands, local names (Sipho, Ayanda, Lerato, Pieter, Zanele, Thabo), tuck shops, load-shedding, SA wildlife, sport
- Vary question types naturally — never repeat the same pattern
- Friendly, encouraging tone toward learners
Language: ${language} only. Never mix languages.
${ageGuidance}

═══════════════════════════════════════════════════════════
DoE COGNITIVE LEVEL REQUIREMENTS — ${doeRatios.name}
═══════════════════════════════════════════════════════════
MANDATORY: Distribute marks EXACTLY according to these DoE ratios:
${ratioText}

Label EACH SECTION of the resource with its cognitive level in brackets, e.g.:
  SECTION A — Knowledge (${doeRatios.levels[0]?.percent || 25}%)
  SECTION B — ${doeRatios.levels[1]?.level || 'Application'} (${doeRatios.levels[1]?.percent || 35}%)
  etc.

Calculate mark allocations per section based on total marks and these percentages. Show the working in teacher instructions.${bloomsOverride}

Difficulty: ${difficultyNote}

═══════════════════════════════════════════════════════════
${platinumGuidance}
═══════════════════════════════════════════════════════════

ATP ALIGNMENT:
This resource covers: Grade ${gradeNum} | Term ${termNum} | ${subject} | ${topic}
Ensure ALL content is strictly aligned to the DoE Annual Teaching Plan for this grade and term. Only include content that falls within this term's ATP scope — do not teach ahead or behind.
${diagramInstruction}

RESPONSE FORMAT — valid JSON ONLY, no markdown, no preamble:
{
  "content": "full resource using exact structure below",
  "diagrams": ${numDiagrams > 0 ? `{"diagram1": {"title":"...","caption":"...","svg":"..."}}` : 'null'}
}

EXACT CONTENT STRUCTURE:

═══════════════════════════════════
TEACHER INSTRUCTIONS
═══════════════════════════════════
Time allocation: [X minutes]
Grade: ${gradeNum} | Term: ${termNum} | Phase: ${phase}
Difficulty: [level] | Textbook alignment: ${gradeNum <= 3 ? 'Foundation Phase resources' : `Platinum ${subject} Grade ${gradeNum}`}
DoE cognitive level split: ${doeRatios.levels.map(l => `${l.level} ${l.percent}%`).join(' | ')}
${numDiagrams > 0 ? `Diagrams: ${numDiagrams} included (${diagramPlacement})\n` : ''}Materials needed: [specific list]
CAPS/ATP reference: Grade ${gradeNum} | Term ${termNum} | [subject] | [topic]
${gradeNum >= 4 ? `Platinum reference: [chapter/unit in Platinum ${subject} Grade ${gradeNum} that covers this topic]\n` : ''}Preparation notes: [2–3 practical sentences a real teacher would find useful]
Mark allocation by cognitive level: [show how total marks are split — e.g. K: 10 marks, RP: 18 marks, CP: 15 marks, PS: 7 marks]

═══════════════════════════════════
THE RESOURCE ROOM — [RESOURCE TYPE]
[Subject] | Grade ${gradeNum} | Term ${termNum} | ${language}
Duration: [time] | Total: [X] marks
═══════════════════════════════════

Learner Name: _________________________________

Date: ____________________  Class: ____________

[Organise into clearly labelled sections matching DoE cognitive levels. Each section must show the cognitive level and mark allocation. Minimum 10 questions. Marks in brackets per question. Question types must be varied and appropriate to the cognitive level of each section.]


TOTAL: _________ / [X]

═══════════════════════════════════
MEMORANDUM
═══════════════════════════════════
[Numbered answers with marks. Model answers for open-ended questions. Brief notes on acceptable alternatives. Mark per question clearly shown.]

Total: [X] marks${rubricSection}

═══════════════════════════════════
EXTENSION / ENRICHMENT ACTIVITY
═══════════════════════════════════
[One meaningful challenge activity at Problem Solving / Higher Order level with full answer]`;

  const user = `Create a complete teacher pack:
Subject: ${subject}
Topic: ${topic}
Resource type: ${resourceType}
Language: ${language}
Grade: ${gradeNum} | Term: ${termNum} | ${phase}
Duration: ${duration}
Difficulty: ${difficulty || 'on'} grade level
${bloomsMode && bloomsMode !== 'none' ? `Bloom's teacher focus: ${bloomsMode} — ${(bloomsLevels || []).join(', ')}` : 'Bloom's: Auto (use DoE ratios)'}
${numDiagrams > 0 ? `Diagrams: ${numDiagrams} | Type: ${diagramTypeMap[diagramType] || 'suitable'} | Placement: ${diagramPlacement}` : ''}
${includeRubric ? 'Include DoE-aligned marking rubric.' : ''}

Apply DoE cognitive level ratios strictly. Align with ${gradeNum <= 3 ? 'Foundation Phase SA resources' : `Platinum ${subject} Grade ${gradeNum}`}. Use SA context throughout. Minimum 10 questions. Return valid JSON ONLY.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 6000,
        system,
        messages: [{ role: 'user', content: user }]
      })
    });

    const responseText = await response.text();

    if (!response.ok) {
      let errMsg = 'API error ' + response.status;
      try {
        const errData = JSON.parse(responseText);
        errMsg = errData.error?.message || errMsg;
      } catch(e) {
        errMsg = responseText.substring(0, 200) || errMsg;
      }
      return res.status(response.status).json({ error: errMsg });
    }

    let raw = '';
    try {
      const data = JSON.parse(responseText);
      raw = data.content?.map(c => c.text || '').join('') || '';
    } catch(e) {
      return res.status(500).json({ error: 'Failed to parse API response: ' + responseText.substring(0, 200) });
    }

    const clean = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(clean); }
    catch (e) { parsed = { content: raw, diagrams: null }; }

    let diagramsArray = [];
    if (parsed.diagrams && typeof parsed.diagrams === 'object') {
      for (let i = 1; i <= numDiagrams; i++) {
        const d = parsed.diagrams[`diagram${i}`];
        if (d) diagramsArray.push({ ...d, index: i });
      }
    }

    return res.status(200).json({
      content: parsed.content || raw,
      diagrams: diagramsArray.length > 0 ? diagramsArray : null,
      diagramPlacement: diagramPlacement || 'beginning'
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
