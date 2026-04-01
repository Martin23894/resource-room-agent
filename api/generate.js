// DoE cognitive level ratios — defined at module level, not inside request handler
const DOE_RATIOS = {
  mathematics: {
    name: 'Mathematics',
    foundation: 'Knowledge 25% | Routine Procedures 45% | Complex Procedures 20% | Problem Solving 10%',
    intermediate: 'Knowledge 20% | Routine Procedures 35% | Complex Procedures 30% | Problem Solving 15%',
    senior: 'Knowledge 20% | Routine Procedures 35% | Complex Procedures 30% | Problem Solving 15%'
  },
  home_language: {
    name: 'Home Language',
    all: 'Lower Order (Literal) 30% | Middle Order (Inferential) 40% | Higher Order (Critical/Creative) 30%'
  },
  additional_language: {
    name: 'First Additional Language',
    all: 'Lower Order (Literal) 40% | Middle Order (Inferential) 35% | Higher Order (Critical) 25%'
  },
  natural_sciences: {
    name: 'Natural Sciences',
    all: 'Recall 25% | Comprehension 30% | Application/Analysis 30% | Synthesis/Evaluation 15%'
  },
  social_sciences: {
    name: 'Social Sciences',
    all: 'Knowledge/Recall 30% | Comprehension 30% | Application/Analysis 25% | Synthesis/Evaluation 15%'
  },
  technology: {
    name: 'Technology',
    all: 'Knowledge 20% | Comprehension 30% | Application 35% | Analysis/Evaluation 15%'
  },
  ems: {
    name: 'Economic and Management Sciences',
    all: 'Knowledge 25% | Application 45% | Analysis/Synthesis 30%'
  },
  life_skills: {
    name: 'Life Skills / Life Orientation',
    all: 'Knowledge 30% | Understanding 40% | Application 30%'
  },
  general: {
    name: 'General',
    all: 'Lower Order 30% | Middle Order 40% | Higher Order 30%'
  }
};

function getRatios(subject, grade) {
  const s = (subject || '').toLowerCase();
  const g = parseInt(grade) || 6;
  const phase = g <= 3 ? 'foundation' : g <= 6 ? 'intermediate' : 'senior';

  if (s.includes('math') || s.includes('wiskunde')) {
    const r = DOE_RATIOS.mathematics;
    return { name: r.name, ratios: r[phase] || r.intermediate };
  }
  if (s.includes('home language') || s.includes('huistaal')) {
    return { name: DOE_RATIOS.home_language.name, ratios: DOE_RATIOS.home_language.all };
  }
  if (s.includes('additional') || s.includes('addisionele')) {
    return { name: DOE_RATIOS.additional_language.name, ratios: DOE_RATIOS.additional_language.all };
  }
  if (s.includes('natural') || s.includes('natuur')) {
    return { name: DOE_RATIOS.natural_sciences.name, ratios: DOE_RATIOS.natural_sciences.all };
  }
  if (s.includes('social') || s.includes('sosiale')) {
    return { name: DOE_RATIOS.social_sciences.name, ratios: DOE_RATIOS.social_sciences.all };
  }
  if (s.includes('technolog') || s.includes('tegnol')) {
    return { name: DOE_RATIOS.technology.name, ratios: DOE_RATIOS.technology.all };
  }
  if (s.includes('economic') || s.includes('ekonom') || s.includes('ems')) {
    return { name: DOE_RATIOS.ems.name, ratios: DOE_RATIOS.ems.all };
  }
  if (s.includes('life') || s.includes('lewens')) {
    return { name: DOE_RATIOS.life_skills.name, ratios: DOE_RATIOS.life_skills.all };
  }
  return { name: DOE_RATIOS.general.name, ratios: DOE_RATIOS.general.all };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      subject, topic, resourceType, language, duration, difficulty,
      includeRubric, diagramCount, diagramType, diagramPlacement,
      grade, term, bloomsMode, bloomsLevels
    } = req.body || {};

    if (!subject || !topic || !resourceType || !language) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const gradeNum = parseInt(grade) || 6;
    const termNum = parseInt(term) || 3;
    const numDiagrams = parseInt(diagramCount) || 0;
    const phase = gradeNum <= 3 ? 'Foundation Phase' : gradeNum <= 6 ? 'Intermediate Phase' : 'Senior Phase';

    const doe = getRatios(subject, gradeNum);

    const diffNote = difficulty === 'below'
      ? 'BELOW grade level — simplified language, scaffolded tasks, introductory exercises (like Platinum textbook starter activities)'
      : difficulty === 'above'
      ? 'ABOVE grade level — multi-step, higher-order, extension tasks (like Platinum textbook challenge/extension exercises)'
      : `ON grade level — standard CAPS expectations (like Platinum textbook core exercises for Grade ${gradeNum})`;

    const textbookNote = gradeNum <= 3
      ? 'Align with Foundation Phase SA resource style (Thelma Res / Spot On). Short, clear, practical.'
      : `Align with Platinum ${subject} Grade ${gradeNum} (Maskew Miller Longman). Match their vocabulary, worked example style, question format, and difficulty progression. Use SA contexts (rands, local names, SA settings).`;

    let bloomsNote = '';
    if (bloomsMode === 'single' && bloomsLevels && bloomsLevels.length > 0) {
      bloomsNote = `Teacher focus: Emphasise ${bloomsLevels[0]} level questions while maintaining DoE ratios.`;
    } else if (bloomsMode === 'mixed' && bloomsLevels && bloomsLevels.length > 0) {
      bloomsNote = `Teacher focus: Blend ${bloomsLevels.join(', ')} levels while maintaining DoE ratios.`;
    }

    const rubricSection = includeRubric
      ? '\n\n═══════════════════════════════════\nMARKING RUBRIC\n═══════════════════════════════════\n[4-level DoE rubric: Level 1 Not achieved, Level 2 Elementary, Level 3 Satisfactory, Level 4 Outstanding. Include criteria matching cognitive levels used.]'
      : '';

    let diagNote = '';
    if (numDiagrams > 0) {
      const placement = diagramPlacement === 'beginning' ? 'before Section A' : diagramPlacement === 'end' ? 'after TOTAL line' : 'inline at relevant questions';
      diagNote = `\nDIAGRAMS: Include ${numDiagrams} SVG diagram(s). Placement: ${placement}. Type: ${diagramType === 'agent' ? 'most appropriate for this topic' : diagramType}. Insert [DIAGRAM_1]${numDiagrams > 1 ? ' [DIAGRAM_2]' : ''} placeholders at correct positions. Each SVG: viewBox="0 0 520 300", white background rect, Arial font, professional colours (#085041 #1D9E75 #185FA5 #BA7517).`;
    }

    const system = `You are an experienced South African ${phase} teacher creating CAPS-aligned resources for The Resource Room.

Style: Warm, professional, sounds like a real SA teacher. Use SA context (rands, Sipho, Ayanda, Lerato, Pieter, tuck shops, SA wildlife). Vary question types. Language: ${language} only.

DoE COGNITIVE LEVELS — ${doe.name}: ${doe.ratios}
Label each section with its cognitive level. Calculate mark split per level from total marks. Show split in teacher instructions.
${bloomsNote}

Difficulty: ${diffNote}
Textbook: ${textbookNote}
ATP: Grade ${gradeNum} Term ${termNum} — ${subject} — ${topic}. Strictly within this term's prescribed content only.
${diagNote}

Return VALID JSON ONLY — no markdown, no preamble:
{"content":"...","diagrams":${numDiagrams > 0 ? '{"diagram1":{"title":"...","caption":"...","svg":"..."}}' : 'null'}}

Content structure:
═══════════════════════════════════
TEACHER INSTRUCTIONS
═══════════════════════════════════
Time: [X min] | Grade ${gradeNum} | Term ${termNum} | ${phase}
Difficulty: [level] | Textbook: ${gradeNum <= 3 ? 'Foundation Phase resources' : 'Platinum ' + subject + ' Gr' + gradeNum}
DoE levels: ${doe.ratios}
Mark split: [show marks per cognitive level based on total]
CAPS reference: Grade ${gradeNum} | Term ${termNum} | [subject] | [topic]
${gradeNum >= 4 ? 'Platinum reference: [chapter/unit in Platinum ' + subject + ' Grade ' + gradeNum + ']\n' : ''}Notes: [2-3 practical preparation notes]

═══════════════════════════════════
THE RESOURCE ROOM — [RESOURCE TYPE]
[Subject] | Grade ${gradeNum} | Term ${termNum} | ${language}
Duration: [time] | Total: [X] marks
═══════════════════════════════════

Learner Name: _________________________________ Date: ____________ Class: _______

[Sections labelled with cognitive level e.g. "SECTION A — Knowledge (20%)". Min 10 questions, marks in brackets, varied types.]

TOTAL: _________ / [X]

═══════════════════════════════════
MEMORANDUM
═══════════════════════════════════
[Numbered answers with marks. Model answers for open-ended. Notes on alternatives.]

Total: [X] marks${rubricSection}

═══════════════════════════════════
EXTENSION / ENRICHMENT ACTIVITY
═══════════════════════════════════
[One higher-order challenge with full answer]`;

    const user = `Create a complete teacher pack:
Subject: ${subject} | Topic: ${topic} | Type: ${resourceType}
Language: ${language} | Grade: ${gradeNum} | Term: ${termNum} | ${phase}
Duration: ${duration || '1 hour, 50 marks'} | Difficulty: ${difficulty || 'on'} grade level
${numDiagrams > 0 ? 'Diagrams: ' + numDiagrams + ' (' + diagramType + ', ' + diagramPlacement + ')' : ''}
${includeRubric ? 'Include DoE rubric.' : ''}
Min 10 questions. Apply DoE cognitive level ratios. Platinum textbook style. SA context. Return valid JSON only.`;

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 5000,
        system,
        messages: [{ role: 'user', content: user }]
      })
    });

    const responseText = await apiRes.text();

    if (!apiRes.ok) {
      let errMsg = 'API error ' + apiRes.status;
      try { errMsg = JSON.parse(responseText).error?.message || errMsg; } catch(e) { errMsg = responseText.substring(0, 300); }
      return res.status(apiRes.status).json({ error: errMsg });
    }

    let raw = '';
    try {
      raw = JSON.parse(responseText).content?.map(c => c.text || '').join('') || '';
    } catch(e) {
      return res.status(500).json({ error: 'Parse failed: ' + responseText.substring(0, 200) });
    }

    const clean = raw.replace(/```json|```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); } catch(e) { parsed = { content: raw, diagrams: null }; }

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
    return res.status(500).json({ error: 'Server error: ' + (err.message || String(err)) });
  }
}
