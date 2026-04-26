// Simple two-language i18n for DOCX labels and subject display names.
// Used for anything that is rendered by the DOCX builder or appears in prompts
// directing Claude to write labels (e.g. the TOTAL line, memo column headers).
//
// The ATP data keeps subject names in English so it can be used as a stable
// lookup key; only the displayed name on the cover page is translated.
//
// COG_LEVEL_ALIASES (exported below) carries the alternate spellings the
// model emits in production that aren't the canonical translation. The
// audit (Resource 3) caught Claude writing "Reorganisasie" in an
// Afrikaans memo where i18n's canonical translation is "Herorganisasie".
// Without an alias entry, levelMatcher and normaliseCogLevelLabels treat
// the row as an unknown level and silently drop it from the cog tally.

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

    // Combined Barrett's table strings used in the RTT Phase 3D prompt so
    // Claude emits the correct language headings in the final analysis table.
    barretts: {
      combinedHeading: (marks) => `COMBINED BARRETT'S TAXONOMY ANALYSIS — FULL PAPER (${marks} marks)`,
      columns: "| Barrett's Level | Prescribed % | Prescribed Marks | Actual Marks | Actual % |",
      levels: ['Literal', 'Reorganisation', 'Inferential', 'Evaluation and Appreciation'],
    },

    // Memo table column headers (used in prompts so Claude emits these exact strings)
    memo: {
      no: 'NO.',
      answer: 'ANSWER',
      guidance: 'MARKING GUIDANCE',
      cogLevel: 'COGNITIVE LEVEL',
      mark: 'MARK',
    },

    // Cog analysis table strings — used by the deterministic emitter in
    // lib/cog-table.js. The Bloom's variant (`bloom`) heads with COGNITIVE
    // LEVEL ANALYSIS; the Barrett's variant uses the COMBINED BARRETT'S
    // analysis heading (RTT pipeline).
    cogTable: {
      heading: (framework) => `COGNITIVE LEVEL ANALYSIS (${framework})`,
      cols: {
        level: 'Cognitive Level',
        pct: 'Prescribed %',
        prescribed: 'Prescribed Marks',
        actual: 'Actual Marks',
        actualPct: 'Actual %',
      },
      barrettCols: {
        level: "Barrett's Level",
        pct: 'Prescribed %',
        prescribed: 'Prescribed Marks',
        actual: 'Actual Marks',
        actualPct: 'Actual %',
      },
    },

    // Canonical English → display-language level name lookup. The
    // pipeline always carries cog.levels in English (see lib/cognitive.js);
    // when emitting an Afrikaans memo we translate via this table.
    cogLevels: {
      // Bloom's Maths
      Knowledge: 'Knowledge',
      'Routine Procedures': 'Routine Procedures',
      'Complex Procedures': 'Complex Procedures',
      'Problem Solving': 'Problem Solving',
      // Generic Bloom's
      'Low Order': 'Low Order',
      'Middle Order': 'Middle Order',
      'High Order': 'High Order',
      // Barrett's
      Literal: 'Literal',
      Reorganisation: 'Reorganisation',
      Inferential: 'Inferential',
      'Evaluation and Appreciation': 'Evaluation and Appreciation',
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

    barretts: {
      combinedHeading: (marks) => `GEKOMBINEERDE BARRETT SE TAKSONOMIE-ONTLEDING — VOLLEDIGE VRAESTEL (${marks} punte)`,
      columns: '| Barrett se Vlak | Voorgeskrewe % | Voorgeskrewe Punte | Werklike Punte | Werklike % |',
      levels: ['Letterlik', 'Herorganisasie', 'Inferensieel', 'Evaluering en Waardering'],
    },

    memo: {
      no: 'NR.',
      answer: 'ANTWOORD',
      guidance: 'NASIENRIGLYN',
      cogLevel: 'KOGNITIEWE VLAK',
      mark: 'PUNT',
    },

    cogTable: {
      heading: (framework) => `KOGNITIEWE VLAK-ANALISE (${framework})`,
      cols: {
        level: 'Kognitiewe Vlak',
        pct: 'Voorgeskrewe %',
        prescribed: 'Voorgeskrewe Punte',
        actual: 'Werklike Punte',
        actualPct: 'Werklike %',
      },
      barrettCols: {
        level: 'Barrett se Vlak',
        pct: 'Voorgeskrewe %',
        prescribed: 'Voorgeskrewe Punte',
        actual: 'Werklike Punte',
        actualPct: 'Werklike %',
      },
    },

    cogLevels: {
      // Bloom's Maths
      Knowledge: 'Kennis',
      'Routine Procedures': 'Roetine Prosedures',
      'Complex Procedures': 'Komplekse Prosedures',
      'Problem Solving': 'Probleemoplossing',
      // Generic Bloom's
      'Low Order': 'Lae Orde',
      'Middle Order': 'Middel Orde',
      'High Order': 'Hoë Orde',
      // Barrett's
      Literal: 'Letterlik',
      Reorganisation: 'Herorganisasie',
      Inferential: 'Inferensieel',
      'Evaluation and Appreciation': 'Evaluering en Waardering',
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

/**
 * Alternate spellings the model emits that aren't the canonical i18n
 * translation. Each entry maps a canonical English level name to an array
 * of accepted aliases. levelMatcher and normaliseCogLevelLabels treat
 * these aliases as equivalent to the canonical / translation forms.
 *
 * Add to this map (rather than to translations[]) when production output
 * shows a spelling variant that should be recognised but is NOT the
 * preferred display form. The display still uses translations[]; the
 * alias list is recognition-only.
 */
export const COG_LEVEL_ALIASES = {
  // Audit Resource 3 — Afrikaans Barrett's: Claude writes "Reorganisasie"
  // (anglicised) but the canonical Afrikaans is "Herorganisasie".
  Reorganisation: ['Reorganisasie'],
  // Defensive: Bloom's Maths sometimes loses the 's' in Afrikaans —
  // "Roetine Prosedure" vs canonical "Roetine Prosedures".
  'Routine Procedures': ['Roetine Prosedure'],
  'Complex Procedures': ['Komplekse Prosedure'],
};
