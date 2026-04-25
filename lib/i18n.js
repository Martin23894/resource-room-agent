// Simple two-language i18n for DOCX labels and subject display names.
// Used for anything that is rendered by the DOCX builder or appears in prompts
// directing Claude to write labels (e.g. the TOTAL line, memo column headers).
//
// The ATP data keeps subject names in English so it can be used as a stable
// lookup key; only the displayed name on the cover page is translated.

const STRINGS = {
  English: {
    // Resource-type labels shown on the cover (upper-cased)
    resourceTypes: {
      Test: 'TEST',
      Exam: 'EXAM',
      'Final Exam': 'FINAL EXAM',
      Worksheet: 'WORKSHEET',
      Project: 'PROJECT',
      Practical: 'PRACTICAL',
      Assignment: 'ASSIGNMENT',
      Investigation: 'INVESTIGATION',
    },

    // Cover-page labels
    grade: 'Grade',
    term: 'Term',
    name: 'Name',
    surname: 'Surname',
    date: 'Date',
    examiner: 'Examiner',
    time: 'Time',
    total: 'Total',
    comments: 'Comments',
    code: 'Code',

    // Instructions block
    instructions: 'Instructions',
    instructionItems: [
      'Read the questions properly.',
      'Answer ALL the questions.',
      'Show all working where required.',
      'Pay special attention to the mark allocation of each question.',
    ],

    // Worksheet cover
    worksheetTitle: 'Worksheet',

    // Totals / marks
    totalLabel: 'TOTAL',
    marksWord: 'marks',

    // "Answer: ___" / "Working: ___" labels used on the QUESTION PAPER
    // (separate from the memo column headers below). Used by the answer-
    // space helper to localise the injected answer-line stub.
    answerLabel: 'Answer',
    workingLabel: 'Working',

    // RTT pipeline memo header strings (assembled into the combined memo)
    rttMemo: {
      heading: 'MEMORANDUM',
      subtitle: (g, subj, t) => `Grade ${g} ${subj} — Response to Text — Term ${t}`,
      framework: "CAPS Aligned | Barrett's Taxonomy Framework",
    },

    // Memo table column headers (used in prompts so Claude emits these exact strings)
    memo: {
      no: 'NO.',
      answer: 'ANSWER',
      guidance: 'MARKING GUIDANCE',
      cogLevel: 'COGNITIVE LEVEL',
      mark: 'MARK',
    },
  },

  Afrikaans: {
    resourceTypes: {
      Test: 'TOETS',
      Exam: 'EKSAMEN',
      'Final Exam': 'EINDEKSAMEN',
      Worksheet: 'WERKBLAD',
      Project: 'PROJEK',
      Practical: 'PRAKTIESE',
      Assignment: 'OPDRAG',
      Investigation: 'ONDERSOEK',
    },

    grade: 'Graad',
    term: 'Kwartaal',
    name: 'Naam',
    surname: 'Van',
    date: 'Datum',
    examiner: 'Eksaminator',
    time: 'Tyd',
    total: 'Totaal',
    comments: 'Opmerkings',
    code: 'Kode',

    instructions: 'Instruksies',
    instructionItems: [
      'Lees die vrae behoorlik.',
      'Beantwoord AL die vrae.',
      'Wys alle bewerkings waar nodig.',
      'Gee besondere aandag aan die puntetoekenning van elke vraag.',
    ],

    worksheetTitle: 'Werkblad',

    totalLabel: 'TOTAAL',
    marksWord: 'punte',

    answerLabel: 'Antwoord',
    workingLabel: 'Werking',

    rttMemo: {
      heading: 'MEMORANDUM',
      subtitle: (g, subj, t) => `Graad ${g} ${subj} — Reaksie op Teks — Kwartaal ${t}`,
      framework: "CAPS-belyn | Barrett se Taksonomie-raamwerk",
    },

    memo: {
      no: 'NR.',
      answer: 'ANTWOORD',
      guidance: 'NASIENRIGLYN',
      cogLevel: 'KOGNITIEWE VLAK',
      mark: 'PUNT',
    },
  },
};

/** Return the label bundle for a language. Falls back to English. */
export function i18n(language) {
  return STRINGS[language] || STRINGS.English;
}

/** Translate a resource type string using the language's resourceTypes map. */
export function resourceTypeLabel(resourceType, language) {
  const t = i18n(language);
  return t.resourceTypes[resourceType] || String(resourceType || '').toUpperCase();
}

// Display names for the Afrikaans subject cover page. The ATP keeps English
// keys so the lookup table is keyed by the canonical English name.
const SUBJECT_DISPLAY = {
  Afrikaans: {
    'Mathematics': 'Wiskunde',
    'Natural Sciences and Technology': 'Natuurwetenskappe en Tegnologie',
    'Natural Sciences': 'Natuurwetenskappe',
    'Technology': 'Tegnologie',
    'Social Sciences — History': 'Sosiale Wetenskappe — Geskiedenis',
    'Social Sciences — Geography': 'Sosiale Wetenskappe — Geografie',
    'English Home Language': 'Engels Huistaal',
    'English First Additional Language': 'Engels Eerste Addisionele Taal',
    'Afrikaans Home Language': 'Afrikaans Huistaal',
    'Afrikaans First Additional Language': 'Afrikaans Eerste Addisionele Taal',
    'Life Skills — Personal and Social Wellbeing': 'Lewensvaardighede — Persoonlike en Sosiale Welstand',
    'Life Skills — Physical Education': 'Lewensvaardighede — Liggaamsopvoeding',
    'Life Skills — Creative Arts': 'Lewensvaardighede — Skeppende Kunste',
    'Life Orientation': 'Lewensoriëntering',
    'Economic and Management Sciences': 'Ekonomiese en Bestuurswetenskappe',
  },
};

/** Return the displayed subject name for a language; falls back to the input. */
export function subjectDisplayName(subject, language) {
  return SUBJECT_DISPLAY[language]?.[subject] || subject;
}

/** Translate an English duration string ("1 hour 30 minutes") to the language. */
export function localiseDuration(english, language) {
  if (language !== 'Afrikaans') return english;
  return english
    .replace(/\bminutes\b/g, 'minute')
    .replace(/\bminute\b/g, 'minute')
    .replace(/\bhours?\b/g, 'uur');
}
