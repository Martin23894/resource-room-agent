// Test matrix for the v2 pipeline.
//
// Two tiers: CORE (the subjects teachers actually generate assessments
// for) and EXPANSION (FAL languages, Life Skills, Life Orientation).
// Run CORE first — it's the cheapest meaningful sweep.
//
// Combo selection rules:
//   • Term 2 is the canonical term for non-RTT subjects (mid-year, ATP
//     coverage is well-developed, no Term-1-only or Term-4-only edge cases).
//   • Term 4 for languages — RTT exams traditionally land in Term 4.
//   • Resource type: Test (40 marks) for content subjects, Exam (50)
//     for RTT subjects, Worksheet (25) for Life Skills.
//   • English by default; one Afrikaans HL per grade in CORE so we
//     verify localisation doesn't drift across grades.
//
// Cost estimate (Sonnet 4.6, ~$0.12/paper):
//   CORE per grade  ≈  6–8 papers  ≈  $0.75–$1.00
//   CORE all grades ≈  26 papers  ≈  ~$3.10
//   EXPANSION       ≈  16 papers  ≈  ~$2.00
//
// Run only the cells you need: filter by --grade, --subject, --tier
// in spike-runner.js.

const TEST   = (totalMarks = 40) => ({ resourceType: 'Test', totalMarks });
const EXAM   = (totalMarks = 50) => ({ resourceType: 'Exam', totalMarks });
const FINAL  = (totalMarks = 50) => ({ resourceType: 'Final Exam', totalMarks });
const WSHEET = (totalMarks = 25) => ({ resourceType: 'Worksheet', totalMarks });

// Canonical (term × language) per subject. RTT subjects default to
// Term 4 / 50 marks because that's the realistic teacher use case.
const RTT_SUBJECTS = new Set([
  'English Home Language',
  'English First Additional Language',
  'Afrikaans Home Language',
  'Afrikaans First Additional Language',
]);

function canonicalCombo(grade, subject, language = 'English') {
  if (RTT_SUBJECTS.has(subject)) {
    return { ...EXAM(50), term: 4, language };
  }
  // Life Skills variants are Worksheet-shaped in practice.
  if (subject.startsWith('Life Skills')) {
    return { ...WSHEET(25), term: 2, language };
  }
  // Grade 7 Final Exams test the full-paper rendering path.
  if (grade === 7 && subject === 'Economic and Management Sciences') {
    return { ...FINAL(50), term: 4, language };
  }
  return { ...TEST(40), term: 2, language };
}

const CORE_SUBJECTS_BY_GRADE = {
  4: ['Mathematics', 'Natural Sciences and Technology', 'Social Sciences — History',
      'Social Sciences — Geography', 'English Home Language', 'Afrikaans Home Language'],
  5: ['Mathematics', 'Natural Sciences and Technology', 'Social Sciences — History',
      'Social Sciences — Geography', 'English Home Language', 'Afrikaans Home Language'],
  6: ['Mathematics', 'Natural Sciences and Technology', 'Social Sciences — History',
      'Social Sciences — Geography', 'English Home Language', 'Afrikaans Home Language'],
  7: ['Mathematics', 'Natural Sciences', 'Technology', 'Social Sciences — History',
      'Social Sciences — Geography', 'English Home Language', 'Afrikaans Home Language',
      'Economic and Management Sciences'],
};

const EXPANSION_SUBJECTS_BY_GRADE = {
  4: ['English First Additional Language', 'Afrikaans First Additional Language',
      'Life Skills — Personal and Social Wellbeing', 'Life Skills — Creative Arts'],
  5: ['English First Additional Language', 'Afrikaans First Additional Language',
      'Life Skills — Personal and Social Wellbeing', 'Life Skills — Creative Arts'],
  6: ['English First Additional Language', 'Afrikaans First Additional Language',
      'Life Skills — Personal and Social Wellbeing', 'Life Skills — Creative Arts'],
  7: ['English First Additional Language', 'Afrikaans First Additional Language',
      'Life Orientation'],
};

function buildMatrix() {
  const out = [];
  for (const grade of [4, 5, 6, 7]) {
    for (const subject of CORE_SUBJECTS_BY_GRADE[grade]) {
      const combo = canonicalCombo(grade, subject);
      out.push(makeCase('core', grade, subject, combo));
    }
    for (const subject of EXPANSION_SUBJECTS_BY_GRADE[grade]) {
      const combo = canonicalCombo(grade, subject);
      out.push(makeCase('expansion', grade, subject, combo));
    }
  }
  return out;
}

function makeCase(tier, grade, subject, combo) {
  const slug = subject
    .toLowerCase()
    .replace(/—/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const id = `g${grade}-${slug}-${combo.resourceType.toLowerCase().replace(/ /g, '')}-t${combo.term}`;
  return {
    id,
    tier,
    grade,
    subject,
    request: {
      subject,
      grade,
      term: combo.term,
      language: combo.language,
      resourceType: combo.resourceType,
      totalMarks: combo.totalMarks,
      difficulty: 'on',
    },
  };
}

export const TEST_MATRIX = buildMatrix();

// Filtering: pure functions over the matrix array.
export function filterMatrix({ grade, subject, tier, resourceType, language } = {}) {
  return TEST_MATRIX.filter((c) => {
    if (tier && tier !== 'all' && c.tier !== tier) return false;
    if (grade != null && c.grade !== Number(grade)) return false;
    if (subject && !c.subject.toLowerCase().includes(String(subject).toLowerCase())) return false;
    if (resourceType && c.request.resourceType !== resourceType) return false;
    if (language && c.request.language !== language) return false;
    return true;
  });
}

// Convenience: how many API calls would a given filter trigger,
// at the given sample count? Used by the runner's --dry-run.
export function estimateCost(cases, samples = 1, costPerCall = 0.12) {
  const calls = cases.length * samples;
  return { calls, dollars: (calls * costPerCall).toFixed(2) };
}
