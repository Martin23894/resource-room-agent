import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, TabStopType,
  ShadingType, Header, Footer
} from 'docx';
 
// ============================================================
// ATP TOPIC DATABASE — sourced from official DBE ATP documents
// Grades 4–7, all subjects, all 4 terms
// ============================================================
const ATP = {
  'Mathematics': {
    4: {
      1: ['Whole numbers: counting, ordering, comparing, representing and place value (up to 4-digit numbers)', 'Whole numbers: properties of operations (commutative, associative, distributive)', 'Number sentences: writing and solving', 'Whole numbers: addition and subtraction of at least 4-digit numbers', 'Whole numbers: multiplication of 2-digit by 2-digit numbers', 'Whole numbers: multiples and factors'],
      2: ['Whole numbers: division of 3-digit by 1-digit numbers', 'Whole numbers: solving problems in context (financial, measurement, ratio, rate)', 'Geometric patterns: investigating and extending', 'Numeric patterns: sequences with constant difference or ratio', 'Input and output values: flow diagrams and tables', 'Properties of 2D shapes: triangles, squares, rectangles, quadrilaterals, pentagons, hexagons, heptagons, circles', 'Symmetry: lines of symmetry in 2D shapes', 'Properties of 3D objects: rectangular prisms, spheres, cylinders, pyramids'],
      3: ['Common fractions: describing, ordering and comparing (halves, thirds, quarters, fifths, sixths, sevenths, eighths)', 'Common fractions: addition with same denominators', 'Common fractions: equivalent forms', 'Common fractions: solving problems involving grouping and equal sharing', 'Data cycle: collecting, organising, representing and interpreting data', 'Graphs: pictographs and bar graphs', 'Mass: practical measuring in grams and kilograms', 'Transformations: composite shapes and tessellations'],
      4: ['Time: reading analogue and digital clocks in 12-hour and 24-hour format', 'Time: reading calendars and calculating time intervals', 'Length: practical measuring in mm, cm, m, km; converting between units', 'Perimeter: measuring using rulers and measuring tapes', 'Area: finding areas by counting squares on grids', 'Volume and capacity: measuring in ml and litres, converting between units'],
    },
    5: {
      1: ['Whole numbers: counting, ordering, comparing, representing and place value (up to at least 6-digit numbers)', 'Whole numbers: prime numbers to at least 100', 'Whole numbers: addition and subtraction of at least 5-digit numbers', 'Whole numbers: properties of operations', 'Whole numbers: multiplication of 3-digit by 2-digit numbers', 'Whole numbers: multiples and factors of 3-digit numbers', 'Whole numbers: solving problems in context (financial, measurement, ratio, rate)'],
      2: ['Whole numbers: division of 4-digit by 2-digit numbers', 'Number sentences: writing and solving', 'Numeric patterns and geometric patterns: investigating and extending, input/output values', 'Common fractions: comparing, ordering, addition and subtraction with like and unlike denominators', 'Percentages of whole numbers', 'Decimal fractions: counting forwards and backwards to 2 decimal places', 'Decimal fractions: addition and subtraction to 2 decimal places; multiply by 10 and 100', 'Equivalent forms: fractions, decimals and percentages'],
      3: ['Length: practical measuring in mm, cm, m, km; converting between units (fractions and decimals to 2 decimal places)', 'Properties of 2D shapes: regular and irregular polygons, angles (acute, right, obtuse, straight, reflex, revolution)', 'Symmetry: lines of symmetry in 2D shapes', 'Transformations: rotation, translation, reflection; composite shapes and tessellations', 'Properties of 3D objects: cubes, rectangular prisms, cylinders, cones, spheres, pyramids'],
      4: ['Mass: practical measuring in grams and kilograms; converting including fractions and decimals', 'Temperature: reading thermometers in degrees Celsius', 'Time: reading clocks; calculating time intervals; reading time zones', 'Capacity and volume: measuring in ml, litres and kilolitres', 'Data handling: collecting, organising and summarising data', 'Graphs: pictographs, bar graphs, double bar graphs, pie charts', 'Data: mode and median, drawing conclusions and making predictions', 'Probability: prediction, likelihood, simple experiments'],
    },
    6: {
      1: ['Whole numbers: counting, ordering, comparing, representing and place value (up to at least 9-digit numbers)', 'Whole numbers: prime numbers to at least 100', 'Whole numbers: addition and subtraction of at least 6-digit numbers', 'Whole numbers: properties of operations', 'Whole numbers: multiplication of at least 4-digit by 3-digit numbers', 'Whole numbers: multiples and factors; LCM and HCF', 'Whole numbers: division of at least 4-digit by 3-digit numbers', 'Whole numbers: solving problems in context (financial, ratio, rate, grouping, sharing)'],
      2: ['Number sentences: writing and solving', 'Numeric and geometric patterns: sequences, input/output values, equivalent forms', 'Common fractions: comparing, ordering, addition and subtraction (like and unlike denominators)', 'Common fractions: mixed numbers, fractions of whole numbers', 'Percentages of whole numbers', 'Equivalent forms: fractions, decimals and percentages', 'Decimal fractions: counting to at least 3 decimal places', 'Decimal fractions: addition and subtraction to 3 decimal places; multiply by 10 and 100'],
      3: ['Length: practical measuring in mm, cm, m, km; converting between units (fractions and decimals to 2 decimal places)', 'Properties of 2D shapes: regular and irregular polygons including parallelograms', 'Angles: acute, right, obtuse, straight, reflex, revolution', 'Symmetry: lines of symmetry in 2D shapes', 'Transformations: rotation, translation, reflection; composite shapes and tessellations', 'Properties of 3D objects: cubes, rectangular prisms, cylinders, cones, spheres, pyramids'],
      4: ['Mass: practical measuring in grams and kilograms; converting (fractions and decimals to 2 decimal places)', 'Time: reading clocks; calculating intervals; reading time zone maps', 'Capacity and volume: measuring in ml, litres and kilolitres; converting (fractions and decimals)', 'Data handling: collecting, organising and recording data', 'Graphs: pictographs (many-to-one), bar graphs, double bar graphs, pie charts', 'Data: mode and median, drawing conclusions, making predictions', 'Solving problems in context using all four operations with whole numbers and fractions'],
    },
    7: {
      1: ['Whole numbers: ordering, comparing; properties of operations; calculation techniques including long division', 'Whole numbers: prime factors, LCM and HCF', 'Whole numbers: solving problems (ratio, rate, profit, loss, discount, budgets, simple interest)', 'Common fractions: ordering to thousandths; addition, subtraction and multiplication including mixed numbers', 'Percentages: calculate percentage of a whole; percentage increase and decrease', 'Decimal fractions: ordering to at least 3 decimal places; addition, subtraction, multiplication and division', 'Equivalent forms: fractions, decimals and percentages'],
      2: ['Exponents: squares to 12² and square roots; cubes to 6³ and cube roots', 'Exponents: representing numbers in exponential form; calculations using laws of exponents', 'Integers: counting, ordering, comparing; addition and subtraction of integers', 'Integers: properties (commutative and associative)', 'Numeric and geometric patterns: investigating, extending and describing general rules', 'Functions and relationships: input/output values; flow diagrams, tables, formulae, number sentences'],
      3: ['Construction of geometric figures: measuring and classifying angles (acute, right, obtuse, straight, reflex)', 'Construction: accurately constructing angles, parallel and perpendicular lines using compass, ruler and protractor', 'Circle: parts — centre, radius, diameter, circumference, chord', 'Geometry of straight lines: line segment, ray, straight line, parallel lines, perpendicular lines', 'Geometry of 2D shapes: triangles (equilateral, isosceles, right-angled); quadrilaterals (sides, angles, parallel and perpendicular sides)', 'Similar and congruent 2D shapes', 'Transformation geometry: translations, reflections and rotations on squared paper; lines of symmetry', 'Enlargements and reductions on squared paper'],
      4: ['Area and perimeter: perimeter of regular and irregular polygons; formulae for squares, rectangles and triangles', 'Area and perimeter: conversions between mm², cm² and m²', 'Surface area and volume: formulae for cubes and rectangular prisms; conversions mm³/cm³/m³; 1 cm³ = 1 ml', 'Data handling: collecting, organising and representing data (tally marks, tables, stem-and-leaf, grouped data)', 'Data: mean, median, mode, range', 'Graphs: bar graphs, double bar graphs, histograms with given intervals, pie charts', 'Data: critically analysing and interpreting; drawing conclusions; identifying sources of error and bias'],
    },
  },
 
  'Natural Sciences and Technology': {
    4: {
      1: ['Life and Living — Living and non-living things: seven life processes, parts of plants and animals', 'Life and Living — Structure of plants: roots, stems, leaves, flowers, fruits, seeds', 'Life and Living — Structure of animals: head, tail, body, limbs, sense organs', 'Life and Living — What plants need to grow: germination, conditions for growth (light, water, air)', 'Life and Living — Habitats of animals: different habitats (grassland, forest, river, sea), needs of animals', 'Life and Living — Structures for animal shelters: natural and human-made shelters, frame and shell structures'],
      2: ['Energy and Change — Energy and energy transfer: energy for life, energy from the Sun, food chains/energy chains', 'Energy and Change — Energy around us: types of energy, input and output energy of machines and appliances', 'Energy and Change — Movement and energy in a system: musical instruments use movement to make sound', 'Energy and Change — Energy and sound: vibrations, making sounds louder and higher/lower, noise pollution'],
      3: ['Matter and Materials — Materials around us: solids, liquids and gases; changes of state; the water cycle', 'Matter and Materials — Solid materials: raw and manufactured materials, properties of materials', 'Matter and Materials — Strengthening materials: ways to strengthen paper (folding, tubing)', 'Matter and Materials — Strong frame structures: struts, triangular shapes, indigenous structures (Zulu hut, Xhosa rondavel)'],
      4: ['Earth and Beyond — Planet Earth: layers of the Earth, the atmosphere', 'Earth and Beyond — Renewable and non-renewable resources: fossil fuels, energy sources', 'Earth and Beyond — Soil: composition, types, importance to living things', 'Earth and Beyond — The Solar System: Sun, eight planets (Mercury, Venus, Earth, Mars, Asteroid Belt, Jupiter, Saturn, Uranus, Neptune), moons'],
    },
    5: {
      1: ['Life and Living — Plants and animals on Earth: biodiversity, interdependence; South African indigenous plants and animals', 'Life and Living — Animal skeletons: vertebrate skeletons as frame structures; invertebrate exoskeletons as shell structures', 'Life and Living — Skeletons as structures: frame and shell structures in technology applications', 'Life and Living — Food chains: feeding relationships, producers, consumers, herbivores, carnivores, omnivores, decomposers', 'Life and Living — Life cycles: four stages of life cycles of animals and plants'],
      2: ['Energy and Change — Stored energy in fuels: fuels (wood, coal, candle wax, petrol, paraffin, gas), burning fuels, fire safety', 'Energy and Change — Cells and batteries: electrical circuits, simple circuits, source of energy', 'Energy and Change — Energy and electricity: power stations, coal-fired power, pylons, substations, electricity in homes', 'Energy and Change — Elastic and springs: stored energy changed to movement energy'],
      3: ['Matter and Materials — Mixtures: physical mixtures, methods of separation (filtering, sieving, magnetism, evaporation, distillation)', 'Matter and Materials — Solutions: dissolving, soluble and insoluble substances, saturated solutions', 'Matter and Materials — Structures for carrying loads: bridges, strength and stability, investigating structures (paper bridges)'],
      4: ['Earth and Beyond — Planet Earth: lithosphere, hydrosphere, atmosphere, biosphere', 'Earth and Beyond — Soil formation: weathering, erosion, soil types, soil profile', 'Earth and Beyond — The Moon: orbit, phases of the Moon, effect on tides', 'Earth and Beyond — Stars: the Sun as a star, constellations'],
    },
    6: {
      1: ['Life and Living — Photosynthesis: how plants make food (chlorophyll, sunlight, water, carbon dioxide, oxygen)', 'Life and Living — Respiration: how living things release energy from food', 'Life and Living — Food webs: multiple food chains; producers, consumers, decomposers in an ecosystem', 'Life and Living — Ecosystems: grassland, river and pond ecosystems; living and non-living things', 'Life and Living — Nutrients and food: balanced diet, food groups, food processing methods'],
      2: ['Energy and Change — Electrical circuits: series circuits, components (cells, bulbs, switches, conducting wires, buzzers)', 'Energy and Change — Systems to solve problems: electric circuits used to solve practical problems (e.g. steady hand game, lighthouse)', 'Energy and Change — Mains electricity: fossil fuels and electricity generation, cost of electricity, renewable energy (wind, solar, hydro)'],
      3: ['Matter and Materials — Properties of materials: properties determine suitability for use', 'Matter and Materials — Separating mixtures: filtration, evaporation, distillation, chromatography, magnetism', 'Matter and Materials — Sorting and recycling materials: waste management and environmental responsibility', 'Earth and Beyond — The Solar System: Sun, eight planets, features, size, distance from Sun', 'Earth and Beyond — The Moon: orbit, phases, gravity, tides'],
      4: ['Earth and Beyond — Stars and galaxies: constellations, galaxies, the universe', 'Life and Living — Adaptation: how living things are suited to their environments', 'Life and Living — Biomes of South Africa: grassland, forest, desert, fynbos, savanna'],
    },
  },
 
  'Natural Sciences': {
    7: {
      1: ['Life and Living — The biosphere: lithosphere, hydrosphere, atmosphere; all living organisms', 'Life and Living — Biodiversity: classification of living things, five Kingdoms (Bacteria, Protista, Fungi, Plants, Animals)', 'Life and Living — Diversity of animals: vertebrates (fish, amphibians, reptiles, birds, mammals), invertebrates (Arthropoda, Mollusca)', 'Life and Living — Diversity of plants: Angiosperms (flowering), Gymnosperms (cone bearing), ferns, mosses', 'Life and Living — Photosynthesis: water + carbon dioxide + sunlight → food + oxygen'],
      2: ['Matter and Materials — Introduction to the Periodic Table of Elements: metals, semi-metals, non-metals; arrangement', 'Matter and Materials — Properties of materials: boiling and melting points, electrical and heat conductivity; impact on environment', 'Matter and Materials — Separating mixtures: filtration, sieving, magnetism, evaporation, distillation, chromatography', 'Matter and Materials — Sorting and recycling materials: waste management, types of waste', 'Matter and Materials — Acids, bases and neutrals: tastes, properties, litmus paper indicators'],
      3: ['Energy and Change — Relationship of the Sun to the Earth: solar energy, seasons caused by Earth\'s tilt of 23.5°', 'Energy and Change — Solar energy and life on Earth: fossil fuels form from dead plants/animals; non-renewable resources', 'Energy and Change — Relationship of the Moon to the Earth: gravity, tides, orbit, new/full moon'],
      4: ['Earth and Beyond — Earth\'s place in the Solar System: Sun, planets, asteroid belt', 'Life and Living — Human reproduction: puberty changes, reproductive organs, fertilisation, pregnancy', 'Life and Living — Diseases: infectious and non-infectious diseases, prevention and vaccines'],
    },
  },
 
  'Technology': {
    7: {
      1: ['Structures: investigating and strengthening structures; frame and shell structures; struts and triangles', 'Structures: design, make and evaluate a structure that can carry a load (bridge)', 'Mechanisms: levers (first, second and third class); mechanical advantage', 'Design process: investigate, design, make, evaluate and communicate (PAT 1 — Investigate)'],
      2: ['Electrical systems: circuits, components (cells, bulbs, switches, buzzers, conducting wires), designing systems using circuits', 'Electrical systems: solve a practical problem using an electric circuit (steady hand game, lighthouse)', 'Mechanisms: cranks and pulleys as adaptations of levers; mechanical advantage', 'Design: design and make a device using a mechanical system (PAT 2 — Investigate and Design)'],
      3: ['Processing: processing materials to change their properties or appearance', 'Processing: food processing (cooking, preserving, fermenting)', 'Hydraulics and pneumatics: syringes and plastic tubes; demonstrate a hydraulic/pneumatic system', 'Mechanisms: pneumatic or hydraulic-powered crane with electromagnet (Jaws-of-Life model)'],
      4: ['Structures: evaluate and improve structures; strengthening and stiffening techniques', 'Electrical systems: electromagnets (switch + light + iron core + copper wire), control systems', 'Design: combined mechanical and electrical system — crane with electromagnet that sorts ferrous metals', 'Design process: communicate design solutions using drawings and models'],
    },
  },
 
  'Social Sciences — History': {
    4: {
      1: ['Local history: finding out about the history of a local area', 'Information sources: pictures, writing, stories, interviews, objects', 'How to research and collate a history project; change and continuity'],
      2: ['Learning from leaders: qualities of a good leader (listens, serves, courage, dedication, sacrifice)', 'Nelson Mandela OR Mahatma Gandhi: life story and leadership qualities', 'Are leaders always popular? Always perfect? Change and continuity'],
      3: ['Transport through time: how transport has changed (horses, ox-wagons, steam trains, motor cars, aeroplanes)', 'Change and continuity in transport; comparing transport in the past and present'],
      4: ['Communication through time: postal system, radio, television, early typewriters, telegraph, telephone, cell phones, computers, internet', 'Change and continuity in communication; how communication connects people across the world'],
    },
    5: {
      1: ['Hunter-gatherers and herders in southern Africa: how they lived, who they were (San and Khoikhoi)', 'Finding information about the past: types of historical sources', 'Project on hunter-gatherers: researching, organising and presenting findings'],
      2: ['The first farmers in southern Africa: when, why and where they settled', 'How early African farmers lived: homesteads, villages, agriculture (crops and livestock), social structure', 'The role of cattle and the role of the chief; interaction with Khoisan'],
      3: ['An ancient African society: Egypt — the Nile River and its influence on settlement', 'Social structure in ancient Egypt; sphinx, pyramids and temples; hieroglyphics, mathematics and astrology', 'Medicine and physicians in ancient Egypt; case study: the tomb of Tutankhamen'],
      4: ['Khoikhoi and the Dutch at the Cape: first encounters, trading relationships, impact of Dutch arrival', 'Commemoration: ceremonies, museums and monuments; change and continuity in South African history'],
    },
    6: {
      1: ['The Cradle of Humankind: fossil evidence, early humans in southern Africa', 'Mapungubwe: an ancient southern African kingdom; trade, wealth, social structure and decline', 'Indigenous people of South Africa before European contact'],
      2: ['The Scramble for Africa: European colonisation; the Berlin Conference of 1884–1885; dividing Africa', 'Impact of colonisation on African societies; South Africa under colonial rule'],
      3: ['The mineral revolution in South Africa: discovery of diamonds (Kimberley 1867) and gold (Witwatersrand 1886)', 'Impact of the mineral revolution on South African society; migrant labour system; formation of Johannesburg'],
      4: ['Medicine through time: indigenous healing in South Africa (physical causes, spiritual healing, indigenous plants)', 'Modern Western scientific discoveries: vaccination against smallpox (Edward Jenner), germs and disease (Louis Pasteur), TB (Robert Koch)', 'Surgery: anaesthetics, infection prevention, blood transfusions, X-rays; heart surgery — Christiaan Barnard and the world\'s first heart transplant'],
    },
    7: {
      1: ['Iron Age in southern Africa: Iron Age societies, technology, trade and development c. 1300–1870', 'Difaqane/Mfecane: causes, key figures (Shaka, Mzilikazi, Moshoeshoe), events and consequences'],
      2: ['The Transatlantic slave trade: nature and impact between West Africa and the American South', 'West Africa before European slave trade; slavery in the American South (plantations, crops, slave life)', 'Resistance to slavery: Nat Turner\'s revolt, Joseph Cinque and Amistad Mutiny, Harriet Tubman and the Underground Railroad, John Brown'],
      3: ['The Holocaust: rise of the Nazi party, persecution and murder of Jewish people and other groups', 'Life in the camps; the Final Solution; liberation; contemporary lessons about racism and human rights'],
      4: ['Civil society protests in South Africa: 1970s–1980s resistance to apartheid; the role of youth', '1976 Soweto Uprising: causes, events and legacy', 'Civil society protests worldwide: anti-Vietnam War protests; civil rights movement in the USA'],
    },
  },
 
  'Social Sciences — Geography': {
    4: {
      1: ['Map skills: compass directions (N, S, E, W, NE, NW, SE, SW); eight compass points from a fixed point on a world map', 'The globe: equator, north and south poles, the seven continents, four oceans'],
      2: ['Map skills: map symbols, direction and scale', 'South Africa: political map — nine provinces and their capital cities', 'South Africa: physical features — major rivers and mountains'],
      3: ['South Africa: climate — rainfall patterns and temperature regions', 'South Africa: vegetation — six biomes (grassland, savanna, forest, fynbos, Nama Karoo, desert)', 'South Africa: natural resources and how they are used'],
      4: ['South Africa: agriculture — types of farming and where farming takes place', 'South Africa: mining — types of minerals and major mining regions', 'South Africa: population distribution, major cities and industries'],
    },
    5: {
      1: ['Map skills: world map and compass directions; position of equator, north and south poles; the seven continents', 'Africa: position on world map and globe; oceans surrounding Africa; countries and main cities', 'Africa: physical map — high and low areas; rivers, lakes; physical features', 'Countries of Africa: landlocked countries, countries on the equator, island countries; South Africa\'s neighbouring countries', 'Africa\'s highest mountains: Kilimanjaro and Mount Kenya; Africa\'s largest lakes: Victoria, Tanganyika, Malawi', 'Africa\'s great rivers: Nile, Niger, Congo, Zambezi, Limpopo, Gariep-Orange', 'Africa\'s great deserts: Sahara and Namib; famous waterfalls: Victoria and Maletsunyane', 'Scale: concept of scale; small and large-scale maps; line scales and word scales; measuring distances between cities'],
      2: ['South Africa: climate — rainfall and temperature patterns across regions', 'South Africa: rivers and water resources; major dams', 'South Africa: natural vegetation regions and their characteristics', 'South Africa: soil types and their importance for farming'],
      3: ['Resources: types of resources — renewable and non-renewable', 'Economic activities: primary, secondary and tertiary sectors', 'Mining in South Africa: types of mining (open-cast, underground), major minerals and where they are found', 'Agriculture: types of farming, farming regions in South Africa'],
      4: ['Population: population distribution in South Africa; push and pull factors of migration; urbanisation', 'Settlement: urban and rural settlements; informal settlements', 'Services in settlements: water, electricity, transport, waste removal; development and inequality'],
    },
    6: {
      1: ['Map skills: atlases, global statistics and current events throughout the year', 'Latitude and longitude: degrees, hemispheres (northern, southern, eastern, western)', 'Location of South Africa: southern and eastern hemispheres', 'Latitude and longitude on a map: locating countries and cities in degrees', 'Scale: concept of scale; small and large-scale maps; line scales; word scales; measuring straight-line distances between cities on a map'],
      2: ['Development: what is development? Measuring development (HDI, GNI per capita)', 'Developed and developing countries: comparing standard of living', 'Inequality between developed and developing countries; trade: imports and exports'],
      3: ['Climate and weather: difference between climate and weather; factors affecting climate', 'Extreme weather: droughts, floods, hurricanes and their impact on people and the environment', 'Climate change: causes (greenhouse gases, deforestation, burning fossil fuels) and effects (global warming, rising sea levels)', 'Responses to climate change: individual and government actions'],
      4: ['Population: world population distribution; factors affecting population distribution', 'Migration: reasons for migration; types of migration (internal, international, refugees)', 'Urbanisation: growth of cities, informal settlements, problems and solutions', 'Food security: what is food security? Factors affecting food production; food distribution challenges'],
    },
    7: {
      1: ['Map skills: current events on a world map throughout the year', 'Local maps and street maps: using an index and grid to locate places; sketching maps and explaining routes', 'Sketch a map of a local area (project): include symbols, key and scale; record observations of vegetation and land use', 'Distance and scale: line scales and word scales; different scales on different maps; calculating distances on maps (direct and indirect routes)'],
      2: ['Development: measuring development; HDI; comparing countries by level of development', 'Aid and development: forms of international aid; role of NGOs; goals and limitations of aid', 'Trade: fair trade; impact of trade on development of poorer countries'],
      3: ['Climate: factors affecting climate (latitude, altitude, distance from sea, ocean currents)', 'Climate regions of the world: tropical, arid, temperate and polar regions', 'Climate change: evidence, causes and consequences; carbon footprint; global agreements', 'Natural disasters: causes, effects and responses (floods, droughts, earthquakes, volcanoes)'],
      4: ['Resources: global distribution of natural resources; exploitation and conservation', 'Energy resources: renewable and non-renewable; global energy crisis and solutions', 'Water: global water distribution; water scarcity; water management strategies', 'Population: global population growth; population pyramids; demographic transition model'],
    },
  },
 
  'English Home Language': {
    4: {
      1: ['Reading and Viewing: information text with visuals (charts, tables, diagrams, mind maps, posters)', 'Reading and Viewing: novelette — extracts and character work', 'Writing: advertisement; character sketch (3 paragraphs)', 'Language: nouns (common, abstract, adjectives, verbs); similes, metaphors, idioms; simple sentences, statements, questions; simple present and past tense', 'Literature genres Semester 1: novelette (Term 1); poetry and folklore/short story (Term 2)'],
      2: ['Reading and Viewing: poem — read, discuss, interpret; visual text (cartoon/comic strip/advertisement)', 'Reading and Viewing: folklore/traditional story', 'Writing: narrative essay (3 paragraphs); transactional writing (letter or invitation)', 'Language: relative and reflexive pronouns; adverbs; connections; interjections; simple present and future tense; reported speech; prepositions', 'Oral: Read Aloud completed and recorded (20 marks)', 'Response to Texts exam (50 marks): literary/non-literary text, visual text, language'],
      3: ['Reading and Viewing: short story; information texts; non-literary texts', 'Writing: creative writing project — descriptive or narrative essay or poem', 'Language: subject-verb agreement; direct and indirect speech; active and passive voice; conjunctions', 'Oral: prepared speech linked to project'],
      4: ['Reading and Viewing: drama extract or play; report; non-literary information text', 'Writing: transactional writing (formal letter, e-mail); narrative essay', 'Language: revision of all structures; tenses; punctuation; sentence types', 'Oral: Read Aloud (20 marks)', 'Response to Texts exam (50 marks): literary/non-literary text, visual text, language'],
    },
    5: {
      1: ['Reading and Viewing: information text (visual) — posters, advertisements, charts, tables, diagrams', 'Reading and Viewing: novelette — extracts and character work', 'Writing: information text (3–4 paragraphs); SMS/email', 'Language: finite and infinite verbs; simple present and simple future tense; personification, proverbs, idioms, similes', 'Literature genres Semester 1: novelette (Term 1); poetry and folklore/short story (Term 2)'],
      2: ['Reading and Viewing: poem — read, discuss, interpret; visual text; folklore/short story', 'Writing: narrative essay (3 paragraphs); transactional writing', 'Language: pronouns; conjunctions; past continuous and future continuous tense; active and passive voice; reported speech', 'Oral: Read Aloud completed (20 marks)', 'Response to Texts controlled test (40 marks): literary/non-literary text (15), visual text (10), summary (5), language (10)'],
      3: ['Reading and Viewing: non-literary text; drama extract', 'Writing: creative writing project (narrative or descriptive essay; poem or drama)', 'Language: subject-verb agreement; sentence structure; conjunctions for cohesion', 'Oral: prepared speech linked to project'],
      4: ['Reading and Viewing: report with visuals; non-literary texts; revision of all genres', 'Writing: transactional writing (formal letter, e-mail); narrative essay', 'Language: revision of all structures; tenses; punctuation; sentence types', 'Oral: Read Aloud (20 marks)', 'Response to Texts exam (40 marks): literary/non-literary text (15), visual text (10), summary (5), language (10)'],
    },
    6: {
      1: ['Reading and Viewing: information text — newspaper article, report', 'Reading and Viewing: novelette — extracts and character work', 'Writing: narrative or descriptive essay (5 paragraphs); information text (report)', 'Language: common and abstract nouns; personal and demonstrative pronouns; subject-verb agreement; simple tenses; word division; dictionary use', 'Literature genres Semester 1: novelette (Term 1); poetry and short story/drama (Term 2)'],
      2: ['Reading and Viewing: poem — read, discuss, interpret; visual text (cartoon/poster/advertisement)', 'Reading and Viewing: short story or drama extract', 'Writing: transactional writing (10 marks); narrative essay', 'Language: direct and indirect speech; active and passive voice; conditional sentences; figurative language', 'Oral: Read Aloud completed (20 marks)', 'Response to Texts exam (50 marks): literary/non-literary text (20), visual text (10), summary (5 or 10), language (15 or 10)'],
      3: ['Reading and Viewing: non-literary information text; drama', 'Writing: creative writing project (40 marks)', 'Language: complex sentences; relative clauses; punctuation', 'Oral: prepared oral or presentation linked to project'],
      4: ['Reading and Viewing: report; non-literary text; revision of all genres studied', 'Writing: transactional writing (10 marks); narrative or descriptive essay', 'Language: revision of all structures; tenses; sentence types', 'Oral: Read Aloud (20 marks)', 'Response to Texts exam (50 marks): literary/non-literary text (20), visual text (10), summary (5 or 10), language (15 or 10)'],
    },
    7: {
      1: ['Reading and Viewing: information text — newspaper article, report, poster', 'Reading and Viewing: novel or novelette — extracts and character work', 'Writing: narrative or descriptive essay; information text', 'Language: nouns (common, proper, abstract, collective); subject-verb agreement; tenses; figurative language', 'Literature genres Semester 1: novel/novelette (Term 1); poetry and drama/short story (Term 2)'],
      2: ['Reading and Viewing: poem — read, discuss, interpret; visual text; drama extract', 'Writing: transactional writing (10 marks); narrative essay', 'Language: direct and indirect speech; active and passive voice; conditional sentences; tenses', 'Oral: Read Aloud completed (20 marks)', 'Response to Texts controlled test (50 marks): literary/non-literary text (20), visual text (10), summary (10), language (10)'],
      3: ['Reading and Viewing: folklore; short story', 'Writing: creative writing project (40 marks) — narrative, reflective or descriptive essay', 'Language: sentence types; relative clauses; punctuation revision', 'Oral: prepared oral linked to project'],
      4: ['Reading and Viewing: revision of all genres (novel, short story, folklore, drama, poetry)', 'Writing: transactional writing (10 marks); essay', 'Language: revision of all structures', 'Oral: Read Aloud (20 marks)', 'Year-end exam (60 marks): literary/non-literary text, visual text, summary, language'],
    },
  },
 
  'English First Additional Language': {
    4: {
      1: ['Reading and Viewing: information text with visuals (charts, tables, diagrams, mind maps, maps, pictures)', 'Reading and Viewing: novelette — extracts', 'Writing: advertisement; poster advertising an event', 'Language: articles, plurals, common nouns, abstract nouns, adjectives, verbs; similes, metaphors, idioms; simple sentences, statements, questions; question mark, exclamation mark, dictionary use'],
      2: ['Reading and Viewing: poem; visual text (cartoon/poster); folklore/traditional story', 'Writing: narrative paragraph; transactional writing (invitation or letter)', 'Language: adverbs; complex sentences; metaphors; similes; reported speech', 'Oral: Read Aloud completed (20 marks)', 'Response to Texts controlled test (40 marks): literary/non-literary text (15), visual text (10), language (15)'],
      3: ['Reading and Viewing: short story; information text', 'Writing: creative writing project (40 marks)', 'Language: subject-verb agreement; direct and indirect speech; active and passive voice'],
      4: ['Reading and Viewing: report; non-literary text; revision of all genres', 'Writing: narrative essay; transactional writing (10 marks)', 'Language: revision of all structures; tenses', 'Response to Texts exam (40 marks): literary/non-literary text (15), visual text (10), language (15)'],
    },
    5: {
      1: ['Reading and Viewing: information text (visual) — poster, advertisement; novelette', 'Writing: information text (3–4 paragraphs); SMS/email', 'Language: finite verbs, infinite verbs; simple present and simple future tense; personification, proverbs, idioms, similes'],
      2: ['Reading and Viewing: poem; visual text; report with visuals (tables/charts/graphs)', 'Writing: narrative paragraph; report; transactional writing (10 marks)', 'Language: adjectives, pronouns, conjunctions; past and future continuous tense; active and passive voice; reported speech', 'Oral: Read Aloud completed (20 marks)', 'Response to Texts controlled test (50 marks): literary/non-literary text (20), visual text (10), summary (5), language (15)'],
      3: ['Reading and Viewing: non-literary text; drama extract; folklore', 'Writing: creative writing project (40 marks) — poem, folklore, short story or drama', 'Language: subject-verb agreement; sentence types; conjunctions', 'Oral: oral presentation linked to project'],
      4: ['Reading and Viewing: revision of all text types; report', 'Writing: transactional writing (10 marks); narrative essay', 'Language: revision of all structures', 'Response to Texts exam (50 marks): literary/non-literary text (20), visual text (10), summary (5), language (15)'],
    },
    6: {
      1: ['Reading and Viewing: newspaper article; information text; novelette', 'Writing: summary of newspaper article; narrative paragraph; SMS/email', 'Language: common and abstract nouns; personal and demonstrative pronouns; subject-verb agreement; simple tenses; word division; dictionary use; full stop, comma, colon, semi-colon, question mark, exclamation mark'],
      2: ['Reading and Viewing: poem; visual text (cartoon/advertisement); drama extract or short story', 'Writing: transactional writing (10 marks); narrative essay', 'Language: direct and indirect speech; active and passive voice; conditional sentences; figurative language', 'Oral: Read Aloud completed (20 marks)', 'June controlled test (50 marks): literary/non-literary text (20), visual text (10), summary (5), language (15)'],
      3: ['Reading and Viewing: non-literary texts; report; folklore', 'Writing: creative writing project (40 marks)', 'Language: complex sentences; relative clauses; punctuation revision', 'Oral: oral presentation linked to project'],
      4: ['Reading and Viewing: revision of all text types', 'Writing: transactional writing (10 marks); narrative essay', 'Language: revision of all structures', 'Year-end exam (50 marks): literary/non-literary text (20), visual text (10), summary (5), language (15)'],
    },
    7: {
      1: ['Reading and Viewing: information text; newspaper article; novelette', 'Writing: narrative or reflective essay; information text', 'Language: nouns; subject-verb agreement; simple tenses; figurative language; prefixes, suffixes, roots; auxiliary and finite verbs'],
      2: ['Reading and Viewing: poem; visual text; short story', 'Writing: transactional writing (10 marks); narrative essay', 'Language: direct and indirect speech; active and passive voice; reported speech; subject and predicate', 'Oral: Read Aloud completed (20 marks)', 'June controlled test (50 marks): literary/non-literary text (20), visual text (10), summary (10), language (10)'],
      3: ['Reading and Viewing: folklore; short story', 'Writing: creative writing project (40 marks) — narrative, reflective or descriptive essay', 'Language: sentence types; common and proper nouns; simple present and past tense', 'Oral: oral presentation linked to project'],
      4: ['Reading and Viewing: revision of all genres', 'Writing: transactional writing (10 marks); narrative essay', 'Language: revision of all structures', 'Year-end exam (60 marks): literary/non-literary text (20), visual text (10), summary (10), language (20)'],
    },
  },
 
  'Afrikaans Home Language': {
    4: {
      1: ['Lees en Kyk: inligtingsteks met visuele prikkels (grafieke, tabelle, diagramme, breinkaarte)', 'Lees en Kyk: novelle (uittreksels)', 'Skryf en Aanbied: koerantberig; advertensie', 'Taalstrukture: vokale, konsonante, alfabetiese rangskikking, lettergrepe, klankgrepe; meervoude, verkleinwoorde; spelling en punktuasie (vraagtekens, uitroeptekens)', 'Letterkunde Semester 1: novelle (Kwartaal 1); poësie en volksverhaal/kortverhaal (Kwartaal 2)'],
      2: ['Lees en Kyk: gedig; visuele teks (spotprent/plakkaat/advertensie); volksverhaal', 'Skryf en Aanbied: narratiewe opstel (3 paragrawe); transaksionele skryf (uitnodiging of brief)', 'Taalstrukture: byvoeglike naamwoorde; teenwoordige, verlede en toekomende tyd; sinsoorte; leestekens', 'Mondeling: hardoplees voltooi en aangeteken (20 punte)', 'Respons op Tekste toets (50 punte): literêre/nie-literêre teks, visuele teks, taalstrukture'],
      3: ['Lees en Kyk: nie-literêre teks; kortverhaal', 'Skryf en Aanbied: kreatiewe skryfprojek (opstel of gedig)', 'Taalstrukture: onderwerpwerkwoord-ooreenstemming; direkte en indirekte rede; aktief en passief'],
      4: ['Lees en Kyk: verslag; hersiening van alle genres', 'Skryf en Aanbied: transaksionele skryf (10 punte); narratiewe opstel', 'Taalstrukture: hersiening van alle taalstrukture', 'Respons op Tekste eksamen (50 punte): literêre/nie-literêre teks, visuele teks, opsomming, taalstrukture'],
    },
    5: {
      1: ['Lees en Kyk: inligtingsteks met visuele prikkels; novelle (uittreksels)', 'Skryf en Aanbied: inligtingsteks (3–4 paragrawe); SMS/e-pos', 'Taalstrukture: sinonieme en antonieme; werkwoorde (gerunde); stelsinne, vraagsinne, beveelsinne; enkelvoudige en saamgestelde sinne; direkte en indirekte rede; metafore; vergelykings', 'Letterkunde Semester 1: novelle (Kwartaal 1); poësie en volksverhaal (Kwartaal 2)'],
      2: ['Lees en Kyk: gedig; visuele teks; verslag met visuele prikkels (tabelle, grafieke, diagramme)', 'Skryf en Aanbied: verslag; transaksionele skryf (10 punte); narratiewe paragraaf', 'Taalstrukture: bywoorde van tyd, plek en wyse; verlede en toekomende duurvorm; aktief en passief; gerapporteerde rede', 'Mondeling: hardoplees voltooi (20 punte)', 'Respons op Tekste kontroletoets (40 punte): literêre/nie-literêre teks (15), visuele teks (10), opsomming (5), taalstrukture (10)'],
      3: ['Lees en Kyk: nie-literêre teks; drama-uittreksel; volksverhaal', 'Skryf en Aanbied: kreatiewe skryfprojek (40 punte) — poësie, volksverhaal, kortverhaal of drama', 'Mondeling: mondelinge aanbieding van projek (20 punte)', 'Taalstrukture: sinsoorte; voegwoorde; onderwerpwerkwoord-ooreenstemming'],
      4: ['Lees en Kyk: hersiening van alle tekstipes; verslag', 'Skryf en Aanbied: transaksionele skryf (10 punte); narratiewe opstel', 'Taalstrukture: hersiening van alle taalstrukture', 'Respons op Tekste eksamen (40 punte): literêre/nie-literêre teks (15), visuele teks (10), opsomming (5), taalstrukture (10)'],
    },
    6: {
      1: ['Lees en Kyk: koerantberig; inligtingsteks; novelle (uittreksels)', 'Skryf en Aanbied: koerantberig; narratiewe opstel (5 paragrawe)', 'Taalstrukture: woordverdeling; woordeboekgebruik; punt, komma, dubbelpunt, kommapunt, vraagteken, uitroepteken; spelreëls', 'Letterkunde Semester 1: novelle (Kwartaal 1); poësie en kortverhaal/drama (Kwartaal 2)'],
      2: ['Lees en Kyk: gedig; visuele teks (spotprent/strokiesprent/advertensie); kortverhaal of drama-uittreksel', 'Skryf en Aanbied: transaksionele skryf (10 punte); narratiewe opstel', 'Taalstrukture: direkte en indirekte rede; aktief en passief; voorwaardelike sinne; figuurlike taal', 'Mondeling: hardoplees voltooi en aangeteken (20 punte)', 'Junie-kontroletoets (50 punte): literêre/nie-literêre teks (20), visuele teks (10), opsomming (10), taalstrukture (10)'],
      3: ['Lees en Kyk: nie-literêre tekste; drama; volksverhaal', 'Skryf en Aanbied: kreatiewe skryfprojek (40 punte)', 'Taalstrukture: saamgestelde sinne; betreklike bysinne; leestekens', 'Mondeling: mondelinge aanbieding van projek (20 punte)'],
      4: ['Lees en Kyk: hersiening van alle genres (roman, kortverhaal, volksverhaal, drama, gedigte)', 'Skryf en Aanbied: transaksionele skryf (10 punte); narratiewe opstel', 'Taalstrukture: hersiening — alle taalstrukture', 'Eindeksamen (50 punte): literêre/nie-literêre teks (20), visuele teks (10), opsomming (10), taalstrukture (10)'],
    },
    7: {
      1: ['Lees en Kyk: inligtingsteks; koerantberig; roman of novelle (uittreksels)', 'Skryf en Aanbied: narratiewe of beskrywende opstel; inligtingsteks', 'Taalstrukture: selfstandige naamwoorde (eienaam, soortnaam, abstrak, versamelnaam, verkleinnaam); onderwerpwerkwoord-ooreenstemming; tydsvorme; figuurlike taal', 'Letterkunde Semester 1: roman (Kwartaal 1); poësie en drama/kortverhaal (Kwartaal 2)'],
      2: ['Lees en Kyk: gedig; visuele teks (spotprent/strokiesprent/advertensie); drama-uittreksel', 'Skryf en Aanbied: transaksionele skryf (10 punte); narratiewe opstel', 'Taalstrukture: direkte en indirekte rede; aktief en passief; deelwoorde; vraagvorme; ontkenning', 'Mondeling: hardoplees voltooi en aangeteken (20 punte)', 'Junie-kontroletoets (60 punte): literêre/nie-literêre teks (20), visuele teks (10), opsomming (10), taalstrukture (20)'],
      3: ['Lees en Kyk: volksverhaal; kortverhaal', 'Skryf en Aanbied: kreatiewe skryfprojek (40 punte) — narratiewe, reflektiewe of beskrywende opstel', 'Taalstrukture: enkelvoudige en saamgestelde sinne; stelsinne; vraagsinne; betreklike voornaamwoorde', 'Mondeling: mondelinge aanbieding van projek (20 punte)'],
      4: ['Lees en Kyk: hersiening van alle genres (roman, kortverhaal, volksverhaal, drama, gedigte, visuele teks)', 'Skryf en Aanbied: transaksionele skryf (10 punte); opstel', 'Taalstrukture: hersiening — versamelname, betreklike voornaamwoorde, basisvorme, sinonieme, antonieme, letterlike en figuurlike betekenis', 'Eindeksamen Vraestel 2 — Respons op Tekste (60 punte): literêre/nie-literêre teks (20), visuele teks (10), opsomming (10), taalstrukture (20)'],
    },
  },
 
  'Afrikaans First Additional Language': {
    4: {
      1: ['Lees en Kyk: inligtingsteks met visuele prikkels (grafieke, tabelle, diagramme, breinkaarte, kaarte)', 'Lees en Kyk: novelle (uittreksels)', 'Skryf en Aanbied: inligtingsteks soos \'n verslag; plakkaat wat \'n geleentheid adverteer', 'Taalstrukture: lidwoorde, soortnaamwoorde, abstrakte selfstandige naamwoorde, byvoeglike naamwoorde, alfabetiese rangskikking; enkelvoudige sin, stelsin, vraagsin, bevelsin, uitroepsin; vergelykings, metafore, idiome; vraagtekens, uitroeptekens, spelling en spelpatrone'],
      2: ['Lees en Kyk: gedig; visuele teks; volksverhaal', 'Skryf en Aanbied: narratiewe paragraaf; transaksionele skryf (uitnodiging of brief)', 'Taalstrukture: bywoorde van tyd, plek en wyse; sinsoorte; ontkenning; metafore; vergelykings', 'Mondeling: hardoplees taak voltooi en aangeteken (20 punte)', 'Respons op Tekste kontroletoets (40 punte): literêre/nie-literêre teks (15), visuele teks (10), taalstrukture (15)'],
      3: ['Lees en Kyk: nie-literêre teks; kortverhaal', 'Skryf en Aanbied: kreatiewe skryfprojek (40 punte)', 'Taalstrukture: onderwerpwerkwoord-ooreenstemming; aktief en passief; tydsvorme'],
      4: ['Lees en Kyk: verslag; hersiening van alle genres', 'Skryf en Aanbied: transaksionele skryf (10 punte); narratiewe opstel', 'Taalstrukture: hersiening van alle taalstrukture', 'Respons op Tekste eksamen (40 punte): literêre/nie-literêre teks (15), visuele teks (10), taalstrukture (15)'],
    },
    5: {
      1: ['Lees en Kyk: inligtingsteks; novelle', 'Skryf en Aanbied: inligtingsteks; SMS/e-pos', 'Taalstrukture: sinonieme en antonieme; werkwoorde (gerunde); stelsinne, vraagsinne, beveelsinne; enkelvoudige en saamgestelde sinne; direkte en indirekte rede; woordorde; ontkenning; metafore; vergelykings'],
      2: ['Lees en Kyk: gedig; visuele teks; verslag met visuele prikkels (tabelle/grafieke/diagramme)', 'Skryf en Aanbied: verslag; transaksionele skryf (10 punte); narratiewe paragraaf', 'Taalstrukture: bywoorde van tyd, plek en wyse; verlede en toekomende duurvorm; aktief en passief; gerapporteerde rede; voegwoorde', 'Mondeling: hardoplees voltooi (20 punte)', 'Respons op Tekste kontroletoets (50 punte): literêre/nie-literêre teks (20), visuele teks (10), opsomming (5), taalstrukture (15)'],
      3: ['Lees en Kyk: nie-literêre teks; drama-uittreksel; volksverhaal', 'Skryf en Aanbied: kreatiewe skryfprojek (40 punte) — poësie, volksverhaal, kortverhaal of drama', 'Mondeling: mondelinge aanbieding van projek (20 punte)', 'Taalstrukture: sinsoorte; voegwoorde; onderwerpwerkwoord-ooreenstemming'],
      4: ['Lees en Kyk: hersiening van alle tekstipes', 'Skryf en Aanbied: transaksionele skryf (10 punte); narratiewe opstel', 'Taalstrukture: hersiening van alle taalstrukture', 'Respons op Tekste eksamen (50 punte): literêre/nie-literêre teks (20), visuele teks (10), opsomming (5), taalstrukture (15)'],
    },
    6: {
      1: ['Lees en Kyk: koerantberig; inligtingsteks; novelle', 'Skryf en Aanbied: opsomming van koerantberig; narratiewe paragraaf; SMS/e-pos', 'Taalstrukture: soortnaamwoorde, abstrakte selfstandige naamwoorde, persoonlike en aanwysende voornaamwoorde; onderwerpwerkwoord-ooreenstemming; eenvoudige tydsvorme; woordverdeling; woordeboekgebruik; leestekens'],
      2: ['Lees en Kyk: gedig; visuele teks (spotprent/advertensie); drama-uittreksel of kortverhaal', 'Skryf en Aanbied: transaksionele skryf (10 punte); narratiewe opstel', 'Taalstrukture: direkte en indirekte rede; aktief en passief; voorwaardelike sinne; figuurlike taal', 'Mondeling: hardoplees voltooi (20 punte)', 'Junie-kontroletoets (50 punte): literêre/nie-literêre teks (20), visuele teks (10), opsomming (5), taalstrukture (15)'],
      3: ['Lees en Kyk: nie-literêre tekste; drama; volksverhaal', 'Skryf en Aanbied: kreatiewe skryfprojek (40 punte)', 'Taalstrukture: saamgestelde sinne; betreklike bysinne; leestekens', 'Mondeling: mondelinge aanbieding van projek (20 punte)'],
      4: ['Lees en Kyk: hersiening van alle genres', 'Skryf en Aanbied: transaksionele skryf (10 punte); narratiewe opstel', 'Taalstrukture: hersiening van alle taalstrukture', 'Eindeksamen (50 punte): literêre/nie-literêre teks (20), visuele teks (10), opsomming (5), taalstrukture (15)'],
    },
    7: {
      1: ['Lees en Kyk: inligtingsteks; koerantberig; roman of novelle', 'Skryf en Aanbied: narratiewe of beskrywende opstel; inligtingsteks', 'Taalstrukture: selfstandige naamwoorde; onderwerpwerkwoord-ooreenstemming; tydsvorme; voorvoegsels, agtervoegsels, stamme; hulpwerkwoorde, eindige werkwoorde'],
      2: ['Lees en Kyk: gedig; visuele teks (spotprent/advertensie); drama-uittreksel', 'Skryf en Aanbied: transaksionele skryf (10 punte); narratiewe opstel', 'Taalstrukture: direkte en indirekte rede; aktief en passief; onderwerp en gesegde; onderwerpwerkwoord-ooreenstemming', 'Mondeling: hardoplees voltooi (20 punte)', 'Junie-kontroletoets (60 punte): literêre/nie-literêre teks (20), visuele teks (10), opsomming (10), taalstrukture (20)'],
      3: ['Lees en Kyk: volksverhaal; kortverhaal', 'Skryf en Aanbied: kreatiewe skryfprojek (40 punte) — narratiewe, reflektiewe of beskrywende opstel', 'Taalstrukture: enkelvoudige en saamgestelde sinne; stelsinne; vraagvorme; deelwoorde; ontkenning', 'Mondeling: mondelinge aanbieding van projek (20 punte)'],
      4: ['Lees en Kyk: hersiening van alle genres (roman, kortverhaal, volksverhaal, drama, gedigte, visuele teks)', 'Skryf en Aanbied: transaksionele skryf (10 punte); opstel', 'Taalstrukture: hersiening — versamelname, betreklike voornaamwoorde, basisvorme, sinonieme, antonieme, letterlike en figuurlike betekenis', 'Eindeksamen Vraestel 2 — Respons op Tekste (60 punte): literêre/nie-literêre teks (20), visuele teks (10), opsomming (10), taalstrukture (20)'],
    },
  },
 
  'Life Skills — Personal and Social Wellbeing': {
    4: {
      1: ['Development of the self: personal strengths, identifying own strengths and strengths of others', 'Development of the self: converting less successful experiences into positive learning; achievements', 'Development of the self: respect for own and others\' bodies; privacy and bodily integrity; how to care for own body', 'Development of the self: dealing with conflict; examples of conflict situations at home and school; strategies to avoid conflict'],
      2: ['Development of the self: emotions — range of emotions (love, happiness, grief, fear, jealousy); expressing emotions appropriately; understanding others\' emotions', 'Social responsibility: working in a group — benefits, challenges, useful responses to challenges', 'Social responsibility: bullying — how to protect self, examples of bullying, appropriate responses, where to find help', 'Social responsibility: children\'s rights and responsibilities (name, health, safety, education, shelter, food, environment)'],
      3: ['Social responsibility: caring for the environment — acts of environmental damage; ways to care for and protect the environment', 'Social responsibility: recycling and reducing waste; water conservation and the importance of water'],
      4: ['Development of the self: healthy lifestyle choices — balanced diet, physical activity, adequate sleep', 'Development of the self: effects of substance abuse (alcohol, tobacco)', 'Social responsibility: safety and risk — road safety, water safety, fire safety; emergency procedures and first aid basics'],
    },
    5: {
      1: ['Development of the self: self-concept — positive self-concept; personal values and principles; decision-making', 'Development of the self: physical and emotional changes during puberty', 'Development of the self: peer pressure — effects; how to resist peer pressure; assertiveness', 'Development of the self: conflict resolution strategies — negotiation and mediation'],
      2: ['Development of the self: gender roles and stereotypes; challenging gender stereotypes', 'Social responsibility: community service and volunteerism; making a difference in the community', 'Social responsibility: discrimination and prejudice; treating everyone with dignity and equality', 'Development of the self: responsible use of social media; cyberbullying and online safety'],
      3: ['Social responsibility: human rights — universal human rights; South African Constitution and Bill of Rights', 'Social responsibility: democracy and active citizenship; rights and responsibilities as citizens', 'Development of the self: goal-setting — short-term and long-term goals; study skills', 'Social responsibility: environmental responsibility and sustainability'],
      4: ['Development of the self: healthy relationships — characteristics of healthy and unhealthy relationships', 'Development of the self: emotional wellbeing; managing stress and anxiety', 'Social responsibility: poverty and inequality in South Africa; ways individuals and communities can help'],
    },
    6: {
      1: ['Development of the self: positive self-esteem; body image; understanding and accepting body changes', 'Development of the self: other influences on body image — media and society; identifying stereotypes; acceptance of the self', 'Development of the self: abilities, interests and potential; relationship between interests, abilities and potential', 'Development of the self: action plan to improve own abilities, interests and potential', 'Social responsibility: peer pressure in different situations (school and community); appropriate responses to peer pressure', 'Development of the self: problem-solving skills in conflict situations; keeping safe and protecting self and others', 'Social responsibility: mediation skills; acceptance of self and others; co-operation; peacekeeping skills'],
      2: ['Development of the self: careers and the world of work; different career paths; importance of education for career choices', 'Development of the self: entrepreneurship — what it means to start a small business', 'Social responsibility: consumer rights and responsibilities; being a responsible consumer', 'Social responsibility: financial literacy — budgeting, saving and responsible spending'],
      3: ['Social responsibility: caring for animals — acts of cruelty; taking care of and protecting animals; places of safety for animals', 'Social responsibility: caring for people — considering others\' needs and views; communicating own views without hurting others; acts of kindness towards others'],
      4: ['Development of the self: careers and future planning; importance of subject choices for Grade 7 and high school', 'Development of the self: study skills — exam preparation, time management, study plans', 'Social responsibility: responsible citizenship; contributing to community well-being and the democracy'],
    },
  },
 
  'Life Skills — Physical Education': {
    4: { 1: ['Locomotor, rotation, elevation and balancing activities; safety measures relating to these activities'], 2: ['Striking and fielding games; movement performances in striking and fielding games; safety during striking and fielding'], 3: ['Target games; participation and movement performance in target games'], 4: ['Net/wall games; participation and movement performance in net/wall games'] },
    5: { 1: ['Locomotor movements; coordination and control; safety measures relating to locomotor activities'], 2: ['Striking and fielding games; tactical skills in striking and fielding games'], 3: ['Target games; accuracy and technique in target games'], 4: ['Net/wall games; movement performances in net/wall games'] },
    6: { 1: ['Participation in striking and fielding games; movement performances in striking and fielding games'], 2: ['Striking and fielding games; tactical skills and movement performance'], 3: ['Target games; participation and movement performance in target games'], 4: ['Net/wall games; participation and movement performance in net/wall games'] },
  },
 
  'Life Skills — Creative Arts': {
    4: {
      1: ['Visual Art: observe and identify art elements (contrast) in images; Create in 2D — family and friends using secondary colour and contrast; Create in 3D — self and others using clay, texture, shape, contrast', 'Performing Arts (Dance and Music): physical warm-up; locomotor and non-locomotor movements; rhythm patterns using body percussion/instruments (crotchets, minims, rests)'],
      2: ['Visual Art: creative lettering and/or pattern-making using line, shape, colour and contrast; Create in 3D — mobiles using pasting, cutting, wrapping; proportion', 'Performing Arts (Dance and Music): movement sequences; spatial awareness; sound pictures based on themes; cultural dance — observe and discuss steps'],
      3: ['Visual Art: wild or domestic animals in their environment; contrast and proportion; Create in 3D — wild animals using clay', 'Performing Arts (Drama and Music): warm up the voice; build a drama from a stimulus (characters, storyline, beginning/middle/end); role-play; partner skills'],
      4: ['Visual Art: the natural world; secondary and related colour, tints and shades; Create in 3D — kite/dream catcher/bird feeder using recyclable materials', 'Performing Arts (Music and Drama): recognise melodies using tonic solfa; create puppets using found materials; perform a puppet play with musical accompaniment'],
    },
    5: {
      1: ['Visual Art: identify complementary colour and emphasis; Create in 2D — self and others in local environment using complementary colour; Create in 3D — using clay, emphasis', 'Performing Arts: coordination and control warm-up; movement sequences; rhythm patterns (all note values including semibreve, minim, crotchet, quaver)'],
      2: ['Visual Art: creative lettering/pattern-making; African body adornment; Create in 3D — body adornment using recyclable materials', 'Performing Arts: spatial awareness games; develop movement responses to sound pictures'],
      3: ['Visual Art: reptiles and insects in their environment; art elements and emphasis; Create in 3D — reptiles/insects using clay', 'Performing Arts: trust games; partner skills; group role-play (characterisation, interaction, conflict and resolution)'],
      4: ['Visual Art: things that fly (natural or mechanical); art elements and emphasis; Create in 3D — things that fly using recyclable materials', 'Performing Arts: rhythmic patterns; two-part harmony; sound pictures for puppet performance; perform a puppet play'],
    },
    6: {
      1: ['Visual Art: identify monochromatic colour and balance; Create in 2D — figures with animals using monochromatic colour; Create in 3D — figures with animals using clay, balance', 'Performing Arts (Dance and Music): physical warm-up; movement sequences with elements of dance (time, space, force); music — perform rhythm patterns, create sound pictures using instruments'],
      2: ['Visual Art: creative lettering and/or radiating pattern; Create in 3D — relief mandala/radiating pattern', 'Performing Arts (Dance and Music): movement sequences in small groups; cultural dance (Kwaito, Domba, Pantsula, Gumboot, Contemporary, Ballet, Indian dance)'],
      3: ['Visual Art: images of people and/or objects (portraits, shells, shoes); art elements and balance; Create in 3D — modelling observed images', 'Performing Arts (Drama and Music): action and reaction games; develop short dialogues exploring conflict; sing songs in unison, canon or two-part harmony'],
      4: ['Visual Art: buildings, architecture and the environment; all art elements and design principles; Create in 3D — relief of buildings and architecture', 'Performing Arts (Music and Drama): singing warm-ups; musical phrases in pairs; sound pictures for puppet performance; create puppets; perform a puppet play'],
    },
  },
 
  'Life Orientation': {
    7: {
      1: ['Development of the self in society: self-image; positive personal qualities; strategies to enhance self-image; respect for self and others', 'Development of the self in society: puberty and gender constructs; physical and emotional changes; respect for own and others\' body changes', 'Development of the self in society: peer pressure — effects; appropriate responses; assertiveness, coping skills and negotiation skills', 'Development of the self in society: importance of reading and studying; skills to develop memory and recall', 'World of work: career exploration; importance of education for career options', 'Physical Education: participation in a fitness programme; safety issues relating to fitness activities'],
      2: ['Development of the self in society: diversity and human rights — discrimination and prejudice; gender-based violence awareness; respect for diversity', 'Development of the self in society: healthy relationships — communication; constructive disagreement; conflict resolution', 'Social and environmental responsibility: democracy in South Africa; responsible citizenship; rights and responsibilities', 'Physical Education: participation in a fitness programme; movement performance'],
      3: ['Development of the self in society: recreation, leisure, sport and physical activity; spectator behaviour; benefits of physical activity', 'Development of the self in society: responsible use of social media; cyberbullying; online safety and digital citizenship', 'Social and environmental responsibility: community projects and volunteerism; making a difference in the community', 'Physical Education: participation in a fitness programme; movement performance'],
      4: ['Development of the self in society: career guidance — interests, abilities and career options; subject choices for Grade 8 and high school', 'Development of the self in society: study skills — time management; exam preparation; managing stress and anxiety', 'Social and environmental responsibility: global issues affecting communities; South Africa\'s role in the world', 'Physical Education: participation in a fitness programme; movement performance'],
    },
  },
 
  'Economic and Management Sciences': {
    7: {
      1: ['The economy: history of money — traditional societies; comparison of traditional and modern monetary systems; paper money; electronic banking', 'The economy: needs and wants — differentiating between primary and secondary needs; characteristics; unlimited wants vs limited resources', 'The economy: goods and services — differentiating, examples; role of producers and consumers; recycling goods', 'The economy: inequality and poverty — causes of socio-economic imbalances; inequality in South Africa; education, skills and sustainable job opportunities'],
      2: ['Financial literacy: accounting concepts — capital, assets, liability, income, expenses, profit, losses, budgets, savings, banking, financial records, transactions', 'Financial literacy: personal statement of net worth; business income and business expenses; savings and investments', 'Financial literacy: definition of a budget; personal budget — income and expenditure; business budget — income and expenditure'],
      3: ['Entrepreneurship: definition of an entrepreneur; characteristics and skills of an entrepreneur', 'Entrepreneurship: buying and selling (making profit through trading); producing and making profit through manufacturing', 'Entrepreneurship: formal and informal businesses; needs and wants; SWOT analysis', 'Entrepreneurship: starting a business — setting SMARTER goals; advertising, media used in advertising; principles of advertising (AIDA)', 'Entrepreneurship: budget for Entrepreneur\'s Day; simple cost calculations — fixed cost, cost price, variable cost'],
      4: ['The economy: production process — definition; inputs and outputs; sustainable use of resources; economic growth; productivity; technology in production', 'Financial literacy: savings — personal savings; purpose of savings; role of banks; services offered by banks (savings accounts, transactions)', 'Financial literacy: opening a savings account; community savings schemes (stokvel)'],
    },
  },
};
 
// ── Exam scope rule ──
// Term 1 → only T1 | Term 2 → T1+T2 | Term 3 → only T3 | Term 4 → T3+T4
const EXAM_SCOPE = { 1: [1], 2: [1, 2], 3: [3], 4: [3, 4] };
 
// ── Get topics for a given grade/subject/term (respects exam scope) ──
function getATPTopics(subject, grade, term, isExamType) {
  const scope = isExamType ? EXAM_SCOPE[term] : [term];
  const allTopics = scope.flatMap(t => (ATP[subject]?.[grade]?.[t]) || []);
  return allTopics;
}
 
// ============================================================
// MAIN HANDLER
// ============================================================
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
 
  const { subject, topic, resourceType, language, duration, difficulty, includeRubric, grade, term } = req.body;
  if (!subject || !resourceType || !language) return res.status(400).json({ error: 'Missing required fields' });
 
  const g = parseInt(grade) || 6;
  const t = parseInt(term) || 3;
  const phase = g <= 3 ? 'Foundation' : g <= 6 ? 'Intermediate' : 'Senior';
  const isExam = resourceType === 'Exam';
  const isFinalExam = resourceType === 'Final Exam';
  const isWorksheet = resourceType === 'Worksheet';
  const isTest = resourceType === 'Test';
  const isExamType = isExam || isFinalExam;
 
  const totalMarks = parseInt(duration) || 50;
 
  // ── ATP topic lookup — replaces allTopics from UI ──
  // Always use the database; topic field is now just a focus hint
  const atpTopics = isFinalExam
    ? [1, 2, 3, 4].flatMap(tm => (ATP[subject]?.[g]?.[tm]) || [])
    : getATPTopics(subject, g, t, isExamType);
 
  const atpTopicList = atpTopics.length > 0
    ? atpTopics.join('\n- ')
    : (topic || subject);
 
  const focusHint = topic && topic !== subject
    ? `\nFOCUS: The teacher has requested emphasis on: ${topic}\n(This is a specific focus within the above topic list — do not limit to only this topic)`
    : '';
 
  // Auto-calculate time from marks
  function marksToTime(m) {
    if (m <= 10)  return '15 minutes';
    if (m <= 20)  return '30 minutes';
    if (m <= 25)  return '45 minutes';
    if (m <= 30)  return '45 minutes';
    if (m <= 50)  return '1 hour';
    if (m <= 60)  return '1 hour 30 minutes';
    if (m <= 70)  return '1 hour 45 minutes';
    if (m <= 75)  return '2 hours';
    if (m <= 100) return '2 hours 30 minutes';
    return Math.round(m * 1.5 / 60) + ' hours';
  }
  const timeAllocation = marksToTime(totalMarks);
  const diffNote = difficulty === 'below' ? 'Below grade level' : difficulty === 'above' ? 'Above grade level' : 'On grade level';
 
  // ═══════════════════════════════════════
  // DoE COGNITIVE LEVELS
  // Bloom's for: Maths, NST, SS, LS/LO, EMS, Technology
  // Barrett's for: English and Afrikaans Response to Text papers
  // ═══════════════════════════════════════
  function getCogLevels(subj, gr) {
    const s = (subj || '').toLowerCase();
    if (s.includes('math') || s.includes('wiskunde'))
      return { levels: ['Knowledge', 'Routine Procedures', 'Complex Procedures', 'Problem Solving'], pcts: [25,45,20,10] };
    if (s.includes('home language') || s.includes('huistaal'))
      return { levels: ['Literal', 'Reorganisation', 'Inferential', 'Evaluation and Appreciation'], pcts: [20,20,40,20] };
    if (s.includes('additional') || s.includes('addisionele') || s.includes('eerste'))
      return { levels: ['Literal', 'Reorganisation', 'Inferential', 'Evaluation and Appreciation'], pcts: [20,20,40,20] };
    if (s.includes('natural science') && !s.includes('technology'))
      return { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [50,35,15] };
    if (s.includes('natural sciences and technology') || s.includes('nst') || s.includes('natuur'))
      return { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [50,35,15] };
    if (s.includes('social') || s.includes('sosiale') || s.includes('geskieden') || s.includes('history') || s.includes('geography') || s.includes('geografie'))
      return { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30,50,20] };
    if (s.includes('technolog') || s.includes('tegnol'))
      return { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30,50,20] };
    if (s.includes('economic') || s.includes('ekonom'))
      return { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30,50,20] };
    if (s.includes('life') || s.includes('lewens') || s.includes('orientation') || s.includes('oriëntering'))
      return { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30,40,30] };
    return { levels: ['Low Order', 'Middle Order', 'High Order'], pcts: [30,40,30] };
  }
 
  const cog = getCogLevels(subject, g);
 
  // Detect if this subject uses Barrett's taxonomy
  const isBarretts = cog.levels[0] === 'Literal';
 
  // ─── Largest Remainder Method — guarantees marks sum exactly to total ───
  function largestRemainder(total, pcts) {
    const raw = pcts.map(p => total * p / 100);
    const floored = raw.map(Math.floor);
    const remainders = raw.map((v, i) => ({ i, r: v - floored[i] }));
    let deficit = total - floored.reduce((a, b) => a + b, 0);
    remainders.sort((a, b) => b.r - a.r);
    for (let k = 0; k < deficit; k++) floored[remainders[k].i]++;
    return floored;
  }
 
  const cogMarks = largestRemainder(totalMarks, cog.pcts);
  const cogTolerance = Math.max(1, Math.round(totalMarks * 0.02));
  const cogTable = cog.levels.map((l, i) => l + ' ' + cog.pcts[i] + '% = ' + cogMarks[i] + ' marks').join('\n');
 
  // Build topic instruction using ATP database
  let topicInstruction = '';
  // Build separate T1 and T2 topic lists for exam terms so the split is explicit
  const examTerm1Topics = isExam && t === 2 ? (ATP[subject]?.[g]?.[1] || []) : [];
  const examTerm2Topics = isExam && t === 2 ? (ATP[subject]?.[g]?.[2] || []) : [];
  const examTerm3Topics = isExam && t === 4 ? (ATP[subject]?.[g]?.[3] || []) : [];
  const examTerm4Topics = isExam && t === 4 ? (ATP[subject]?.[g]?.[4] || []) : [];

  if (isFinalExam) {
    topicInstruction = `FINAL EXAM — covers ALL topics from the entire year (Terms 1, 2, 3 and 4).\nEnsure questions are spread across these topics:\n- ${atpTopicList}${focusHint}`;
  } else if (isExam && t === 2) {
    const t1List = examTerm1Topics.join('\n  - ');
    const t2List = examTerm2Topics.join('\n  - ');
    topicInstruction = `TERM 2 EXAM — THIS IS AN EXAM TERM. CAPS requires BOTH Term 1 AND Term 2 content.

⚠️ CRITICAL SPLIT RULE — NON-NEGOTIABLE:
Approximately 50% of marks must come from Term 1 topics and 50% from Term 2 topics.
The difference between the two terms must NEVER exceed 70%/30%.
A paper using ONLY Term 1 topics is WRONG and will be rejected.
A paper using ONLY Term 2 topics is WRONG and will be rejected.
You MUST include questions from BOTH lists below.

TERM 1 TOPICS for Grade ${g} ${subject} (approximately ${Math.round(totalMarks * 0.5)} marks from here):
  - ${t1List}

TERM 2 TOPICS for Grade ${g} ${subject} (approximately ${Math.round(totalMarks * 0.5)} marks from here):
  - ${t2List}${focusHint}`;
  } else if (isExam && t === 4) {
    const t3List = examTerm3Topics.join('\n  - ');
    const t4List = examTerm4Topics.join('\n  - ');
    topicInstruction = `TERM 4 EXAM — THIS IS AN EXAM TERM. CAPS requires BOTH Term 3 AND Term 4 content.

⚠️ CRITICAL SPLIT RULE — NON-NEGOTIABLE:
Approximately 50% of marks must come from Term 3 topics and 50% from Term 4 topics.
The difference between the two terms must NEVER exceed 70%/30%.
A paper using ONLY Term 3 topics is WRONG and will be rejected.
A paper using ONLY Term 4 topics is WRONG and will be rejected.
You MUST include questions from BOTH lists below.

TERM 3 TOPICS for Grade ${g} ${subject} (approximately ${Math.round(totalMarks * 0.5)} marks from here):
  - ${t3List}

TERM 4 TOPICS for Grade ${g} ${subject} (approximately ${Math.round(totalMarks * 0.5)} marks from here):
  - ${t4List}${focusHint}`;
  } else {
    topicInstruction = `TERM ${t} ASSESSMENT — covers ONLY Term ${t} topics (CAPS rule: Term 1 and Term 3 assessments test only that term's work).\nQuestions MUST be drawn ONLY from these CAPS-prescribed Grade ${g} Term ${t} topics:\n- ${atpTopicList}${focusHint}\n\nDO NOT include topics from other terms — this is a strict CAPS compliance requirement.`;
  }
 
  // ═══════════════════════════════════════
  // DOCX HELPERS
  // ═══════════════════════════════════════
  const FONT = 'Arial';
  const GREEN = '085041';
  const bdr = { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' };
  const cellBorders = { top: bdr, bottom: bdr, left: bdr, right: bdr };
 
  function txt(text, opts = {}) {
    return new TextRun({ text: String(text), font: FONT, size: opts.size || 22, bold: !!opts.bold, color: opts.color || '000000', italics: !!opts.italics });
  }
 
  function para(content, opts = {}) {
    const children = typeof content === 'string' ? [txt(content, opts)] : content;
    return new Paragraph({
      children,
      spacing: { before: opts.spaceBefore || 0, after: opts.spaceAfter || 60 },
      alignment: opts.align || AlignmentType.LEFT,
      indent: opts.indent,
      tabStops: opts.tabStops
    });
  }
 
  function sectionHead(text) {
    return para(text, { bold: true, size: 26, color: GREEN, spaceBefore: 300, spaceAfter: 120 });
  }
 
  function questionHead(text) {
    return new Paragraph({
      children: [txt(text, { bold: true, size: 24 })],
      spacing: { before: 240, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } }
    });
  }
 
  function numQ(num, text) {
    return new Paragraph({
      children: [txt(num, { bold: true }), new TextRun({ text: '\t', font: FONT }), txt(text)],
      tabStops: [{ type: TabStopType.LEFT, position: 900 }],
      indent: { left: 900, hanging: 900 },
      spacing: { before: 120, after: 40 }
    });
  }
 
  function optLine(text) {
    return para(text, { indent: { left: 1200 }, spaceAfter: 20 });
  }
 
  function blankLine() {
    return para('_______________________________________________', { indent: { left: 900 }, spaceAfter: 80 });
  }
 
  function workLine() {
    return para([txt('Working: ', { bold: true, size: 20 }), txt('_______________________________________________', { size: 20 })], { indent: { left: 900 }, spaceAfter: 20 });
  }
 
  function ansLine() {
    return para([txt('Answer: ', { bold: true, size: 20 }), txt('_______________________________________________', { size: 20 })], { indent: { left: 900 }, spaceAfter: 80 });
  }
 
  function cell(text, opts = {}) {
    return new TableCell({
      children: [new Paragraph({
        children: [txt(String(text), { size: opts.size || 18, bold: !!opts.bold, color: opts.color || '000000' })],
        alignment: opts.align || AlignmentType.LEFT
      })],
      width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
      shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
      borders: cellBorders
    });
  }
 
  function tbl(headers, rows) {
    const hRow = new TableRow({
      children: headers.map(h => new TableCell({
        children: [new Paragraph({ children: [txt(String(h), { size: 18, bold: true, color: 'FFFFFF' })], alignment: AlignmentType.LEFT })],
        shading: { fill: GREEN, type: ShadingType.SOLID },
        borders: cellBorders,
        margins: { top: 60, bottom: 60, left: 120, right: 120 }
      }))
    });
    const dRows = rows.map(r => new TableRow({ children: r.map(c => cell(c)) }));
    return new Table({ rows: [hRow, ...dRows], width: { size: 9026, type: WidthType.DXA } });
  }
 
  // ═══════════════════════════════════════
  // COVER PAGE
  // ═══════════════════════════════════════
  function buildCover(actualMarks) {
    const displayMarks = actualMarks || totalMarks;
    const els = [];
 
    els.push(para('THE RESOURCE ROOM', { bold: true, size: 28, color: GREEN, align: AlignmentType.CENTER, spaceAfter: 60 }));
    els.push(para(resourceType.toUpperCase(), { bold: true, size: 36, align: AlignmentType.CENTER, spaceAfter: 60 }));
    els.push(para(subject, { bold: true, size: 28, align: AlignmentType.CENTER, spaceAfter: 160 }));
 
    const noBorder = { style: BorderStyle.NIL, size: 0, color: 'FFFFFF' };
    const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
 
    els.push(new Table({
      width: { size: 9026, type: WidthType.DXA }, columnWidths: [4513, 4513],
      rows: [new TableRow({ children: [
        new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('Grade ' + g, { size: 24, bold: true })] })] }),
        new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('Term ' + t, { size: 24, bold: true })], alignment: AlignmentType.RIGHT })] })
      ]})]
    }));
    els.push(para('', { spaceAfter: 60 }));
 
    els.push(new Table({
      width: { size: 9026, type: WidthType.DXA }, columnWidths: [4513, 4513],
      rows: [
        new TableRow({ children: [
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('Name: ___________________________', { size: 22 })] })] }),
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('Date: ___________________', { size: 22 })], alignment: AlignmentType.RIGHT })] })
        ]}),
        new TableRow({ children: [
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('Surname: ________________________', { size: 22 })] })] }),
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('', { size: 22 })] })] })
        ]})
      ]
    }));
    els.push(para('', { spaceAfter: 40 }));
 
    if (!isWorksheet) {
      els.push(new Table({
        width: { size: 9026, type: WidthType.DXA }, columnWidths: [4513, 4513],
        rows: [new TableRow({ children: [
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('Examiner: ______________________', { size: 22 })] })] }),
          new TableCell({ borders: noBorders, width: { size: 4513, type: WidthType.DXA }, children: [new Paragraph({ children: [txt('Time: ' + timeAllocation, { size: 22, bold: true })], alignment: AlignmentType.RIGHT })] })
        ]})]
      }));
      els.push(para('', { spaceAfter: 80 }));
    }
 
    const scoreBdr = { style: BorderStyle.SINGLE, size: 4, color: '085041' };
    const scoreBorders = { top: scoreBdr, bottom: scoreBdr, left: scoreBdr, right: scoreBdr };
    const colW = [3611, 1805, 1805, 1805];
    const cm = (w, children, align) => new TableCell({ borders: scoreBorders, width: { size: w, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children, alignment: align || AlignmentType.LEFT })] });
    els.push(new Table({
      width: { size: 9026, type: WidthType.DXA }, columnWidths: colW,
      rows: [
        new TableRow({ children: [cm(colW[0], [txt('Total', { bold: true, size: 20 })]), cm(colW[1], [txt(String(displayMarks), { bold: true, size: 20 })], AlignmentType.CENTER), cm(colW[2], [txt('%', { bold: true, size: 20 })], AlignmentType.CENTER), cm(colW[3], [txt('Code', { bold: true, size: 20 })], AlignmentType.CENTER)] }),
        new TableRow({ children: [cm(colW[0], [txt('Comments:', { bold: true, size: 18 })]), new TableCell({ borders: scoreBorders, columnSpan: 3, width: { size: colW[1]+colW[2]+colW[3], type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [txt('', { size: 18 })] })] })] })
      ]
    }));
    els.push(para('', { spaceAfter: 120 }));
 
    els.push(new Paragraph({ children: [txt('Instructions:', { bold: true, size: 22 })], spacing: { before: 0, after: 60 } }));
    for (const item of ['Read the questions properly.', 'Answer ALL the questions.', 'Show all working where required.', 'Pay special attention to the mark allocation of each question.']) {
      els.push(new Paragraph({ children: [txt('•  ' + item, { size: 22 })], indent: { left: 360 }, spacing: { before: 0, after: 40 } }));
    }
    els.push(para('', { spaceAfter: 160 }));
    return els;
  }
 
  // ═══════════════════════════════════════
  // TEXT → DOCX ELEMENTS
  // ═══════════════════════════════════════
  function parseText(text) {
    const lines = text.split('\n');
    const els = [];
    for (let i = 0; i < lines.length; i++) {
      const tr = lines[i].trim();
      if (!tr) { els.push(para('', { spaceAfter: 40 })); continue; }
      if (/^[═━─\-_]{3,}$/.test(tr)) continue;
      if (/^\|[\s\-:]+\|/.test(tr)) continue;
      if (/^#{1,3}\s+/.test(tr)) { els.push(sectionHead(tr.replace(/^#+\s+/, ''))); continue; }
      if (/^SECTION\s+[A-Z]/i.test(tr) || /^AFDELING\s+[A-Z]/i.test(tr)) { els.push(sectionHead(tr)); continue; }
      if (/^Question\s+\d+/i.test(tr) || /^Vraag\s+\d+/i.test(tr)) { els.push(questionHead(tr)); continue; }
      if (/^TOTAL/i.test(tr) || /^TOTAAL/i.test(tr)) { els.push(para(tr, { bold: true, size: 24, color: GREEN, spaceBefore: 200 })); continue; }
      if (/^MEMORANDUM/i.test(tr)) { els.push(sectionHead('MEMORANDUM')); continue; }
      if (/^COGNITIVE LEVEL/i.test(tr)) { els.push(sectionHead(tr)); continue; }
      if (/^EXTENSION/i.test(tr) || /^ENRICHMENT/i.test(tr)) { els.push(sectionHead(tr)); continue; }
      if (/^MARKING RUBRIC/i.test(tr) || /^RUBRIC/i.test(tr)) { els.push(sectionHead(tr)); continue; }
      if (/^\[\d+\]$/.test(tr)) { els.push(para(tr, { bold: true, align: AlignmentType.RIGHT })); continue; }
      const nm = tr.match(/^(\d+[\.\d]*)\s+(.*)/);
      if (nm && /^\d+\.\d+/.test(tr)) { els.push(numQ(nm[1], nm[2])); continue; }
      if (/^[a-d]\.\s/.test(tr)) { els.push(optLine(tr)); continue; }
      if (/^Answer:/i.test(tr) || /^Antwoord:/i.test(tr)) { els.push(ansLine()); continue; }
      if (/^Working:/i.test(tr) || /^Werking:/i.test(tr)) { els.push(workLine()); continue; }
      if (/^_{5,}$/.test(tr)) { els.push(blankLine()); continue; }
      if (tr.includes('|') && tr.split('|').filter(c => c.trim()).length >= 2) {
        const rows = [tr];
        while (i + 1 < lines.length) {
          const nx = lines[i + 1].trim();
          if (/^[|\s\-:]+$/.test(nx)) { i++; continue; }
          if (nx.includes('|') && nx.split('|').filter(c => c.trim()).length >= 2) { rows.push(nx); i++; }
          else break;
        }
        const parsed = rows.map(r => r.split('|').map(c => c.trim()).filter(c => c));
        if (parsed.length > 1) els.push(tbl(parsed[0], parsed.slice(1)));
        else els.push(para(tr));
        continue;
      }
      els.push(para(tr));
    }
    return els;
  }
 
  // ═══════════════════════════════════════
  // BUILD DOCUMENT
  // ═══════════════════════════════════════
  function stripBrandHeader(text) {
    return text.split('\n').filter(line => {
      const t = line.trim().replace(/\*+/g, '').trim();
      return !/^THE RESOURCE ROOM\s*$/i.test(t);
    }).join('\n');
  }
 
  function buildDoc(qText, mText, actualMarks) {
    const cleanQ = stripBrandHeader(qText);
    const cleanM = stripBrandHeader(mText);
    const cover = isWorksheet
      ? [para(subject + ' — Worksheet', { bold: true, size: 28, align: AlignmentType.CENTER, spaceAfter: 80 }),
         para('Grade ' + g + '  |  Term ' + t + '  |  ' + language, { align: AlignmentType.CENTER, spaceAfter: 40 }),
         para([txt('Name: ___________________________'), txt('     Date: ___________________')], { spaceAfter: 40 }),
         para('Total: _____ / ' + totalMarks + ' marks', { bold: true, spaceAfter: 120 })]
      : buildCover(actualMarks);
    return new Document({
      styles: { default: { document: { run: { font: FONT, size: 22 } } } },
      sections: [{
        properties: { page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } },
        headers: { default: new Header({ children: [para('THE RESOURCE ROOM', { size: 16, color: '999999', align: AlignmentType.RIGHT })] }) },
        footers: { default: new Footer({ children: [para('© The Resource Room  |  CAPS Grade ' + g + ' Term ' + t + '  |  ' + subject, { size: 16, color: '999999', align: AlignmentType.CENTER })] }) },
        children: [...cover, ...parseText(cleanQ), ...parseText(cleanM)]
      }]
    });
  }
 
  // ═══════════════════════════════════════
  // CLAUDE API
  // ═══════════════════════════════════════
  async function callClaude(system, user, maxTok) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTok, system, messages: [{ role: 'user', content: user }] })
      });
      const text = await r.text();
      if (!r.ok) throw new Error(JSON.parse(text).error?.message || 'API error ' + r.status);
      let raw = JSON.parse(text).content?.map(c => c.text || '').join('') || '';
      raw = raw.replace(/```json|```/g, '').trim();
      try { return JSON.parse(raw).content || raw; } catch(e) {
        let c = raw.replace(/^\s*\{\s*"content"\s*:\s*"/, '').replace(/"\s*\}\s*$/, '');
        return c.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
      }
    } catch(err) {
      if (err.name === 'AbortError') throw new Error('Generation is taking longer than usual. Please try again — complex resources can take up to 2 minutes.');
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
 
  // ═══════════════════════════════════════
  // SAFE CONTENT EXTRACTOR
  // ═══════════════════════════════════════
  function safeExtractContent(raw) {
    if (!raw || typeof raw !== 'string') return raw;
    let text = raw.trim();
    text = text.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim();
    text = text.replace(/^\{\s*"content"\s*:\s*"/, '').replace(/"\s*\}\s*$/, '').trim();
    if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text);
        if (parsed.content) return parsed.content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
      } catch(e) {}
    }
    const lines = text.split('\n');
    let startIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (/^(SECTION|AFDELING|Question\s+\d|Vraag\s+\d|\d+\.\d|TOTAL:|TOTAAL:|MEMORANDUM)/i.test(l)) {
        startIdx = i;
        break;
      }
      if (l.startsWith('{"content"')) {
        const remainder = lines.slice(i).join('\n');
        return safeExtractContent(remainder);
      }
    }
    if (startIdx > 0) text = lines.slice(startIdx).join('\n');
    return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
  }
 
  // ═══════════════════════════════════════
  // CLEANUP — remove AI meta-commentary
  // ═══════════════════════════════════════
  function cleanOutput(text) {
    const lines = text.split('\n').filter(line => {
      const t = line.trim().toUpperCase();
      const tr = line.trim();
      if (/^STEP\s+\d+\s*[—\-–]?/i.test(tr)) return false;
      if (/^STEP\s+\d+$/i.test(tr)) return false;
      if (t.startsWith('CORRECTED ') || t.startsWith('UPDATED ')) return false;
      if (t.includes('CORRECTED MEMORANDUM') || t.includes('CORRECTED COGNITIVE')) return false;
      if (t.startsWith('NOTE:') || t.startsWith('NOTE ') || t.startsWith('NOTE TO')) return false;
      if (t.includes('DISCREPANCY') || t.includes('RECONCILIATION')) return false;
      if (t.startsWith('REVISED ') || t.startsWith('FINAL INSTRUCTION') || t.startsWith('FINAL CONFIRMED')) return false;
      if (t.startsWith('RECOMMENDED ADJUSTMENT') || t.startsWith('TEACHERS SHOULD')) return false;
      if (t.startsWith('RECOUNT:') || t.startsWith('RE-EXAMINE') || t.startsWith('RE-COUNT')) return false;
      if (t.startsWith('VERIFY:') || t.startsWith('VERIFY ALL') || t.startsWith('CHECK:')) return false;
      if (t.includes('ALREADY COUNTED') || t.includes('CUMULATIVE')) return false;
      if (t.startsWith('THAT GIVES') || t.startsWith('THIS GIVES')) return false;
      if (t.startsWith('SO ROUTINE') || t.startsWith('SO COMPLEX') || t.startsWith('SO KNOWLEDGE')) return false;
      if (/^(KNOWLEDGE|ROUTINE|COMPLEX|PROBLEM|LOW|MIDDLE|HIGH|LITERAL|REORGAN|INFERENTIAL|EVALUATION)\s+ROWS?:/i.test(tr)) return false;
      if (/^(\*{0,2})THE RESOURCE ROOM(\*{0,2})\s*$/i.test(tr)) return false;
      if (/^MARKS?:/i.test(tr) && /written as|include also|one question/i.test(tr)) return false;
      if (/^\(\d+\)\s*\+\s*\(\d+\)/.test(tr)) return false;
      if (/^\[diagram/i.test(tr) || /^\[figure/i.test(tr) || /^\[image/i.test(tr)) return false;
      if (/^\[an angle/i.test(tr) || /^\[a shape/i.test(tr)) return false;
      if (/^TRY\s+/i.test(tr) || /^USE\s+\*\*/i.test(tr)) return false;
      if (/^NEW DATA SET/i.test(tr) || /^CHECKING CONSISTENCY/i.test(tr)) return false;
      if (/^LET ME TRY/i.test(tr) || /^LET'S TRY/i.test(tr)) return false;
      if (/^WAIT\s*[—\-–]/i.test(tr) || t.startsWith('WAIT ')) return false;
      if (/^I MUST RECHECK/i.test(tr) || /^LET ME RECHECK/i.test(tr)) return false;
      if (/^RECHECK:/i.test(tr) || /^CHECKING:/i.test(tr)) return false;
      if (/^COST\s*=/i.test(tr) || /^INCOME\s*=/i.test(tr)) return false;
      if (/^SINCE\s+R\d/i.test(tr)) return false;
      if (/^I NEED TO/i.test(tr) || /^LET ME VERIFY/i.test(tr)) return false;
      if (/^CURRENT TOTALS?:/i.test(tr) || /^LET ME RECOUNT/i.test(tr)) return false;
      if (/^REDUCE BY/i.test(tr)) return false;
      return true;
    });
 
    const cleaned = lines.map(line => {
      if (line.length > 300 && /recount|already counted|cumulative|verify|reconcil/i.test(line) && /\d+\s*\+\s*\d+/.test(line)) return '';
      return line;
    });
 
    const result = [];
    let blanks = 0;
    for (const line of cleaned) {
      if (line.trim() === '') { blanks++; if (blanks <= 1) result.push(line); }
      else { blanks = 0; result.push(line); }
    }
 
    const cogHeadingRx = /COGNITIVE LEVEL/i;
    const cogTableRowRx = /Prescribed\s*%/i;
    let cogCount = 0;
    const deduped = [];
    for (const line of result) {
      if (cogHeadingRx.test(line) || cogTableRowRx.test(line)) {
        cogCount++;
        if (cogCount === 2) break;
      }
      deduped.push(line);
    }
    return deduped.join('\n');
  }
 
  // ═══════════════════════════════════════
  // MARK COUNTER
  // ═══════════════════════════════════════
  function countMarks(text) {
    let total = 0;
    const markPattern = /\((\d+)\)\s*$/gm;
    let match;
    while ((match = markPattern.exec(text)) !== null) total += parseInt(match[1]);
    if (total === 0) {
      const blockPattern = /\[(\d+)\]/g;
      while ((match = blockPattern.exec(text)) !== null) total += parseInt(match[1]);
    }
    return total;
  }
 
  // ═══════════════════════════════════════
  // COGNITIVE LEVEL TYPE RULES
  // ═══════════════════════════════════════
  const LOW_DEMAND_TYPES = ['MCQ', 'True/False', 'True-False', 'Matching', 'True or False'];
  const maxLowDemandMarks = cogMarks[0];
  const highDemandLevels = cog.levels.slice(Math.max(0, cog.levels.length - 2));
 
  // ═══════════════════════════════════════
  // PHASE 1 — PLAN VALIDATOR
  // ═══════════════════════════════════════
  function validatePlan(plan) {
    if (!plan || !Array.isArray(plan.questions) || plan.questions.length === 0) return null;
    const planTotal = plan.questions.reduce((s, q) => s + (parseInt(q.marks) || 0), 0);
    if (planTotal !== totalMarks) { console.log(`Plan total ${planTotal} !== requested ${totalMarks} — rejecting`); return null; }
    const cogActual = {};
    cog.levels.forEach(l => cogActual[l] = 0);
    for (const q of plan.questions) { const lvl = q.cogLevel; if (cogActual[lvl] !== undefined) cogActual[lvl] += parseInt(q.marks) || 0; }
    for (let i = 0; i < cog.levels.length; i++) {
      const actual = cogActual[cog.levels[i]] || 0;
      const target = cogMarks[i];
      if (Math.abs(actual - target) > cogTolerance) { console.log(`Cog level "${cog.levels[i]}" has ${actual} marks, target ${target} ±${cogTolerance} — rejecting`); return null; }
    }
    const lowDemandTotal = plan.questions.filter(q => LOW_DEMAND_TYPES.some(t => (q.type || '').toLowerCase().includes(t.toLowerCase()))).reduce((s, q) => s + (parseInt(q.marks) || 0), 0);
    if (lowDemandTotal > maxLowDemandMarks) { console.log(`Low-demand types total ${lowDemandTotal} marks, max ${maxLowDemandMarks} — rejecting`); return null; }
    for (const q of plan.questions) {
      const isHighLevel = highDemandLevels.includes(q.cogLevel);
      const isLowType = LOW_DEMAND_TYPES.some(t => (q.type || '').toLowerCase().includes(t.toLowerCase()));
      if (isHighLevel && isLowType) { console.log(`Q${q.number} is ${q.cogLevel} but uses ${q.type} — rejecting`); return null; }
    }
    return plan;
  }
 
  // ═══════════════════════════════════════
  // PROMPTS
  // ═══════════════════════════════════════
  const taxLabel = isBarretts ? 'Barrett\'s Taxonomy' : 'Bloom\'s Taxonomy (DoE cognitive levels)';
 
  const planSys = `You are a South African CAPS ${phase} Phase assessment designer.
Return ONLY valid JSON — no markdown, no explanation.
Schema: {"questions":[{"number":"Q1","type":"MCQ","topic":"string","marks":5,"cogLevel":"${cog.levels[0]}"},...]}
cogLevel must be exactly one of: ${cog.levels.join(' | ')}`;
 
  const planUsr = `Design a ${totalMarks}-mark ${resourceType} question plan for: Grade ${g} ${subject} Term ${t} in ${language}.
 
${topicInstruction}
 
${taxLabel} cognitive level targets — marks must hit each level within ±${cogTolerance} marks:
${cog.levels.map((l, i) => `  ${l}: ${cogMarks[i]} marks (${cog.pcts[i]}%)`).join('\n')}
 
QUESTION TYPE RULES — strict and non-negotiable:
1. MCQ and True/False questions are LOW DEMAND — they address recall only.
   Total marks from MCQ + True/False combined must NOT exceed ${cogMarks[0]} marks.
   MCQ and True/False can ONLY serve the "${cog.levels[0]}" level.
 
2. The following levels MUST use higher-order question types:
${cog.levels.slice(1).map((l, i) => '   "' + l + '": use ' + (i === 0 ? 'Short Answer, Structured Question, Fill in the blank, Calculations' : i === cog.levels.length - 2 ? 'Multi-step, Structured Question, Analysis, Problem-solving' : 'Word Problem, Extended Response, Essay, Investigation')).join('\n')}
3. Every question must have: number (Q1, Q2...), type, topic (must be from the ATP list above), marks (whole number ≥ 1), cogLevel
4. Questions must sum to EXACTLY ${totalMarks} marks
5. Minimum ${isWorksheet ? '4' : '6'} questions — spread topics across all prescribed ATP topics above
 
Return only the JSON object, nothing else.`;
 
  const qSys = (plan) => `You are a South African CAPS ${phase} Phase teacher writing a ${resourceType} question paper in ${language}.
Use SA context (rands, names: Sipho, Ayanda, Zanele, Thandi, Pieter, Anri, SA places like Johannesburg, Cape Town, Durban, Pretoria).
DIFFICULTY: ${diffNote}
CAPS: Grade ${g} Term ${t} ${subject}
 
CRITICAL TOPIC RULE — NON-NEGOTIABLE:
This assessment covers ONLY these CAPS-prescribed topics for Grade ${g} ${subject}:
- ${atpTopicList}
Do NOT include questions on topics from other terms. This is a CAPS compliance requirement.
Every question topic field in the plan maps to this list — trust the plan.
 
CRITICAL: Follow the question plan EXACTLY. Do not change any mark values. Do not add or remove questions.
The plan guarantees CAPS cognitive level compliance — trust it and write accordingly.
 
DO NOT INCLUDE:
- NO cover page, title, header, name/date fields, or instructions — start DIRECTLY with Question 1 or SECTION A
- NO cognitive level labels in the learner paper
- NO notes, commentary, or meta-text of any kind
 
NO DIAGRAMS RULE (applies to ALL subjects — non-negotiable):
This system cannot render diagrams, graphs, drawings, or images.
Do NOT write any question requiring the learner to look at a drawn diagram, drawn shape, drawn graph, drawn map, or drawn image.
INSTEAD use text-only alternatives:
- Angles: provide the value → "An angle measures 65°. Classify this angle."
- Shapes: describe dimensions in words → "A rectangle is 10 cm long and 4 cm wide."
- Graphs/charts: provide data as a text table using pipe format
- Maps/scenarios: describe in words → "A garden is 14 m long and 9 m wide."
- Food webs/circuits/ecosystems: describe relationships in words or use a text table
This rule applies to EVERY subject. No exceptions.
 
FORMAT RULES:
- Numbering: Question 1: [heading] then 1.1, 1.2, 1.2.1 etc.
- EVERY sub-question MUST show its mark in brackets (X) on the SAME LINE as the question text
- MCQ: show (1) on the question line BEFORE the a. b. c. d. options
- True/False: statement then blank then (marks) all on ONE line
- Answer lines: _______________________________________________
- Working:/Answer: lines only for calculation questions
- Question block totals: [X] right-aligned at end of each question block
${isTest ? '- NO SECTION headers. Use Question 1, Question 2 etc.' : ''}
${isExamType ? '- USE SECTION A / B / C / D headers' : ''}
- Write fractions as plain text: 3/4 not ¾
- No Unicode box characters or Unicode fraction symbols
 
ORDERING QUESTION RULE:
- Never include two values that are mathematically equal
- Convert ALL values to decimals to verify all are distinct before writing

${subject.toLowerCase().includes('math') || subject.toLowerCase().includes('wiskunde') ? `MATHS NUMBER RANGE RULE FOR GRADE ${g}:
${g <= 4 ? '- Use numbers up to 4-digit (up to 9,999). Do NOT use 5-digit or larger numbers.' : ''}${g === 5 ? '- Use numbers up to 6-digit (up to 999,999). Do NOT use 7-digit or larger numbers.' : ''}${g === 6 ? `- Use numbers up to 9-digit where CAPS requires it, but VARY your number sizes:
  * Some questions must use small numbers (hundreds: 100–999)
  * Some questions must use medium numbers (thousands: 1,000–99,999)
  * Some questions must use large numbers only where CAPS explicitly requires it (up to 9 million max for Grade 6 tests)
  * Do NOT use numbers in the hundreds of millions (100,000,000+) — these are too large for Grade 6 tests
  * Whole number place value may go to 9-digit for ordering/comparing ONLY` : ''}${g === 7 ? '- Use numbers appropriate for Grade 7 — whole numbers up to 9-digit where needed, decimals to 3 places, fractions with mixed numbers. Vary sizes — not all numbers should be in the millions.' : ''}` : ''}
 
NO DIAGRAMS rule: Do not write "Use the diagram/graph/map/figure below."
End with: TOTAL: _____ / ${totalMarks} marks
Return JSON: {"content":"question paper text only"}`;
 
  const qUsr = (plan) => `Write the question paper following this EXACT plan:
${JSON.stringify(plan.questions, null, 2)}
 
Subject: ${subject} | Grade: ${g} | Term: ${t} | Language: ${language}
${topicInstruction}
Total must be: ${totalMarks} marks`;
 
  const mSys = `You are a South African CAPS Grade ${g} ${subject} teacher creating a memorandum in ${language}.
Use pipe | tables only. No Unicode box characters. Write fractions as plain text.
Output ONLY the memorandum content — no headings like "STEP 1", "CORRECTED", "Updated" etc.
No reasoning, notes or adjustments outside tables. Generate each cognitive level table ONCE only.
Do NOT question or adjust mark allocation — use marks exactly as shown in the paper.
 
COGNITIVE FRAMEWORK: ${taxLabel}
Levels used: ${cog.levels.join(', ')}
 
MEDIAN RULE: Sort ALL values from smallest to largest first. Count total n.
If n is odd: median = value at position (n+1)/2.
If n is even: median = average of values at positions n/2 and (n/2)+1.
Count position by position — do not skip repeated values.
 
STEM-AND-LEAF COUNT RULE: Count every individual leaf digit. Write count per stem, then add them.
 
DECIMAL ROUNDING RULE: Round non-terminating decimals to 1 decimal place. Use same value throughout.
 
COGNITIVE LEVEL TABLE RULE: Fill the table by mechanically adding MARK values per level from the memo rows above.
Actual Marks for each level MUST equal the sum of that level's rows. All Actual Marks MUST sum to the paper total.
 
Return JSON: {"content":"memorandum text"}`;
 
  const mUsrA = (qp, actualTotal, cogLevelRef) => `Grade ${g} ${subject} — ${resourceType} — Term ${t}
 
Question paper:
${qp}
 
This paper totals ${actualTotal} marks.
 
COGNITIVE LEVEL REFERENCE (${taxLabel}) — copy these exactly, do not change:
${cogLevelRef}
 
YOUR ONLY TASK: Write the MEMORANDUM TABLE.
Columns: NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK
 
- List EVERY SINGLE sub-question from the paper — scan every question block
- Include ALL sub-parts (e.g. 5.1a, 5.1b)
- Do NOT skip any question
- Use the EXACT (X) mark shown on each question line
- Copy COGNITIVE LEVEL from the reference above — do not reassign
- For financial questions: income > cost = PROFIT; cost > income = LOSS
- For stem-and-leaf: count every leaf individually
 
After the table write: TOTAL: ${actualTotal} marks
Do NOT write the cognitive level analysis table, extension activity, or rubric here.
Return JSON: {"content":"memorandum table and TOTAL line only"}`;
 
  const mUsrB = (memoTable, actualTotal) => `Grade ${g} ${subject} — ${resourceType} — Term ${t}
 
Completed memorandum table (${actualTotal} marks total):
${memoTable}
 
YOUR TASK: Write the following sections based on the table above.
 
SECTION: COGNITIVE LEVEL ANALYSIS (${taxLabel})
Write this pipe table:
Cognitive Level | Prescribed % | Prescribed Marks | Actual Marks | Actual %
${cog.levels.map((l, i) => l + ' | ' + cog.pcts[i] + '% | ' + cogMarks[i]).join('\n')}
 
For EACH row:
- Actual Marks = add up MARK column from memo table for all rows where COGNITIVE LEVEL matches
- Actual % = (Actual Marks ÷ ${actualTotal}) × 100, rounded to 1 decimal place
- All Actual Marks MUST sum to ${actualTotal}
 
Then write ONE summary line per level:
[Level] ([X] marks): Q1.1 (1) + Q2.3 (2) + ... = [X] marks
 
${!isWorksheet ? `SECTION: EXTENSION ACTIVITY
Write one challenging question beyond the paper scope. Include complete step-by-step model answer.` : ''}
 
${includeRubric ? `SECTION: MARKING RUBRIC
CRITERIA | Level 5 Outstanding (90-100%) | Level 4 Good (75-89%) | Level 3 Satisfactory (60-74%) | Level 2 Needs Improvement (40-59%) | Level 1 Not Achieved (0-39%)
Write 3-4 subject-relevant criteria rows for ${subject}.` : ''}
 
Return JSON: {"content":"cognitive level analysis + extension + rubric"}`;
 
  const mUsr = mUsrA;
 
  // ═══════════════════════════════════════
  // RESPONSE TO TEXT — 4-SECTION PIPELINE
  // Runs instead of the standard pipeline for English HL/FAL
  // and Afrikaans HL/FAL Response to Text papers
  // ═══════════════════════════════════════
  const isResponseToText = isBarretts && !isWorksheet;

  // Barrett's marks per section for a Response to Text paper:
  // Section A: Comprehension 20 marks  → own Barrett's
  // Section B: Visual text  10 marks  → own Barrett's
  // Section C: Summary       5 marks  → Reorganisation only
  // Section D: Language     15 marks  → own Barrett's
  // Total = 50 marks (standard). For non-50 papers, scale proportionally.
  function getRTTSectionMarks(total) {
    if (total === 50) return { a: 20, b: 10, c: 5, d: 15 };
    // Scale proportionally, round to whole numbers
    const scale = total / 50;
    const a = Math.round(20 * scale);
    const b = Math.round(10 * scale);
    const d = Math.round(15 * scale);
    const c = total - a - b - d;
    return { a, b, c: Math.max(c, 3), d };
  }

  // Barrett's marks per level for a given section total
  function getBarrettMarks(sectionTotal, includeSummaryOnly = false) {
    if (includeSummaryOnly) {
      // Summary is purely Reorganisation level
      return [0, sectionTotal, 0, 0];
    }
    return largestRemainder(sectionTotal, [20, 20, 40, 20]);
  }

  async function generateResponseToText() {
    const lang = language;
    const isAfrikan = subject.toLowerCase().includes('afrikaans');
    const secLabel = isAfrikan
      ? ['AFDELING A', 'AFDELING B', 'AFDELING C', 'AFDELING D']
      : ['SECTION A', 'SECTION B', 'SECTION C', 'SECTION D'];
    const sm = getRTTSectionMarks(totalMarks);

    // Shared passage — one literary or non-literary reading passage for Section A & C
    const passageSys = `You are a South African CAPS ${phase} Phase ${lang} teacher.
Write a reading passage suitable for Grade ${g} learners in ${lang}.
Use South African context, names (Sipho, Ayanda, Zanele, Thandi, Pieter, Anri), SA places, SA currency (rands).
The passage must be:
- A ${isAfrikan ? 'literêre of nie-literêre teks' : 'literary or non-literary text'}
- Appropriate reading level for Grade ${g}
- Between 250 and 350 words long
- Interesting and relevant to South African learners
- NOT about diagrams, maps or images (text only)
Return ONLY the passage text — no title instructions or commentary.`;
    const passageUsr = `Write the reading passage for a Grade ${g} ${subject} Term ${t} Response to Text paper.
Topic must align with CAPS Term ${t} ${subject} reading content.
Return only the passage.`;

    let passage = '';
    try {
      passage = await callClaude(passageSys, passageUsr, 1200);
      passage = passage.replace(/^```.*\n?/, '').replace(/```$/, '').trim();
    } catch(e) { passage = ''; }

    // Helper: build Barrett's table for a section
    function barretts(marks, includeSummaryOnly = false) {
      const bm = getBarrettMarks(marks, includeSummaryOnly);
      const levels = ['Literal', 'Reorganisation', 'Inferential', 'Evaluation and Appreciation'];
      const pcts = [20, 20, 40, 20];
      if (includeSummaryOnly) {
        return `| Cognitive Level | Prescribed % | Marks |\n|---|---|---|\n| Reorganisation | 100% | ${marks} |`;
      }
      return `| Cognitive Level | Prescribed % | Marks |\n|---|---|---|\n` +
        levels.map((l, i) => `| ${l} | ${pcts[i]}% | ${bm[i]} |`).join('\n');
    }

    // SECTION A — Comprehension (20 marks)
    const secASys = `You are a South African CAPS Grade ${g} ${subject} teacher writing ${secLabel[0]} of a Response to Text exam in ${lang}.
DIFFICULTY: ${diffNote}
This section tests COMPREHENSION ONLY — NO language/grammar questions here.
Language questions belong ONLY in Section D.
The reading passage is provided. All questions must refer to it.

Barrett's Taxonomy cognitive levels for this section (${sm.a} marks total):
${barretts(sm.a)}

FORMAT:
- Heading: ${secLabel[0]}: ${isAfrikan ? 'BEGRIP' : 'COMPREHENSION'} [${sm.a}]
- Sub-heading: ${isAfrikan ? 'Lees die gegewe teks en beantwoord die vrae wat volg.' : 'Read the passage and answer the questions that follow.'}
- Questions numbered 1.1, 1.2 … with mark in brackets (X) on same line
- Progress from Literal → Reorganisation → Inferential → Evaluation and Appreciation
- End with: [${sm.a}]
- NO grammar, vocabulary, figure of speech, or language structure questions
Return JSON: {"content":"Section A text only"}`;

    const secAUsr = `READING PASSAGE:\n${passage}\n\nWrite ${secLabel[0]} — Comprehension questions (${sm.a} marks) following the instructions exactly.`;

    // SECTION B — Visual Text (10 marks)
    const secBSys = `You are a South African CAPS Grade ${g} ${subject} teacher writing ${secLabel[1]} of a Response to Text exam in ${lang}.
This section tests VISUAL TEXT comprehension ONLY — NO language/grammar questions here.
Language questions belong ONLY in Section D.

IMPORTANT — NO DIAGRAMS RULE: This system cannot display actual images or posters.
Instead, describe a visual text in words (e.g. "Study the advertisement described below:" then describe layout, text, images, colours in words). Learners answer questions about the described visual.

Barrett's Taxonomy cognitive levels for this section (${sm.b} marks total):
${barretts(sm.b)}

FORMAT:
- Heading: ${secLabel[1]}: ${isAfrikan ? 'VISUELE TEKS' : 'VISUAL TEXT'} [${sm.b}]
- Describe the visual text in words (advertisement, poster, or cartoon)
- Sub-heading: ${isAfrikan ? 'Bestudeer die visuele teks hieronder en beantwoord die vrae.' : 'Study the visual text below and answer the questions.'}
- Questions numbered 2.1, 2.2 … with mark in brackets (X) on same line
- End with: [${sm.b}]
- NO grammar, vocabulary, or language structure questions
Return JSON: {"content":"Section B text only"}`;

    const secBUsr = `Write ${secLabel[1]} — Visual Text questions (${sm.b} marks) for Grade ${g} ${subject} Term ${t}.
Use SA context. Describe a visual in words (advertisement, poster or cartoon about an SA topic relevant to Grade ${g}).`;

    // SECTION C — Summary (5 marks)
    const secCSys = `You are a South African CAPS Grade ${g} ${subject} teacher writing ${secLabel[2]} of a Response to Text exam in ${lang}.
This section is a SUMMARY WRITING task ONLY — one question only.
Barrett's Taxonomy: This is a Reorganisation level task (selecting and organising key information).

FORMAT:
- Heading: ${secLabel[2]}: ${isAfrikan ? 'OPSOMMING' : 'SUMMARY'} [${sm.c}]
- Instruct learners to write a summary of the reading passage (from Section A) in their own words
- Specify maximum word count (about 50 words for 5 marks, scale accordingly)
- State exactly what the summary must include (e.g. main points, key ideas)
- Mark allocation: content marks + language/structure marks
- End with: [${sm.c}]
Return JSON: {"content":"Section C text only"}`;

    const secCUsr = `READING PASSAGE (from Section A):\n${passage}\n\nWrite ${secLabel[2]} — Summary task (${sm.c} marks).`;

    // SECTION D — Language Structures and Conventions
    const secDSys = `You are a South African CAPS Grade ${g} ${subject} teacher writing ${secLabel[3]} of a Response to Text exam in ${lang}.
THIS IS THE ONLY SECTION WHERE LANGUAGE/GRAMMAR QUESTIONS ARE ASKED.
Do NOT include comprehension questions here — only language structures and conventions.

Barrett's Taxonomy for this section (${sm.d} marks total):
${barretts(sm.d)}

CAPS Grade ${g} ${subject} Term ${t} Language topics to draw from:
${atpTopicList}

QUESTION TYPES (mix these — do not repeat the same type more than twice):
- Parts of speech (nouns, verbs, adjectives, adverbs, pronouns)
- Tense (change sentence from present to past, etc.)
- Active/Passive voice
- Direct/Indirect speech
- Punctuation and capitalisation
- Synonyms and antonyms
- Prefixes and suffixes
- Figures of speech (simile, metaphor, personification)
- Sentence structure (combine sentences, identify subject/predicate)
- Vocabulary in context
AVOID: conditional sentences and other Grade 7+ structures for Grade 6.

FORMAT:
- Heading: ${secLabel[3]}: ${isAfrikan ? 'TAALSTRUKTURE EN -KONVENSIES' : 'LANGUAGE STRUCTURES AND CONVENTIONS'} [${sm.d}]
- Questions numbered 4.1, 4.2 … with mark in brackets (X) on same line
- Mix question types — provide context sentences for each
- End with: [${sm.d}]
Return JSON: {"content":"Section D text only"}`;

    const secDUsr = `Write ${secLabel[3]} — Language Structures and Conventions (${sm.d} marks) for Grade ${g} ${subject} Term ${t} in ${lang}.`;

    // Generate all 4 sections in parallel
    console.log(`RTT Pipeline: generating 4 sections in parallel (${sm.a}+${sm.b}+${sm.c}+${sm.d}=${sm.a+sm.b+sm.c+sm.d} marks)`);
    const [secARaw, secBRaw, secCRaw, secDRaw] = await Promise.all([
      callClaude(secASys, secAUsr, 3000),
      callClaude(secBSys, secBUsr, 2000),
      callClaude(secCSys, secCUsr, 1000),
      callClaude(secDSys, secDUsr, 2500)
    ]);

    const secA = cleanOutput(safeExtractContent(secARaw));
    const secB = cleanOutput(safeExtractContent(secBRaw));
    const secC = cleanOutput(safeExtractContent(secCRaw));
    const secD = cleanOutput(safeExtractContent(secDRaw));

    // Assemble the full paper
    const passageHeading = isAfrikan ? 'LEESSTUK:' : 'READING PASSAGE:';
    const questionPaper = [
      passageHeading,
      '',
      passage,
      '',
      secA,
      '',
      secB,
      '',
      secC,
      '',
      secD,
      '',
      `TOTAL: _____ / ${totalMarks} marks`
    ].join('\n');

    console.log(`RTT Pipeline: paper assembled (${questionPaper.length} chars)`);

    // ── RTT Memo Phase 1: Section A (Comprehension) answers + Barrett's ──
    // Deliberately separate from the question paper generation to stay within token limits
    const rttMemoSys = `You are a South African CAPS Grade ${g} ${subject} teacher creating a memorandum for a Response to Text exam in ${lang}.
Use pipe | tables only. No Unicode box characters. No markdown headings with #.
Return JSON: {"content":"memorandum text"}`;

    const rttMemoUsrA = `${secLabel[0]} QUESTIONS (${sm.a} marks):
${secA}

Write the memo for ${secLabel[0]} ONLY:
1. Answer table with columns: NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK
   - List every sub-question (1.1, 1.2 … etc)
   - COGNITIVE LEVEL must be one of: Literal | Reorganisation | Inferential | Evaluation and Appreciation
   - Use the MARK shown in brackets on each question line
2. After the table, write a Barrett's Taxonomy summary for ${secLabel[0]} ONLY:
   | Barrett's Level | Questions | Marks Allocated | Marks as % of Section |
   All rows must sum to exactly ${sm.a} marks. Target: Literal 20%, Reorganisation 20%, Inferential 40%, Evaluation 20%.
3. End with: ${secLabel[0]} TOTAL: ${sm.a} marks

Return JSON: {"content":"Section A memo"}`;

    // ── RTT Memo Phase 2: Section B (Visual Text) + Section C (Summary) answers + Barrett's ──
    const rttMemoUsrB = `${secLabel[1]} QUESTIONS (${sm.b} marks):
${secB}

${secLabel[2]} QUESTION (${sm.c} marks):
${secC}

Write the memo for ${secLabel[1]} AND ${secLabel[2]}:

PART 1 — ${secLabel[1]} answer table: NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK
List every sub-question (2.1, 2.2 … etc). Use Literal/Reorganisation/Inferential/Evaluation and Appreciation.
Then write Barrett's Taxonomy summary for ${secLabel[1]} ONLY (must sum to ${sm.b} marks).
End with: ${secLabel[1]} TOTAL: ${sm.b} marks

PART 2 — ${secLabel[2]} answer table: NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK
This section is a summary task. Award marks for: content points included (award per bullet point met) + language/structure.
Cognitive level for summary = Reorganisation.
Then write Barrett's Taxonomy summary for ${secLabel[2]} ONLY (must sum to ${sm.c} marks — all Reorganisation).
End with: ${secLabel[2]} TOTAL: ${sm.c} marks

Return JSON: {"content":"Section B and C memo"}`;

    // ── RTT Memo Phase 3: Section D (Language) answers + Barrett's + combined paper table ──
    const rttMemoUsrD = `${secLabel[3]} QUESTIONS (${sm.d} marks):
${secD}

Write the memo for ${secLabel[3]}:
1. Answer table: NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK
   List every sub-question (4.1, 4.2 … etc). Use Literal/Reorganisation/Inferential/Evaluation and Appreciation.
2. Barrett's Taxonomy summary for ${secLabel[3]} ONLY (must sum to ${sm.d} marks).
3. End with: ${secLabel[3]} TOTAL: ${sm.d} marks

Then write the COMBINED PAPER BARRETT'S ANALYSIS:
Heading: COMBINED BARRETT'S TAXONOMY ANALYSIS — FULL PAPER (${totalMarks} marks)
Write this pipe table:
| Barrett's Level | Prescribed % | Prescribed Marks | Actual Marks | Actual % |
| Literal | 20% | ${largestRemainder(totalMarks,[20,20,40,20])[0]} | [sum from all sections] | [%] |
| Reorganisation | 20% | ${largestRemainder(totalMarks,[20,20,40,20])[1]} | [sum from all sections] | [%] |
| Inferential | 40% | ${largestRemainder(totalMarks,[20,20,40,20])[2]} | [sum from all sections] | [%] |
| Evaluation and Appreciation | 20% | ${largestRemainder(totalMarks,[20,20,40,20])[3]} | [sum from all sections] | [%] |
| TOTAL | 100% | ${totalMarks} | [must equal ${totalMarks}] | 100% |

Actual Marks per level = sum across ALL four sections. All Actual Marks must total exactly ${totalMarks}.

Return JSON: {"content":"Section D memo and combined Barrett's"}`;

    console.log(`RTT Memo: generating in 3 phases (A / B+C / D+combined)`);
    const [memoARaw, memoBCRaw, memoDRaw] = await Promise.all([
      callClaude(rttMemoSys, rttMemoUsrA, 4000),
      callClaude(rttMemoSys, rttMemoUsrB, 4000),
      callClaude(rttMemoSys, rttMemoUsrD, 4000)
    ]);

    const memoA  = cleanOutput(safeExtractContent(memoARaw));
    const memoBC = cleanOutput(safeExtractContent(memoBCRaw));
    const memoD  = cleanOutput(safeExtractContent(memoDRaw));

    const memoContent = [
      'MEMORANDUM',
      '',
      `Grade ${g} ${subject} — Response to Text — Term ${t}`,
      `CAPS Aligned | Barrett\'s Taxonomy Framework`,
      '',
      memoA,
      '',
      memoBC,
      '',
      memoD
    ].join('\n');

    console.log(`RTT Memo: complete (${memoContent.length} chars — A:${memoARaw.length} BC:${memoBCRaw.length} D:${memoDRaw.length})`);

    const markTotal = totalMarks; // RTT papers use fixed mark total

    // Build DOCX
    let docxBase64 = null;
    const filename = (subject + '-ResponseToText-Grade' + g + '-Term' + t).replace(/[^a-zA-Z0-9\-]/g, '-') + '.docx';
    try {
      const doc = buildDoc(questionPaper, memoContent, markTotal);
      const buffer = await Packer.toBuffer(doc);
      docxBase64 = buffer.toString('base64');
    } catch(docxErr) { console.error('RTT DOCX build error:', docxErr.message); }

    const preview = questionPaper + '\n\n' + memoContent;
    return res.status(200).json({ docxBase64, preview, filename });
  }

  // ═══════════════════════════════════════
  // EXECUTE — multi-phase generation
  // ═══════════════════════════════════════
  try {
    // Route Barrett's subjects to the dedicated RTT pipeline
    if (isResponseToText) {
      return await generateResponseToText();
    }

    // ── Phase 1: Generate & validate question plan ──
    let plan = null;
    let planAttempts = 0;
    while (!plan && planAttempts < 2) {
      planAttempts++;
      try {
        const rawPlan = await callClaude(planSys, planUsr, 1500);
        let parsedPlan;
        try { parsedPlan = typeof rawPlan === 'object' ? rawPlan : JSON.parse(rawPlan); }
        catch(e) { console.log(`Plan attempt ${planAttempts}: JSON parse failed`); continue; }
        plan = validatePlan(parsedPlan);
        if (!plan) console.log(`Plan attempt ${planAttempts}: validation failed`);
      } catch(e) { console.log(`Plan attempt ${planAttempts}: error — ${e.message}`); }
    }
 
    if (!plan) {
      console.log('Plan validation failed — using JS fallback plan');
      const fallbackQuestions = [];
      const typeByLevel = ['MCQ', 'Short Answer', 'Multi-step', 'Word Problem'];
      cog.levels.forEach((lvl, li) => {
        let lvlMarks = cogMarks[li];
        const qType = typeByLevel[Math.min(li, typeByLevel.length - 1)];
        const chunkSize = li === 0 ? 5 : 10;
        while (lvlMarks > 0) {
          const chunk = Math.min(lvlMarks, chunkSize);
          fallbackQuestions.push({ number: 'Q' + (fallbackQuestions.length + 1), type: qType, topic: atpTopics[0] || subject, marks: chunk, cogLevel: lvl });
          lvlMarks -= chunk;
        }
      });
      plan = { questions: fallbackQuestions };
      console.log(`Fallback plan: ${fallbackQuestions.length} questions, ${fallbackQuestions.reduce((s,q)=>s+q.marks,0)} marks`);
    }
 
    console.log(`Plan validated: ${plan.questions.length} questions, ${plan.questions.reduce((s,q)=>s+q.marks,0)} marks`);
 
    // ── Phase 2: Write questions from validated plan ──
    const qTok = isWorksheet ? 3000 : (isExamType) ? 5500 : 4500;
    let questionPaper = await callClaude(qSys(plan), qUsr(plan), qTok);
    questionPaper = cleanOutput(questionPaper);
 
    // ── Phase 2a: Mark drift correction ──
    const countedAfterP2 = countMarks(questionPaper);
    const drift = countedAfterP2 - totalMarks;
    if (countedAfterP2 > 0 && drift !== 0) {
      console.log(`Mark drift: counted=${countedAfterP2}, target=${totalMarks}, drift=${drift > 0 ? '+' : ''}${drift}`);
      const corrSys = `You are correcting a ${subject} ${resourceType} question paper. The paper totals ${countedAfterP2} marks but must total EXACTLY ${totalMarks} marks. ${drift > 0 ? 'Reduce' : 'Increase'} the total by ${Math.abs(drift)} mark${Math.abs(drift) > 1 ? 's' : ''}.
RULES: Change minimum sub-question mark values needed. Only change (X) numbers — not content. Keep Working:/Answer: lines. Return JSON: {"content":"complete corrected question paper"}`;
      const corrUsr = `Paper totals ${countedAfterP2}, must be EXACTLY ${totalMarks}. ${drift > 0 ? 'Reduce' : 'Increase'} by ${Math.abs(drift)}.\n\nPAPER:\n${questionPaper}\n\nReturn the complete corrected paper.`;
      try {
        const corrected = cleanOutput(await callClaude(corrSys, corrUsr, qTok));
        const countedAfterCorr = countMarks(corrected);
        if (countedAfterCorr === totalMarks) { questionPaper = corrected; console.log(`Correction successful: ${countedAfterCorr} marks ✓`); }
        else console.log(`Correction resulted in ${countedAfterCorr} marks — keeping Phase 2 paper`);
      } catch(corrErr) { console.log(`Correction failed: ${corrErr.message}`); }
    } else if (countedAfterP2 === totalMarks) {
      console.log(`Phase 2 exact: ${countedAfterP2} marks ✓`);
    }
 
    const finalCount = countMarks(questionPaper);
    const markTotal = finalCount > 0 ? finalCount : totalMarks;
    console.log(`Final mark total: ${markTotal}`);
 
    // ── Phase 2b: Question Quality Check ──
    const qQualitySys = `You are a South African CAPS examiner reviewing a question paper for design flaws.
Return ONLY valid JSON — no markdown.
Check for:
1. ORDERING_EQUAL_VALUES — ordering question where two or more values are mathematically equal
2. MCQ_MULTIPLE_CORRECT — MCQ where more than one option is correct
3. MCQ_NO_CORRECT — MCQ where no option is correct
4. DATA_AMBIGUOUS — data set where multiple modes exist but question says "the mode"
5. QUESTION_IMPOSSIBLE — question that cannot be answered with information given
6. WRONG_TERM_TOPIC — question on a topic NOT in this list: ${atpTopics.slice(0,8).join('; ')}
 
Return: {"flaws":[{"question":"4.3","type":"ORDERING_EQUAL_VALUES","detail":"0.6 and 3/5 are both 0.60","fix":"Replace 3/5 with 2/5"}],"clean":false}
If no flaws: {"flaws":[],"clean":true}`;
 
    const qQualityUsr = `Review this Grade ${g} ${subject} Term ${t} question paper for design flaws:\n\n${questionPaper}`;
 
    try {
      const rawQuality = await callClaude(qQualitySys, qQualityUsr, 1200);
      let qualityResult;
      try { qualityResult = typeof rawQuality === 'object' ? rawQuality : JSON.parse(rawQuality); }
      catch(e) { qualityResult = { flaws: [], clean: true }; }
 
      if (qualityResult.flaws && qualityResult.flaws.length > 0) {
        console.log(`Phase 2b: ${qualityResult.flaws.length} flaw(s) detected`);
        qualityResult.flaws.forEach(f => console.log(`  Q${f.question} [${f.type}]: ${f.detail}`));
        const fixSys = `You are correcting specific design flaws in a ${subject} question paper.
OUTPUT RULES:
- Output the complete corrected question paper ONLY
- Start IMMEDIATELY with the first line of the paper (e.g. "SECTION A" or "Question 1")
- Do NOT write any explanation, reasoning, preamble, or notes before or after
- Do NOT wrap in JSON — output raw paper text directly
- Rewrite ONLY the flagged questions — leave everything else character-for-character identical
- Preserve every (X) mark value exactly`;
        const flawList = qualityResult.flaws.map(f => `Q${f.question}: [${f.type}] ${f.detail} — Fix: ${f.fix}`).join('\n');
        const fixUsr = `Fix ONLY these flaws. Output complete corrected paper with NO preamble.\n\nFLAWS:\n${flawList}\n\nPAPER:\n${questionPaper}`;
        try {
          const rawFixed = await callClaude(fixSys, fixUsr, qTok);
          const fixedPaper = cleanOutput(safeExtractContent(rawFixed));
          const fixedCount = countMarks(fixedPaper);
          if (fixedCount === markTotal) { questionPaper = fixedPaper; console.log(`Phase 2b: fixed ✓`); }
          else console.log(`Phase 2b: fix shifted mark total (${fixedCount}≠${markTotal}) — keeping original`);
        } catch(fixErr) { console.log(`Phase 2b: fix failed (${fixErr.message})`); }
      } else {
        console.log(`Phase 2b: no design flaws ✓`);
      }
    } catch(qErr) { console.log(`Phase 2b: quality check skipped (${qErr.message})`); }
 
    // ── Phase 3A: Generate memo table ──
    const cogLevelRef = plan.questions.map(q => `${q.number} (${q.marks} marks) → ${q.cogLevel}`).join('\n');
    const memoTableRaw = cleanOutput(await callClaude(mSys, mUsrA(questionPaper, markTotal, cogLevelRef), 8192));
    console.log(`Phase 3A: memo table generated (${memoTableRaw.length} chars)`);
 
    // ── Phase 3B: Generate cog analysis + extension + rubric ──
    const memoAnalysisRaw = cleanOutput(await callClaude(mSys, mUsrB(memoTableRaw, markTotal), 8192));
    console.log(`Phase 3B: cog analysis generated (${memoAnalysisRaw.length} chars)`);
 
    const memoContent = memoTableRaw + '\n\n' + memoAnalysisRaw;
 
    // ── Phase 4: Memo Verification + Auto-Correction ──
    const verSys = `You are a senior South African CAPS examiner performing a final accuracy check on a memorandum.
Check EVERY row of the memorandum table:
1. ARITHMETIC — recalculate the answer from scratch. Flag any mismatch.
2. PROFIT_LOSS — income > cost = PROFIT; cost > income = LOSS. Flag wrong label or amount.
3. COUNT — for stem-and-leaf or data set "how many" questions: count every leaf. Flag mismatches.
4. ROUNDING — check rounded value matches marking guidance. Flag if answer uses different value.
5. COG_LEVEL_TOTAL — add up MARK values per cognitive level. Compare to the analysis table. Flag mismatches.
 
Return ONLY valid JSON:
{"errors":[{"question":"7.1a","check":"COUNT","found":"15","correct":"13","fix":"Change answer from 15 to 13 visitors"}],"cogLevelErrors":[{"level":"Knowledge","foundInTable":"16","foundInAnalysis":"15","fix":"Actual Marks for Knowledge should be 16"}],"clean":true}
If no errors: {"errors":[],"cogLevelErrors":[],"clean":true}`;
 
    const verUsr = `QUESTION PAPER:\n${questionPaper}\n\nMEMORANDUM TO VERIFY:\n${memoContent}\n\nCheck every memo row. Report ALL errors.`;
 
    let verifiedMemo = memoContent;
    try {
      const rawVer = await callClaude(verSys, verUsr, 3000);
      let verResult;
      try { verResult = typeof rawVer === 'object' ? rawVer : JSON.parse(rawVer); }
      catch(e) { verResult = { errors: [], cogLevelErrors: [], clean: true }; }
 
      const totalErrors = (verResult.errors || []).length + (verResult.cogLevelErrors || []).length;
      if (totalErrors > 0) {
        console.log(`Phase 4: ${totalErrors} error(s) detected`);
        (verResult.errors || []).forEach(e => console.log(`  Q${e.question} [${e.check}]: found="${e.found}" correct="${e.correct}"`));
        (verResult.cogLevelErrors || []).forEach(e => console.log(`  CogLevel [${e.level}]: table=${e.foundInTable} analysis=${e.foundInAnalysis}`));
 
        const corrMemoSys = `You are correcting specific verified errors in a memorandum.
Fix ONLY the rows and cells listed in the error report. Do not change anything else.
Return the complete corrected memorandum as JSON: {"content":"complete corrected memorandum"}`;
        const allErrors = [
          ...(verResult.errors || []).map(e => `Q${e.question} [${e.check}]: Answer should be "${e.correct}". ${e.fix}`),
          ...(verResult.cogLevelErrors || []).map(e => `Cognitive Level table — ${e.level}: ${e.fix}`)
        ].join('\n');
        const corrMemoUsr = `Correct ONLY these verified errors. Do not change anything else.\n\nERRORS:\n${allErrors}\n\nMEMORANDUM:\n${memoContent}`;
 
        try {
          const rawCorrected = await callClaude(corrMemoSys, corrMemoUsr, 8192);
          const correctedMemo = cleanOutput(safeExtractContent(rawCorrected));
          if (correctedMemo && correctedMemo.length > 500) { verifiedMemo = correctedMemo; console.log(`Phase 4: memo corrected ✓`); }
          else { console.log(`Phase 4: correction too short — keeping original`); verifiedMemo = memoContent; }
        } catch(corrErr) { console.log(`Phase 4: correction failed (${corrErr.message})`); verifiedMemo = memoContent; }
      } else {
        console.log(`Phase 4: memo verified — no errors ✓`);
      }
    } catch(verErr) { console.log(`Phase 4: verification skipped (${verErr.message})`); }
 
    // ── Build DOCX ──
    let docxBase64 = null;
    const filename = (subject + '-' + resourceType + '-Grade' + g + '-Term' + t).replace(/[^a-zA-Z0-9\-]/g, '-') + '.docx';
    try {
      const doc = buildDoc(questionPaper, verifiedMemo, markTotal);
      const buffer = await Packer.toBuffer(doc);
      docxBase64 = buffer.toString('base64');
    } catch (docxErr) {
      console.error('DOCX build error:', docxErr.message);
    }
 
    const preview = questionPaper + '\n\n' + verifiedMemo;
    return res.status(200).json({ docxBase64, preview, filename });
 
  } catch (err) {
    console.error('Generate error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
