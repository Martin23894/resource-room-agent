// Grade 5 Afrikaans Huistaal — Reaksie-op-Teks — Kwartaal 2
// 20 punte | Barrett se Taksonomie | Termomvang: Kwartaal 1–2
// Twee afdelings: BEGRIP (12) + TAALSTRUKTURE EN -KONVENSIES (8)

export default {
  meta: {
    schemaVersion: '1.0',
    subject: 'Afrikaans Home Language',
    grade: 5,
    term: 2,
    language: 'Afrikaans',
    resourceType: 'Exam',
    totalMarks: 20,
    difficulty: 'on',
    duration: { minutes: 30 },
    cognitiveFramework: {
      name: "Barrett's",
      levels: [
        { name: 'Literal',                    percent: 20, prescribedMarks: 4 },
        { name: 'Reorganisation',             percent: 20, prescribedMarks: 4 },
        { name: 'Inferential',                percent: 40, prescribedMarks: 8 },
        { name: 'Evaluation and Appreciation',percent: 20, prescribedMarks: 4 },
      ],
    },
    topicScope: {
      coversTerms: [1, 2],
      topics: [
        'Lees en kyk — letterkundige teks',
        'Taalstrukture en -konvensies — woordsoorte',
        'Taalstrukture en -konvensies — sinne',
        'Taalstrukture en -konvensies — leestekens',
      ],
    },
  },

  cover: {
    resourceTypeLabel: 'EKSAMEN',
    subjectLine: 'Afrikaans Huistaal',
    gradeLine: 'Graad 5',
    termLine: 'Kwartaal 2',
    learnerInfoFields: [
      { kind: 'name',     label: 'Naam' },
      { kind: 'surname',  label: 'Van' },
      { kind: 'date',     label: 'Datum' },
      { kind: 'examiner', label: 'Eksaminator' },
      { kind: 'time',     label: 'Tyd' },
      { kind: 'total',    label: 'Totaal' },
    ],
    instructions: {
      heading: 'Instruksies',
      items: [
        'Lees die vrae behoorlik.',
        'Beantwoord AL die vrae.',
        'Wys alle bewerkings waar nodig.',
        'Gee besondere aandag aan die puntetoekenning van elke vraag.',
      ],
    },
  },

  stimuli: [
    {
      id: 'leestuk',
      kind: 'passage',
      heading: 'LEESSTUK',
      wordCount: 131,
      body: `Elke Saterdag het Mia en haar ouma saam mark toe gegaan. Die mark was vol kleure, reuke en stemme. Ouma het altyd by die groentestraatjie begin, waar sy vars wortels, spinasie en pampoen gekies het.

Op 'n dag het Mia 'n klein, maer hondjie tussen die stalletjies opgemerk. Sy groot, bruin oë het Mia stip aangekyk. Mia se hart het weggesmelt. "Ouma, kyk hoe lyk hy," het sy gefluister.

Ouma het gekniel en die hondjie versigtig ondersoek. Hy het geen halsband gehad nie. "Hy is alleen," het Ouma gesê. "Ons kan hom nie hier los nie."

Mia het haar arms om die hondjie geslaan. Hy het sy stert bly gewaai. Hulle het hom huis toe geneem en hom Wors genoem — want hy was so lank en dun soos 'n wors. Wors het gou deel van die gesin geword, en elke Saterdag het hy saam mark toe gegaan.`,
    },
  ],

  sections: [
    {
      letter: 'A',
      title: 'AFDELING A: BEGRIP',
      stimulusRefs: ['leestuk'],
      questions: [
        {
          number: '1.1',
          type: 'ShortAnswer',
          topic: 'Lees en kyk — letterkundige teks',
          stem: 'Waarheen het Mia en haar ouma elke Saterdag gegaan?',
          stimulusRef: 'leestuk',
          marks: 1,
          cognitiveLevel: 'Literal',
          answerSpace: { kind: 'lines', lines: 2 },
        },
        {
          number: '1.2',
          type: 'ShortAnswer',
          topic: 'Lees en kyk — letterkundige teks',
          stem: 'Noem TWEE produkte wat Ouma by die groentestraatjie gekies het.',
          stimulusRef: 'leestuk',
          marks: 2,
          cognitiveLevel: 'Literal',
          answerSpace: { kind: 'lines', lines: 2 },
        },
        {
          number: '1.3',
          type: 'Describe',
          topic: 'Lees en kyk — letterkundige teks',
          stem: 'Beskryf hoe die hondjie gelyk het toe Mia hom eerste gesien het. Gebruik besonderhede uit die teks.',
          stimulusRef: 'leestuk',
          marks: 2,
          cognitiveLevel: 'Reorganisation',
          answerSpace: { kind: 'lines', lines: 3 },
        },
        {
          number: '1.4',
          type: 'Explain',
          topic: 'Lees en kyk — letterkundige teks',
          stem: 'Verduidelik hoekom Ouma gesê het: "Ons kan hom nie hier los nie." Wat dink jy het sy bedoel?',
          stimulusRef: 'leestuk',
          marks: 3,
          cognitiveLevel: 'Inferential',
          answerSpace: { kind: 'lines', lines: 4 },
        },
        {
          number: '1.5',
          type: 'Explain',
          topic: 'Lees en kyk — letterkundige teks',
          stem: 'Waarom dink jy het Mia en Ouma die hondjie "Wors" genoem? Gebruik die teks om jou antwoord te staaf.',
          stimulusRef: 'leestuk',
          marks: 2,
          cognitiveLevel: 'Inferential',
          answerSpace: { kind: 'lines', lines: 3 },
        },
        {
          number: '1.6',
          type: 'Explain',
          topic: 'Lees en kyk — letterkundige teks',
          stem: 'Mia se hart het "weggesmelt" toe sy die hondjie gesien het. Wat sê dit vir jou oor Mia se karakter? Motiveer jou antwoord.',
          stimulusRef: 'leestuk',
          marks: 2,
          cognitiveLevel: 'Evaluation and Appreciation',
          answerSpace: { kind: 'lines', lines: 4 },
        },
      ],
    },
    {
      letter: 'B',
      title: 'AFDELING B: TAALSTRUKTURE EN -KONVENSIES',
      questions: [
        {
          number: '2.1',
          type: 'PartOfSpeech',
          topic: 'Taalstrukture en -konvensies — woordsoorte',
          stem: 'Identifiseer die woordsoort van die onderstreepte woord in die volgende sin: "Mia het die _klein_ hondjie gesien."',
          marks: 1,
          cognitiveLevel: 'Literal',
          answerSpace: { kind: 'lines', lines: 1 },
        },
        {
          number: '2.2',
          type: 'TenseChange',
          topic: 'Taalstrukture en -konvensies — sinne',
          stem: 'Herskryf die volgende sin in die teenwoordige tyd:\n"Ouma het die vars groente by die mark gekoop."',
          marks: 2,
          cognitiveLevel: 'Reorganisation',
          answerSpace: { kind: 'lines', lines: 2 },
        },
        {
          number: '2.3',
          type: 'IndirectSpeech',
          topic: 'Taalstrukture en -konvensies — sinne',
          stem: 'Herskryf die volgende direkte rede as indirekte rede:\nMia sê: "Ek wil die hondjie huis toe neem."',
          marks: 3,
          cognitiveLevel: 'Inferential',
          answerSpace: { kind: 'lines', lines: 3 },
        },
        {
          number: '2.4',
          type: 'Punctuation',
          topic: 'Taalstrukture en -konvensies — leestekens',
          stem: 'Skryf die volgende sin oor en voeg die korrekte leestekens in:\nouma het gesê ons neem hom saam na die huis',
          marks: 2,
          cognitiveLevel: 'Evaluation and Appreciation',
          answerSpace: { kind: 'lines', lines: 2 },
        },
      ],
    },
  ],

  memo: {
    answers: [
      {
        questionNumber: '1.1',
        answer: 'Mia en haar ouma het elke Saterdag mark toe gegaan.',
        markingGuidance: '1 punt vir korrekte antwoord. Aanvaar enige redelike omskrywing.',
        cognitiveLevel: 'Literal',
        marks: 1,
      },
      {
        questionNumber: '1.2',
        answer: 'Enige twee van: wortels / spinasie / pampoen.',
        markingGuidance: '1 punt elk vir twee korrekte produkte. Maksimum 2 punte.',
        cognitiveLevel: 'Literal',
        marks: 2,
      },
      {
        questionNumber: '1.3',
        answer: 'Die hondjie was klein en maer. Hy het groot, bruin oë gehad.',
        markingGuidance: '1 punt vir klein/maer; 1 punt vir groot/bruin oë. Leerder moet teksbewyse gebruik.',
        cognitiveLevel: 'Reorganisation',
        marks: 2,
      },
      {
        questionNumber: '1.4',
        answer: 'Ouma het bedoel dat die hondjie verlore en alleen was en iemand nodig gehad het om na hom om te sien. Sy het gevoel dit sou wreed wees om hom agter te laat.',
        markingGuidance: '1 punt vir idee van alleenheid/verlatenheid; 1 punt vir begrip van sorg/verantwoordelikheid; 1 punt vir redelike motivering. Aanvaar enige goed beredeneerde antwoord.',
        cognitiveLevel: 'Inferential',
        marks: 3,
      },
      {
        questionNumber: '1.5',
        answer: "Hulle het hom Wors genoem omdat hy so lank en dun soos 'n wors was (soos in die teks gesê word).",
        markingGuidance: '1 punt vir verband met lengte/dunheid; 1 punt vir verwysing na teks. Direkte aanhaling of parafrasering aanvaar.',
        cognitiveLevel: 'Inferential',
        marks: 2,
      },
      {
        questionNumber: '1.6',
        answer: "Die uitdrukking toon dat Mia 'n saggeaarde, medelydende kind is wat maklik omgee vir diere wat hulp nodig het.",
        markingGuidance: '1 punt vir identifisering van karaktereienskap (bv. saggeaard/medelydend); 1 punt vir motivering met teksbewyse. Aanvaar enige redelik-gemotiveerde antwoord.',
        cognitiveLevel: 'Evaluation and Appreciation',
        marks: 2,
      },
      {
        questionNumber: '2.1',
        answer: 'Byvoeglike naamwoord (adjektief).',
        markingGuidance: '1 punt vir korrekte woordsoort. Aanvaar "adjektief" of "byvoeglike naamwoord".',
        cognitiveLevel: 'Literal',
        marks: 1,
      },
      {
        questionNumber: '2.2',
        answer: 'Ouma koop die vars groente by die mark.',
        markingGuidance: '1 punt vir korrekte werkwoordvorm (koop); 1 punt vir volledige korrekte sin sonder ander foute.',
        cognitiveLevel: 'Reorganisation',
        marks: 2,
      },
      {
        questionNumber: '2.3',
        answer: 'Mia sê dat sy die hondjie huis toe wil neem.',
        markingGuidance: '1 punt vir "dat"-konstruksie; 1 punt vir korrekte voornaamwoordverandering (ek→sy); 1 punt vir korrekte werkwoordorde. Maksimum 3 punte.',
        cognitiveLevel: 'Inferential',
        marks: 3,
      },
      {
        questionNumber: '2.4',
        answer: 'Ouma het gesê: "Ons neem hom saam na die huis."',
        markingGuidance: '1 punt vir hoofletters (Ouma); 1 punt vir korrekte leestekens (dubbelpunt en aanhalingstekens). Aanvaar ook punt na aanhalingsteken binne die aanhaling.',
        cognitiveLevel: 'Evaluation and Appreciation',
        marks: 2,
      },
    ],
  },
};
