// Hand-coded organism silhouettes for use in diagrams.
//
// Each silhouette is a tiny SVG fragment (no <svg> wrapper) sized to a
// canonical 100×60 viewBox, painted as a solid currentColor fill. The
// renderer that uses them ( food_chain.js, eventually life_cycle.js )
// places each silhouette inside its own <svg viewBox="0 0 100 60"> at
// whatever size and colour the diagram needs.
//
// Naming: kebab-case, singular. lookupSilhouette() handles common
// variations (plurals, capitalisation, "African " prefixes, etc.) so
// Claude can write "Frogs" or "African Frog" and still hit "frog".
//
// Coverage roadmap: 100+ organisms across multiple batches. Each batch
// adds entries to SILHOUETTES — no other code changes needed.

const SILHOUETTES = {
  // ── PLANTS / PRODUCERS ─────────────────────────────────────────
  grass: `
    <path d="M14,55 Q12,38 8,28 Q14,38 16,55 Z M22,55 Q22,32 16,18 Q24,32 26,55 Z M34,55 Q32,42 26,30 Q34,42 36,55 Z M44,55 Q44,30 38,16 Q46,30 48,55 Z M56,55 Q54,40 48,28 Q56,40 60,55 Z M68,55 Q68,30 62,16 Q70,30 72,55 Z M80,55 Q78,42 72,30 Q80,42 84,55 Z M90,55 Q90,32 84,18 Q92,32 94,55 Z"/>
    <path d="M0,57 Q50,55 100,57 L100,60 L0,60 Z"/>
  `,

  tree: `
    <ellipse cx="50" cy="22" rx="22" ry="18"/>
    <ellipse cx="36" cy="18" rx="14" ry="11"/>
    <ellipse cx="64" cy="18" rx="14" ry="11"/>
    <rect x="46" y="36" width="8" height="20"/>
    <path d="M0,57 Q50,55 100,57 L100,60 L0,60 Z" opacity="0.4"/>
  `,

  protea: `
    <ellipse cx="50" cy="20" rx="18" ry="14"/>
    <path d="M50,8 Q40,2 32,12 Q40,16 50,12 Z M50,8 Q60,2 68,12 Q60,16 50,12 Z M30,18 Q22,16 22,28 Q30,26 36,22 Z M70,18 Q78,16 78,28 Q70,26 64,22 Z M30,28 Q22,32 28,42 Q34,36 36,30 Z M70,28 Q78,32 72,42 Q66,36 64,30 Z"/>
    <ellipse cx="50" cy="22" rx="6" ry="4" fill="#fbf8f1"/>
    <rect x="48" y="30" width="4" height="26"/>
    <path d="M40,42 Q44,38 48,42 L48,46 Q44,44 40,46 Z M52,42 Q56,38 60,42 L60,46 Q56,44 52,46 Z"/>
  `,

  // ── INVERTEBRATES / INSECTS ────────────────────────────────────
  beetle: `
    <ellipse cx="50" cy="35" rx="22" ry="14"/>
    <ellipse cx="50" cy="22" rx="10" ry="8"/>
    <line x1="46" y1="14" x2="40" y2="6" stroke="currentColor" stroke-width="1.4" fill="none"/>
    <line x1="54" y1="14" x2="60" y2="6" stroke="currentColor" stroke-width="1.4" fill="none"/>
    <line x1="50" y1="22" x2="50" y2="48" stroke="#fbf8f1" stroke-width="1.2"/>
    <line x1="28" y1="32" x2="22" y2="26" stroke="currentColor" stroke-width="1.2"/>
    <line x1="72" y1="32" x2="78" y2="26" stroke="currentColor" stroke-width="1.2"/>
    <line x1="28" y1="38" x2="20" y2="40" stroke="currentColor" stroke-width="1.2"/>
    <line x1="72" y1="38" x2="80" y2="40" stroke="currentColor" stroke-width="1.2"/>
    <line x1="32" y1="46" x2="26" y2="52" stroke="currentColor" stroke-width="1.2"/>
    <line x1="68" y1="46" x2="74" y2="52" stroke="currentColor" stroke-width="1.2"/>
  `,

  butterfly: `
    <path d="M50,32 Q24,8 18,18 Q12,30 22,40 Q34,46 50,36 Z"/>
    <path d="M50,32 Q76,8 82,18 Q88,30 78,40 Q66,46 50,36 Z"/>
    <path d="M50,36 Q26,40 18,52 Q24,52 36,48 Q46,46 50,42 Z"/>
    <path d="M50,36 Q74,40 82,52 Q76,52 64,48 Q54,46 50,42 Z"/>
    <ellipse cx="50" cy="34" rx="2.5" ry="14"/>
    <line x1="50" y1="20" x2="46" y2="12" stroke="currentColor" stroke-width="1.4" fill="none"/>
    <line x1="50" y1="20" x2="54" y2="12" stroke="currentColor" stroke-width="1.4" fill="none"/>
    <circle cx="34" cy="22" r="3" fill="#fbf8f1"/>
    <circle cx="66" cy="22" r="3" fill="#fbf8f1"/>
  `,

  worm: `
    <path d="M8,40 Q22,28 36,38 Q50,48 64,38 Q78,28 92,40 Q92,46 86,46 Q78,40 70,46 Q60,52 50,46 Q40,40 30,46 Q20,52 14,46 Q8,46 8,40 Z"/>
  `,

  grasshopper: `
    <ellipse cx="48" cy="32" rx="28" ry="7"/>
    <circle cx="74" cy="28" r="6"/>
    <circle cx="76" cy="26" r="1.4" fill="#fbf8f1"/>
    <path d="M78,22 Q88,12 92,8"  stroke="currentColor" stroke-width="1.4" fill="none"/>
    <path d="M80,22 Q92,16 96,12" stroke="currentColor" stroke-width="1.4" fill="none"/>
    <path d="M40,26 Q56,18 68,26 Q56,28 40,26 Z" opacity="0.85"/>
    <path d="M30,32 L14,16 L20,12 L36,30 Z"/>
    <path d="M14,16 L4,26 L10,28 L20,22 Z"/>
    <line x1="44" y1="38" x2="42" y2="52" stroke="currentColor" stroke-width="1.6"/>
    <line x1="42" y1="52" x2="46" y2="54" stroke="currentColor" stroke-width="1.6"/>
    <line x1="60" y1="36" x2="62" y2="50" stroke="currentColor" stroke-width="1.6"/>
    <line x1="62" y1="50" x2="66" y2="52" stroke="currentColor" stroke-width="1.6"/>
  `,

  // ── AQUATIC ────────────────────────────────────────────────────
  fish: `
    <path d="M14,30 Q24,14 50,16 Q72,18 80,30 Q72,42 50,44 Q24,46 14,30 Z"/>
    <path d="M80,30 Q92,18 96,22 Q92,30 96,38 Q92,42 80,30 Z"/>
    <circle cx="32" cy="26" r="2.4" fill="#fbf8f1"/>
    <path d="M50,18 Q56,14 60,18 L58,22 Q54,20 52,22 Z"/>
    <path d="M50,42 Q56,46 60,42 L58,38 Q54,40 52,38 Z"/>
    <path d="M40,30 Q60,28 70,30 Q60,32 40,30 Z" fill="#fbf8f1" opacity="0.6"/>
  `,

  frog: `
    <ellipse cx="50" cy="42" rx="26" ry="14"/>
    <ellipse cx="50" cy="28" rx="18" ry="12"/>
    <circle cx="38" cy="20" r="6"/>
    <circle cx="62" cy="20" r="6"/>
    <circle cx="38" cy="20" r="2.6" fill="#fbf8f1"/>
    <circle cx="62" cy="20" r="2.6" fill="#fbf8f1"/>
    <circle cx="38" cy="20" r="1.4"/>
    <circle cx="62" cy="20" r="1.4"/>
    <path d="M22,46 Q12,52 14,58 Q22,56 26,52 Z"/>
    <path d="M78,46 Q88,52 86,58 Q78,56 74,52 Z"/>
    <path d="M40,30 Q50,34 60,30" stroke="#fbf8f1" stroke-width="1.4" fill="none"/>
  `,

  // ── REPTILES ───────────────────────────────────────────────────
  snake: `
    <path d="M88,38 Q82,30 74,30 Q66,30 60,38 Q54,46 46,46 Q38,46 32,38 Q26,30 18,30 Q10,30 8,40 Q14,42 18,38 Q24,32 30,40 Q36,48 44,50 Q52,52 60,46 Q68,38 74,38 Q80,38 84,42 Q88,44 92,40 Z"/>
    <circle cx="86" cy="36" r="1.6" fill="#fbf8f1"/>
    <path d="M90,38 Q94,38 96,40 Q94,40 92,40 Z"/>
  `,

  lizard: `
    <ellipse cx="46" cy="36" rx="22" ry="8"/>
    <ellipse cx="20" cy="34" rx="10" ry="6"/>
    <path d="M68,34 Q82,30 92,38 Q86,40 80,38 Q76,38 68,38 Z"/>
    <circle cx="14" cy="32" r="1.4" fill="#fbf8f1"/>
    <path d="M28,42 L24,50 L30,46 Z"/>
    <path d="M40,42 L36,52 L42,48 Z"/>
    <path d="M52,42 L48,52 L54,48 Z"/>
    <path d="M62,42 L58,50 L64,46 Z"/>
    <path d="M30,30 L26,22 L32,28 Z"/>
    <path d="M50,28 L46,20 L52,26 Z"/>
  `,

  // ── BIRDS ──────────────────────────────────────────────────────
  bird: `
    <path d="M28,32 Q40,18 58,22 Q72,26 78,36 Q74,42 64,42 Q52,44 40,42 Q32,42 28,38 Z"/>
    <circle cx="68" cy="28" r="6"/>
    <path d="M72,28 L82,26 L78,30 Z"/>
    <circle cx="70" cy="26" r="1.2" fill="#fbf8f1"/>
    <path d="M40,40 Q44,52 50,54 L52,42 Z"/>
    <path d="M50,40 Q54,52 60,54 L62,42 Z"/>
    <path d="M28,32 Q22,26 14,28 Q24,32 32,34 Z"/>
  `,

  eagle: `
    <path d="M50,32 Q42,20 50,16 Q58,20 50,32 Z"/>
    <path d="M50,28 Q24,18 8,30 Q14,38 30,38 Q44,38 50,34 Z"/>
    <path d="M50,28 Q76,18 92,30 Q86,38 70,38 Q56,38 50,34 Z"/>
    <ellipse cx="50" cy="38" rx="10" ry="14"/>
    <path d="M44,50 L42,58 M50,52 L50,60 M56,50 L58,58" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="50" cy="22" r="3.2"/>
    <path d="M52,22 L58,21 L54,24 Z"/>
    <circle cx="50" cy="22" r="1" fill="#fbf8f1"/>
  `,

  // ── MAMMALS ────────────────────────────────────────────────────
  mouse: `
    <ellipse cx="48" cy="38" rx="22" ry="12"/>
    <circle cx="28" cy="34" r="9"/>
    <ellipse cx="22" cy="26" rx="5" ry="5"/>
    <ellipse cx="34" cy="26" rx="5" ry="5"/>
    <circle cx="20" cy="34" r="1.6" fill="#fbf8f1"/>
    <circle cx="18" cy="38" r="1"/>
    <path d="M68,40 Q82,42 92,52 Q86,52 80,48 Q74,44 68,44 Z"/>
    <line x1="14" y1="36" x2="6" y2="34" stroke="currentColor" stroke-width="0.8"/>
    <line x1="14" y1="38" x2="6" y2="40" stroke="currentColor" stroke-width="0.8"/>
  `,

  lion: `
    <circle cx="36" cy="32" r="14"/>
    <circle cx="36" cy="32" r="18" opacity="0.55"/>
    <ellipse cx="62" cy="38" rx="22" ry="12"/>
    <path d="M82,38 Q92,40 96,48 Q90,48 86,46 Q82,44 80,44 Z"/>
    <circle cx="32" cy="30" r="1.6" fill="#fbf8f1"/>
    <circle cx="40" cy="30" r="1.6" fill="#fbf8f1"/>
    <ellipse cx="36" cy="36" rx="2.4" ry="1.6"/>
    <path d="M40,46 L42,52 M50,48 L52,54 M60,48 L62,54 M70,46 L72,52" stroke="currentColor" stroke-width="1.4"/>
    <ellipse cx="26" cy="22" rx="3" ry="4"/>
    <ellipse cx="46" cy="22" rx="3" ry="4"/>
  `,

  // ── BATCH 2 · SA SAVANNA MAMMALS ───────────────────────────────
  springbok: `
    <ellipse cx="46" cy="32" rx="20" ry="6"/>
    <line x1="34" y1="36" x2="32" y2="50" stroke="currentColor" stroke-width="2.2"/>
    <line x1="42" y1="36" x2="42" y2="50" stroke="currentColor" stroke-width="2.2"/>
    <line x1="54" y1="36" x2="54" y2="50" stroke="currentColor" stroke-width="2.2"/>
    <line x1="62" y1="36" x2="64" y2="50" stroke="currentColor" stroke-width="2.2"/>
    <ellipse cx="74" cy="22" rx="7" ry="5" transform="rotate(-25 74 22)"/>
    <path d="M66,30 L72,24" stroke="currentColor" stroke-width="3" fill="none"/>
    <path d="M77,17 Q82,8 79,2"  stroke="currentColor" stroke-width="1.4" fill="none"/>
    <path d="M73,17 Q76,8 71,4"  stroke="currentColor" stroke-width="1.4" fill="none"/>
    <path d="M28,30 L20,32 L26,28 Z"/>
  `,

  kudu: `
    <ellipse cx="44" cy="34" rx="22" ry="8"/>
    <line x1="30" y1="40" x2="28" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="40" y1="40" x2="40" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="52" y1="40" x2="52" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="60" y1="40" x2="62" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <path d="M62,32 L70,18 L76,22 L70,34 Z"/>
    <ellipse cx="74" cy="22" rx="6" ry="4"/>
    <path d="M76,16 Q82,8 78,2 Q86,6 82,14"  stroke="currentColor" stroke-width="1.6" fill="none"/>
    <path d="M72,16 Q66,8 70,2 Q62,6 68,14"  stroke="currentColor" stroke-width="1.6" fill="none"/>
    <line x1="36" y1="28" x2="52" y2="28" stroke="#fbf8f1" stroke-width="1.2"/>
    <line x1="40" y1="32" x2="56" y2="32" stroke="#fbf8f1" stroke-width="1"/>
    <path d="M22,34 L14,36 L20,32 Z"/>
  `,

  zebra: `
    <ellipse cx="46" cy="32" rx="22" ry="8"/>
    <line x1="32" y1="38" x2="32" y2="52" stroke="currentColor" stroke-width="2.4"/>
    <line x1="40" y1="38" x2="40" y2="52" stroke="currentColor" stroke-width="2.4"/>
    <line x1="54" y1="38" x2="54" y2="52" stroke="currentColor" stroke-width="2.4"/>
    <line x1="62" y1="38" x2="62" y2="52" stroke="currentColor" stroke-width="2.4"/>
    <path d="M62,28 L70,18 L76,22 L70,32 Z"/>
    <ellipse cx="74" cy="22" rx="6" ry="4"/>
    <path d="M70,12 L72,6 L74,12 L76,6 L78,12 Z"/>
    <line x1="22" y1="32" x2="14" y2="34" stroke="currentColor" stroke-width="2"/>
    <line x1="34" y1="26" x2="34" y2="38" stroke="#fbf8f1" stroke-width="2"/>
    <line x1="42" y1="26" x2="42" y2="38" stroke="#fbf8f1" stroke-width="2"/>
    <line x1="50" y1="26" x2="50" y2="38" stroke="#fbf8f1" stroke-width="2"/>
    <line x1="58" y1="26" x2="58" y2="38" stroke="#fbf8f1" stroke-width="2"/>
  `,

  jackal: `
    <ellipse cx="46" cy="36" rx="20" ry="7"/>
    <line x1="34" y1="42" x2="32" y2="52" stroke="currentColor" stroke-width="2.2"/>
    <line x1="40" y1="42" x2="40" y2="52" stroke="currentColor" stroke-width="2.2"/>
    <line x1="52" y1="42" x2="52" y2="52" stroke="currentColor" stroke-width="2.2"/>
    <line x1="58" y1="42" x2="60" y2="52" stroke="currentColor" stroke-width="2.2"/>
    <path d="M62,32 Q72,24 78,28 Q76,38 66,38 Z"/>
    <path d="M68,28 L72,20 L76,28 Z"/>
    <path d="M74,28 L78,20 L82,28 Z"/>
    <circle cx="74" cy="32" r="1.2" fill="#fbf8f1"/>
    <path d="M82,30 Q86,30 88,32 Q84,32 82,32 Z"/>
    <path d="M26,36 Q14,32 12,40 Q18,38 24,40 Z"/>
  `,

  leopard: `
    <ellipse cx="46" cy="38" rx="24" ry="8"/>
    <circle cx="68" cy="32" r="8"/>
    <ellipse cx="63" cy="28" rx="2" ry="2.5"/>
    <ellipse cx="73" cy="28" rx="2" ry="2.5"/>
    <line x1="32" y1="44" x2="32" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="40" y1="44" x2="40" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="52" y1="44" x2="52" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="60" y1="44" x2="60" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <path d="M22,38 Q10,32 6,40 Q14,40 22,42 Z"/>
    <circle cx="36" cy="34" r="1.2" fill="#fbf8f1"/>
    <circle cx="44" cy="38" r="1.2" fill="#fbf8f1"/>
    <circle cx="52" cy="34" r="1.2" fill="#fbf8f1"/>
    <circle cx="60" cy="40" r="1.2" fill="#fbf8f1"/>
    <circle cx="48" cy="42" r="1.2" fill="#fbf8f1"/>
  `,

  cheetah: `
    <ellipse cx="46" cy="36" rx="26" ry="6"/>
    <circle cx="70" cy="30" r="7"/>
    <line x1="34" y1="40" x2="34" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="42" y1="40" x2="42" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="54" y1="40" x2="54" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="60" y1="40" x2="60" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <path d="M22,36 Q6,30 4,40 Q14,38 22,40 Z"/>
    <line x1="68" y1="30" x2="70" y2="36" stroke="#fbf8f1" stroke-width="1.4"/>
    <line x1="72" y1="30" x2="72" y2="36" stroke="#fbf8f1" stroke-width="1.4"/>
    <circle cx="38" cy="34" r="0.9" fill="#fbf8f1"/>
    <circle cx="46" cy="36" r="0.9" fill="#fbf8f1"/>
    <circle cx="54" cy="34" r="0.9" fill="#fbf8f1"/>
  `,

  hyena: `
    <path d="M28,38 Q24,28 30,24 Q44,22 56,30 Q70,32 76,38 Q70,46 56,46 Q40,46 28,38 Z"/>
    <circle cx="74" cy="32" r="6"/>
    <line x1="34" y1="44" x2="32" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="42" y1="44" x2="40" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="58" y1="44" x2="58" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="68" y1="42" x2="70" y2="52" stroke="currentColor" stroke-width="2.4"/>
    <path d="M70,28 L72,22 L76,28 Z"/>
    <path d="M76,28 L78,22 L82,28 Z"/>
    <circle cx="76" cy="32" r="1.2" fill="#fbf8f1"/>
    <path d="M22,34 Q14,30 12,36 Q18,36 22,38 Z"/>
    <path d="M30,24 L34,18 M36,22 L40,16 M42,22 L46,16" stroke="currentColor" stroke-width="1.4"/>
  `,

  giraffe: `
    <ellipse cx="40" cy="36" rx="14" ry="8"/>
    <path d="M44,30 L52,8 L58,8 L52,32 Z"/>
    <ellipse cx="56" cy="6" rx="6" ry="4"/>
    <line x1="56" y1="2" x2="55" y2="-2" stroke="currentColor" stroke-width="1.4"/>
    <line x1="58" y1="2" x2="59" y2="-2" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="58" cy="4" r="1" fill="#fbf8f1"/>
    <line x1="32" y1="42" x2="32" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="40" y1="42" x2="40" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="46" y1="42" x2="48" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <path d="M28,32 Q22,32 22,38" stroke="currentColor" stroke-width="2" fill="none"/>
    <circle cx="34" cy="34" r="1.6" fill="#fbf8f1"/>
    <circle cx="44" cy="36" r="1.6" fill="#fbf8f1"/>
    <circle cx="50" cy="20" r="1.4" fill="#fbf8f1"/>
    <circle cx="55" cy="14" r="1.4" fill="#fbf8f1"/>
  `,

  elephant: `
    <ellipse cx="44" cy="34" rx="26" ry="14"/>
    <path d="M68,30 Q82,28 86,38 Q88,46 82,50 Q78,42 76,40 Q74,38 70,40 Z"/>
    <path d="M22,32 Q12,28 8,32 Q14,38 22,38 Z"/>
    <line x1="28" y1="48" x2="28" y2="56" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>
    <line x1="40" y1="48" x2="40" y2="56" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>
    <line x1="52" y1="48" x2="52" y2="56" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>
    <line x1="62" y1="48" x2="62" y2="56" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>
    <circle cx="70" cy="32" r="1.4" fill="#fbf8f1"/>
    <path d="M70,40 L66,46 L70,44 Z" fill="#fbf8f1"/>
    <path d="M76,42 L80,52 L78,42 Z"/>
  `,

  rhino: `
    <ellipse cx="44" cy="36" rx="26" ry="10"/>
    <ellipse cx="68" cy="32" r="9"/>
    <path d="M76,28 L82,16 L78,28 Z"/>
    <path d="M72,28 L74,22 L74,28 Z"/>
    <path d="M62,24 L66,18 L66,24 Z"/>
    <line x1="30" y1="44" x2="30" y2="54" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <line x1="40" y1="44" x2="40" y2="54" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <line x1="52" y1="44" x2="52" y2="54" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <line x1="58" y1="44" x2="58" y2="54" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <path d="M22,32 Q14,30 14,38 Q20,38 22,36 Z"/>
    <circle cx="68" cy="32" r="1.2" fill="#fbf8f1"/>
  `,

  buffalo: `
    <ellipse cx="44" cy="36" rx="24" ry="9"/>
    <ellipse cx="68" cy="30" rx="9" ry="7"/>
    <path d="M64,22 Q56,16 50,22 Q56,22 60,26 Z"/>
    <path d="M72,22 Q80,16 86,22 Q80,22 76,26 Z"/>
    <line x1="30" y1="44" x2="30" y2="54" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
    <line x1="40" y1="44" x2="40" y2="54" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
    <line x1="52" y1="44" x2="52" y2="54" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
    <line x1="60" y1="44" x2="60" y2="54" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M20,38 Q12,40 14,46 Q20,42 22,42 Z"/>
    <circle cx="70" cy="30" r="1.4" fill="#fbf8f1"/>
    <line x1="64" y1="32" x2="60" y2="32" stroke="#fbf8f1" stroke-width="1"/>
  `,

  wildebeest: `
    <ellipse cx="44" cy="36" rx="22" ry="8"/>
    <ellipse cx="66" cy="30" rx="8" ry="6"/>
    <path d="M62,24 Q56,16 52,22 Q58,22 60,26 Z"/>
    <path d="M70,24 Q76,16 80,22 Q74,22 72,26 Z"/>
    <path d="M58,32 Q52,42 56,48 Q58,42 60,38 Z"/>
    <line x1="32" y1="42" x2="32" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="40" y1="42" x2="40" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="50" y1="42" x2="50" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="58" y1="42" x2="58" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <path d="M22,36 Q14,38 14,44 Q22,40 24,40 Z"/>
    <circle cx="68" cy="30" r="1.2" fill="#fbf8f1"/>
  `,

  impala: `
    <ellipse cx="46" cy="32" rx="20" ry="6"/>
    <line x1="34" y1="36" x2="32" y2="50" stroke="currentColor" stroke-width="2"/>
    <line x1="42" y1="36" x2="42" y2="50" stroke="currentColor" stroke-width="2"/>
    <line x1="54" y1="36" x2="54" y2="50" stroke="currentColor" stroke-width="2"/>
    <line x1="62" y1="36" x2="64" y2="50" stroke="currentColor" stroke-width="2"/>
    <ellipse cx="74" cy="22" rx="7" ry="5" transform="rotate(-25 74 22)"/>
    <path d="M66,30 L72,24" stroke="currentColor" stroke-width="3" fill="none"/>
    <path d="M76,16 Q82,4 80,-2 Q78,4 76,12" stroke="currentColor" stroke-width="1.4" fill="none"/>
    <path d="M73,16 Q66,4 68,-2 Q70,4 72,12" stroke="currentColor" stroke-width="1.4" fill="none"/>
    <path d="M28,30 L20,32 L26,28 Z"/>
    <line x1="48" y1="34" x2="62" y2="34" stroke="#fbf8f1" stroke-width="0.8"/>
  `,

  // ── BATCH 3 · SA FYNBOS + COASTAL ──────────────────────────────
  sunbird: `
    <ellipse cx="42" cy="32" rx="14" ry="7"/>
    <circle cx="56" cy="28" r="6"/>
    <path d="M62,28 Q72,30 78,34 Q72,32 62,30 Z"/>
    <path d="M30,32 Q22,38 16,44 Q24,38 30,36 Z"/>
    <path d="M40,28 Q48,22 50,28 Q44,30 40,30 Z"/>
    <circle cx="58" cy="26" r="1.2" fill="#fbf8f1"/>
    <line x1="42" y1="38" x2="40" y2="46" stroke="currentColor" stroke-width="1.4"/>
    <line x1="46" y1="38" x2="46" y2="46" stroke="currentColor" stroke-width="1.4"/>
  `,

  sugarbird: `
    <ellipse cx="36" cy="32" rx="14" ry="7"/>
    <circle cx="50" cy="28" r="6"/>
    <path d="M56,28 Q66,30 70,32 Q64,30 56,30 Z"/>
    <path d="M24,32 Q14,28 4,32 Q14,34 22,36 Z"/>
    <path d="M22,32 Q12,32 2,38 Q14,38 22,38 Z"/>
    <path d="M22,32 Q12,36 2,46 Q14,42 22,40 Z"/>
    <path d="M34,28 Q40,22 46,28 Q40,30 34,30 Z"/>
    <circle cx="52" cy="26" r="1.2" fill="#fbf8f1"/>
    <line x1="36" y1="38" x2="34" y2="46" stroke="currentColor" stroke-width="1.4"/>
    <line x1="40" y1="38" x2="40" y2="46" stroke="currentColor" stroke-width="1.4"/>
  `,

  mongoose: `
    <ellipse cx="42" cy="38" rx="22" ry="6"/>
    <ellipse cx="64" cy="34" rx="9" ry="6"/>
    <path d="M70,30 L78,28 L74,34 Z"/>
    <path d="M68,28 L72,22 L72,28 Z"/>
    <circle cx="68" cy="32" r="1.2" fill="#fbf8f1"/>
    <line x1="34" y1="42" x2="34" y2="52" stroke="currentColor" stroke-width="2"/>
    <line x1="42" y1="42" x2="42" y2="52" stroke="currentColor" stroke-width="2"/>
    <line x1="50" y1="42" x2="50" y2="52" stroke="currentColor" stroke-width="2"/>
    <line x1="56" y1="42" x2="56" y2="52" stroke="currentColor" stroke-width="2"/>
    <path d="M22,38 Q10,38 4,46 Q14,42 22,42 Z"/>
  `,

  caracal: `
    <ellipse cx="44" cy="38" rx="22" ry="8"/>
    <circle cx="64" cy="32" r="8"/>
    <path d="M58,24 L56,12 L62,22 Z"/>
    <path d="M70,24 L72,12 L66,22 Z"/>
    <line x1="56" y1="13" x2="54" y2="6" stroke="currentColor" stroke-width="1.6"/>
    <line x1="72" y1="13" x2="74" y2="6" stroke="currentColor" stroke-width="1.6"/>
    <ellipse cx="60" cy="30" rx="1.6" ry="2" fill="#fbf8f1"/>
    <ellipse cx="68" cy="30" rx="1.6" ry="2" fill="#fbf8f1"/>
    <ellipse cx="64" cy="36" rx="1.6" ry="1"/>
    <line x1="32" y1="44" x2="32" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="40" y1="44" x2="40" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="50" y1="44" x2="50" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="56" y1="44" x2="56" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <path d="M22,38 Q10,32 8,42 Q16,40 22,42 Z"/>
  `,

  penguin: `
    <ellipse cx="50" cy="34" rx="14" ry="20"/>
    <ellipse cx="50" cy="36" rx="9" ry="14" fill="#fbf8f1"/>
    <ellipse cx="50" cy="18" rx="9" ry="8"/>
    <path d="M58,18 L66,18 L60,22 Z"/>
    <circle cx="48" cy="16" r="1.4" fill="#fbf8f1"/>
    <circle cx="48" cy="16" r="0.8"/>
    <path d="M36,32 Q26,38 30,46 Q38,42 38,38 Z"/>
    <path d="M64,32 Q74,38 70,46 Q62,42 62,38 Z"/>
    <path d="M44,52 L40,58 L48,56 Z"/>
    <path d="M56,52 L60,58 L52,56 Z"/>
  `,

  sardine: `
    <path d="M14,30 Q22,18 50,18 Q72,20 80,30 Q72,40 50,42 Q22,42 14,30 Z"/>
    <path d="M80,30 Q90,22 94,26 Q90,30 94,34 Q90,38 80,30 Z"/>
    <circle cx="28" cy="26" r="2" fill="#fbf8f1"/>
    <line x1="40" y1="22" x2="40" y2="38" stroke="#fbf8f1" stroke-width="1"/>
    <line x1="50" y1="22" x2="50" y2="38" stroke="#fbf8f1" stroke-width="1"/>
    <line x1="60" y1="22" x2="60" y2="38" stroke="#fbf8f1" stroke-width="1"/>
    <line x1="70" y1="24" x2="70" y2="36" stroke="#fbf8f1" stroke-width="1"/>
    <path d="M50,18 L52,12 L56,18 Z"/>
    <path d="M50,42 L52,48 L56,42 Z"/>
  `,

  seal: `
    <path d="M14,38 Q24,22 56,22 Q74,24 84,32 Q86,40 78,42 Q74,38 70,40 Q60,44 50,42 Q30,42 14,38 Z"/>
    <circle cx="28" cy="30" r="1.6" fill="#fbf8f1"/>
    <line x1="22" y1="32" x2="14" y2="34" stroke="currentColor" stroke-width="0.8"/>
    <line x1="22" y1="34" x2="14" y2="36" stroke="currentColor" stroke-width="0.8"/>
    <path d="M40,40 Q42,52 50,52 L52,42 Z"/>
    <path d="M68,40 Q72,52 80,52 L82,42 Z"/>
    <path d="M76,32 L88,28 L92,38 L84,40 Z"/>
    <path d="M84,38 L94,42 L88,46 Z"/>
  `,

  dassie: `
    <path d="M16,38 Q14,26 26,22 Q44,18 60,22 Q74,26 78,38 Q70,46 50,46 Q26,46 16,38 Z"/>
    <ellipse cx="64" cy="28" rx="8" ry="6"/>
    <path d="M58,22 L60,16 L64,22 Z"/>
    <path d="M68,22 L70,16 L72,22 Z"/>
    <circle cx="68" cy="28" r="1.4" fill="#fbf8f1"/>
    <ellipse cx="64" cy="32" rx="1.4" ry="0.8"/>
    <line x1="26" y1="46" x2="26" y2="52" stroke="currentColor" stroke-width="2.4"/>
    <line x1="40" y1="46" x2="40" y2="52" stroke="currentColor" stroke-width="2.4"/>
    <line x1="54" y1="46" x2="54" y2="52" stroke="currentColor" stroke-width="2.4"/>
    <line x1="68" y1="46" x2="68" y2="52" stroke="currentColor" stroke-width="2.4"/>
  `,

  // hyrax shares the dassie shape
  hyrax: `
    <path d="M16,38 Q14,26 26,22 Q44,18 60,22 Q74,26 78,38 Q70,46 50,46 Q26,46 16,38 Z"/>
    <ellipse cx="64" cy="28" rx="8" ry="6"/>
    <path d="M58,22 L60,16 L64,22 Z"/>
    <path d="M68,22 L70,16 L72,22 Z"/>
    <circle cx="68" cy="28" r="1.4" fill="#fbf8f1"/>
    <ellipse cx="64" cy="32" rx="1.4" ry="0.8"/>
    <line x1="26" y1="46" x2="26" y2="52" stroke="currentColor" stroke-width="2.4"/>
    <line x1="40" y1="46" x2="40" y2="52" stroke="currentColor" stroke-width="2.4"/>
    <line x1="54" y1="46" x2="54" y2="52" stroke="currentColor" stroke-width="2.4"/>
    <line x1="68" y1="46" x2="68" y2="52" stroke="currentColor" stroke-width="2.4"/>
  `,

  baboon: `
    <ellipse cx="46" cy="36" rx="20" ry="11"/>
    <ellipse cx="34" cy="22" rx="10" ry="9"/>
    <path d="M28,22 Q22,22 22,28 Q26,28 30,26 Z"/>
    <circle cx="32" cy="20" r="1.4" fill="#fbf8f1"/>
    <circle cx="38" cy="20" r="1.4" fill="#fbf8f1"/>
    <ellipse cx="35" cy="26" rx="3" ry="1.6"/>
    <line x1="40" y1="46" x2="38" y2="56" stroke="currentColor" stroke-width="2.4"/>
    <line x1="48" y1="46" x2="48" y2="56" stroke="currentColor" stroke-width="2.4"/>
    <line x1="54" y1="44" x2="56" y2="56" stroke="currentColor" stroke-width="2.4"/>
    <path d="M62,40 Q70,46 80,42 Q72,38 64,38 Z"/>
    <path d="M62,40 Q70,30 76,22" stroke="currentColor" stroke-width="2.4" fill="none"/>
  `,

  hare: `
    <ellipse cx="46" cy="40" rx="22" ry="9"/>
    <ellipse cx="64" cy="32" rx="8" ry="7"/>
    <ellipse cx="62" cy="20" rx="3" ry="10"/>
    <ellipse cx="70" cy="20" rx="3" ry="10"/>
    <circle cx="68" cy="32" r="1.4" fill="#fbf8f1"/>
    <ellipse cx="64" cy="36" rx="1.4" ry="0.8"/>
    <line x1="32" y1="46" x2="30" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="40" y1="46" x2="40" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <path d="M52,46 Q56,52 56,56 Q52,52 50,50 Z"/>
    <path d="M58,46 Q62,52 62,56 Q58,52 56,50 Z"/>
    <path d="M22,40 Q14,38 16,42 Q22,42 24,42 Z"/>
  `,

  crab: `
    <ellipse cx="50" cy="34" rx="22" ry="10"/>
    <path d="M30,28 Q20,18 14,16 Q22,22 28,26 Z"/>
    <ellipse cx="14" cy="14" rx="6" ry="5" transform="rotate(-30 14 14)"/>
    <path d="M70,28 Q80,18 86,16 Q78,22 72,26 Z"/>
    <ellipse cx="86" cy="14" rx="6" ry="5" transform="rotate(30 86 14)"/>
    <line x1="34" y1="42" x2="22" y2="50" stroke="currentColor" stroke-width="1.8"/>
    <line x1="40" y1="44" x2="32" y2="54" stroke="currentColor" stroke-width="1.8"/>
    <line x1="48" y1="44" x2="44" y2="56" stroke="currentColor" stroke-width="1.8"/>
    <line x1="56" y1="44" x2="60" y2="56" stroke="currentColor" stroke-width="1.8"/>
    <line x1="64" y1="44" x2="72" y2="54" stroke="currentColor" stroke-width="1.8"/>
    <line x1="70" y1="42" x2="82" y2="50" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="42" cy="28" r="1.4" fill="#fbf8f1"/>
    <circle cx="58" cy="28" r="1.4" fill="#fbf8f1"/>
  `,

  starfish: `
    <path d="M50,8 L58,30 L82,30 L62,42 L70,62 L50,48 L30,62 L38,42 L18,30 L42,30 Z"/>
    <circle cx="50" cy="34" r="2" fill="#fbf8f1"/>
    <circle cx="40" cy="32" r="1" fill="#fbf8f1"/>
    <circle cx="60" cy="32" r="1" fill="#fbf8f1"/>
    <circle cx="46" cy="40" r="1" fill="#fbf8f1"/>
    <circle cx="54" cy="40" r="1" fill="#fbf8f1"/>
  `,

  // ── BATCH 4 · DOMESTIC / FARM ──────────────────────────────────
  cow: `
    <ellipse cx="44" cy="34" rx="24" ry="10"/>
    <ellipse cx="68" cy="28" rx="9" ry="7"/>
    <path d="M62,22 L60,16 L66,22 Z"/>
    <path d="M72,22 L74,16 L78,22 Z"/>
    <line x1="30" y1="44" x2="30" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="40" y1="44" x2="40" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="52" y1="44" x2="52" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="60" y1="44" x2="60" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <ellipse cx="36" cy="44" rx="5" ry="3"/>
    <line x1="34" y1="46" x2="34" y2="50" stroke="currentColor" stroke-width="1"/>
    <line x1="38" y1="46" x2="38" y2="50" stroke="currentColor" stroke-width="1"/>
    <path d="M22,32 Q14,32 12,40 Q18,42 24,38 Z"/>
    <circle cx="70" cy="28" r="1.4" fill="#fbf8f1"/>
    <ellipse cx="38" cy="28" rx="4" ry="3" fill="#fbf8f1"/>
    <ellipse cx="50" cy="36" rx="3" ry="2" fill="#fbf8f1"/>
  `,

  sheep: `
    <ellipse cx="44" cy="34" rx="24" ry="11"/>
    <circle cx="28" cy="30" r="6" opacity="0.85"/>
    <circle cx="32" cy="22" r="6" opacity="0.85"/>
    <circle cx="44" cy="20" r="7" opacity="0.85"/>
    <circle cx="58" cy="22" r="6" opacity="0.85"/>
    <circle cx="62" cy="30" r="6" opacity="0.85"/>
    <ellipse cx="68" cy="34" rx="6" ry="5"/>
    <line x1="30" y1="44" x2="30" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="40" y1="44" x2="40" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="50" y1="44" x2="50" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="58" y1="44" x2="58" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <circle cx="70" cy="33" r="1.2" fill="#fbf8f1"/>
  `,

  goat: `
    <ellipse cx="44" cy="34" rx="22" ry="8"/>
    <ellipse cx="66" cy="28" rx="8" ry="6"/>
    <path d="M62,22 Q58,12 64,8 Q62,16 66,22 Z"/>
    <path d="M70,22 Q74,12 68,8 Q70,16 70,22 Z"/>
    <path d="M64,32 Q62,40 66,42 Q64,38 66,34 Z"/>
    <line x1="32" y1="42" x2="32" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="40" y1="42" x2="40" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="50" y1="42" x2="50" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="58" y1="42" x2="58" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <path d="M22,32 Q14,30 14,38 Q22,38 24,36 Z"/>
    <circle cx="68" cy="28" r="1.2" fill="#fbf8f1"/>
  `,

  pig: `
    <ellipse cx="44" cy="36" rx="26" ry="11"/>
    <ellipse cx="68" cy="34" rx="10" ry="8"/>
    <ellipse cx="74" cy="34" rx="3" ry="3"/>
    <circle cx="73" cy="32" r="0.8" fill="#fbf8f1"/>
    <circle cx="75" cy="32" r="0.8" fill="#fbf8f1"/>
    <path d="M62,26 L60,18 L64,24 Z"/>
    <path d="M72,26 L74,18 L70,24 Z"/>
    <circle cx="68" cy="30" r="1.2" fill="#fbf8f1"/>
    <line x1="32" y1="46" x2="32" y2="54" stroke="currentColor" stroke-width="2.6"/>
    <line x1="40" y1="46" x2="40" y2="54" stroke="currentColor" stroke-width="2.6"/>
    <line x1="50" y1="46" x2="50" y2="54" stroke="currentColor" stroke-width="2.6"/>
    <line x1="58" y1="46" x2="58" y2="54" stroke="currentColor" stroke-width="2.6"/>
    <path d="M18,34 Q12,30 10,36 Q14,40 16,40 Q14,42 12,40 Q10,42 14,42 Z"/>
  `,

  horse: `
    <ellipse cx="42" cy="32" rx="22" ry="8"/>
    <path d="M58,28 L70,14 L76,18 L66,32 Z"/>
    <ellipse cx="74" cy="18" rx="6" ry="5"/>
    <path d="M70,12 L74,6 L74,12 Z"/>
    <path d="M76,12 L80,6 L78,12 Z"/>
    <path d="M58,18 Q60,8 64,12 Q62,18 60,22 Q58,20 56,24 Z"/>
    <line x1="30" y1="40" x2="28" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="38" y1="40" x2="38" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="50" y1="40" x2="50" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="58" y1="40" x2="60" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <path d="M20,30 Q12,32 8,40 Q14,38 20,36 Q14,42 8,46 Q16,42 22,38 Z"/>
    <circle cx="74" cy="18" r="1" fill="#fbf8f1"/>
  `,

  chicken: `
    <ellipse cx="44" cy="38" rx="20" ry="13"/>
    <circle cx="60" cy="26" r="9"/>
    <path d="M58,18 Q56,12 60,12 Q64,12 62,18 Q66,12 68,18 Q66,22 60,20 Z"/>
    <path d="M66,28 L74,28 L70,32 Z"/>
    <path d="M58,32 Q56,38 60,38 Q60,34 60,32 Z"/>
    <circle cx="60" cy="26" r="1.4" fill="#fbf8f1"/>
    <path d="M22,40 Q14,40 12,32 Q22,30 26,38 Z"/>
    <line x1="40" y1="50" x2="38" y2="58" stroke="currentColor" stroke-width="2"/>
    <line x1="48" y1="50" x2="48" y2="58" stroke="currentColor" stroke-width="2"/>
    <path d="M36,58 L34,58 L36,60 Z"/>
    <path d="M40,58 L38,60 L42,58 Z"/>
    <path d="M46,58 L44,58 L46,60 Z"/>
    <path d="M50,58 L48,60 L52,58 Z"/>
  `,

  duck: `
    <ellipse cx="44" cy="34" rx="22" ry="9"/>
    <circle cx="64" cy="26" r="8"/>
    <path d="M70,28 L80,28 L74,32 Z"/>
    <circle cx="64" cy="24" r="1.4" fill="#fbf8f1"/>
    <path d="M22,32 Q12,30 10,38 Q18,40 24,36 Z"/>
    <path d="M30,28 Q34,20 38,28" stroke="#fbf8f1" stroke-width="1.2" fill="none"/>
    <path d="M40,28 Q44,20 48,28" stroke="#fbf8f1" stroke-width="1.2" fill="none"/>
    <line x1="40" y1="44" x2="38" y2="52" stroke="currentColor" stroke-width="2"/>
    <line x1="48" y1="44" x2="48" y2="52" stroke="currentColor" stroke-width="2"/>
    <path d="M34,52 L42,52 L38,56 Z"/>
    <path d="M44,52 L52,52 L48,56 Z"/>
  `,

  dog: `
    <ellipse cx="42" cy="36" rx="22" ry="8"/>
    <ellipse cx="64" cy="30" rx="9" ry="7"/>
    <path d="M58,22 L56,12 L62,22 Z"/>
    <path d="M70,22 L72,12 L66,22 Z"/>
    <path d="M70,30 Q78,28 82,32 Q76,34 70,32 Z"/>
    <circle cx="68" cy="30" r="1.2" fill="#fbf8f1"/>
    <ellipse cx="73" cy="32" rx="1.4" ry="0.8"/>
    <line x1="30" y1="42" x2="30" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="38" y1="42" x2="38" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="50" y1="42" x2="50" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="58" y1="42" x2="58" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <path d="M22,32 Q12,28 8,30 Q14,36 22,38 Z"/>
  `,

  cat: `
    <ellipse cx="42" cy="36" rx="22" ry="8"/>
    <circle cx="64" cy="30" r="8"/>
    <path d="M58,22 L56,14 L62,22 Z"/>
    <path d="M70,22 L72,14 L66,22 Z"/>
    <ellipse cx="61" cy="29" rx="1.4" ry="2" fill="#fbf8f1"/>
    <ellipse cx="67" cy="29" rx="1.4" ry="2" fill="#fbf8f1"/>
    <path d="M64,32 L62,34 L66,34 Z"/>
    <line x1="58" y1="34" x2="52" y2="34" stroke="currentColor" stroke-width="0.8"/>
    <line x1="58" y1="36" x2="52" y2="36" stroke="currentColor" stroke-width="0.8"/>
    <line x1="70" y1="34" x2="76" y2="34" stroke="currentColor" stroke-width="0.8"/>
    <line x1="70" y1="36" x2="76" y2="36" stroke="currentColor" stroke-width="0.8"/>
    <line x1="30" y1="42" x2="30" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="38" y1="42" x2="38" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="50" y1="42" x2="50" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <line x1="56" y1="42" x2="56" y2="54" stroke="currentColor" stroke-width="2.2"/>
    <path d="M22,34 Q14,28 10,32 Q14,40 22,38 Q14,38 12,42 Q22,40 22,38 Z"/>
  `,

  donkey: `
    <ellipse cx="42" cy="34" rx="22" ry="8"/>
    <path d="M58,30 L66,18 L72,22 L64,32 Z"/>
    <ellipse cx="68" cy="22" rx="6" ry="5"/>
    <ellipse cx="64" cy="14" rx="2.4" ry="8"/>
    <ellipse cx="70" cy="14" rx="2.4" ry="8"/>
    <line x1="30" y1="42" x2="28" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="38" y1="42" x2="38" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="50" y1="42" x2="50" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <line x1="56" y1="42" x2="58" y2="54" stroke="currentColor" stroke-width="2.4"/>
    <path d="M20,32 Q12,32 10,38 Q16,40 22,38 Z"/>
    <path d="M22,38 L18,42 L24,42 Z"/>
    <circle cx="68" cy="22" r="1" fill="#fbf8f1"/>
  `,

  // ── BATCH 5 · AQUATIC + INVERTEBRATES ──────────────────────────
  tadpole: `
    <ellipse cx="32" cy="32" rx="14" ry="10"/>
    <path d="M44,32 Q60,24 78,28 Q70,32 78,38 Q60,40 44,32 Z"/>
    <path d="M76,30 Q88,24 92,28 Q88,32 92,36 Q88,40 76,34 Z"/>
    <circle cx="26" cy="28" r="2" fill="#fbf8f1"/>
    <circle cx="26" cy="28" r="1"/>
    <path d="M22,34 Q26,38 30,34" stroke="#fbf8f1" stroke-width="1" fill="none"/>
  `,

  snail: `
    <path d="M28,46 Q24,38 30,32 Q40,28 56,30 Q66,32 70,38 Q66,46 56,46 Z"/>
    <circle cx="46" cy="34" r="14"/>
    <circle cx="46" cy="34" r="10" fill="#fbf8f1"/>
    <circle cx="46" cy="34" r="6"/>
    <circle cx="46" cy="34" r="3" fill="#fbf8f1"/>
    <path d="M68,38 Q78,38 82,32 Q78,40 76,42" stroke="currentColor" stroke-width="2" fill="none"/>
    <path d="M76,30 L80,22 L82,30 Z"/>
    <path d="M82,30 L86,22 L88,30 Z"/>
    <circle cx="80" cy="24" r="0.8" fill="#fbf8f1"/>
    <circle cx="86" cy="24" r="0.8" fill="#fbf8f1"/>
  `,

  spider: `
    <ellipse cx="50" cy="34" rx="12" ry="9"/>
    <ellipse cx="50" cy="22" rx="6" ry="5"/>
    <line x1="40" y1="32" x2="22" y2="20" stroke="currentColor" stroke-width="1.6"/>
    <line x1="38" y1="34" x2="16" y2="32" stroke="currentColor" stroke-width="1.6"/>
    <line x1="40" y1="38" x2="20" y2="46" stroke="currentColor" stroke-width="1.6"/>
    <line x1="42" y1="42" x2="28" y2="56" stroke="currentColor" stroke-width="1.6"/>
    <line x1="60" y1="32" x2="78" y2="20" stroke="currentColor" stroke-width="1.6"/>
    <line x1="62" y1="34" x2="84" y2="32" stroke="currentColor" stroke-width="1.6"/>
    <line x1="60" y1="38" x2="80" y2="46" stroke="currentColor" stroke-width="1.6"/>
    <line x1="58" y1="42" x2="72" y2="56" stroke="currentColor" stroke-width="1.6"/>
    <circle cx="48" cy="20" r="1" fill="#fbf8f1"/>
    <circle cx="52" cy="20" r="1" fill="#fbf8f1"/>
  `,

  ant: `
    <ellipse cx="68" cy="32" rx="12" ry="8"/>
    <ellipse cx="50" cy="32" rx="7" ry="5"/>
    <ellipse cx="34" cy="32" rx="9" ry="7"/>
    <line x1="30" y1="26" x2="22" y2="16" stroke="currentColor" stroke-width="1.4" fill="none"/>
    <line x1="32" y1="26" x2="28" y2="14" stroke="currentColor" stroke-width="1.4" fill="none"/>
    <line x1="48" y1="36" x2="40" y2="48" stroke="currentColor" stroke-width="1.4"/>
    <line x1="52" y1="36" x2="50" y2="50" stroke="currentColor" stroke-width="1.4"/>
    <line x1="56" y1="36" x2="60" y2="50" stroke="currentColor" stroke-width="1.4"/>
    <line x1="44" y1="36" x2="32" y2="46" stroke="currentColor" stroke-width="1.4"/>
    <line x1="64" y1="36" x2="60" y2="48" stroke="currentColor" stroke-width="1.4"/>
    <line x1="72" y1="36" x2="76" y2="46" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="30" cy="30" r="1" fill="#fbf8f1"/>
  `,

  bee: `
    <ellipse cx="50" cy="34" rx="20" ry="13"/>
    <line x1="44" y1="22" x2="44" y2="46" stroke="#fbf8f1" stroke-width="3"/>
    <line x1="56" y1="22" x2="56" y2="46" stroke="#fbf8f1" stroke-width="3"/>
    <ellipse cx="36" cy="22" rx="14" ry="6" fill="#fbf8f1" stroke="currentColor" stroke-width="0.8" opacity="0.7"/>
    <ellipse cx="64" cy="22" rx="14" ry="6" fill="#fbf8f1" stroke="currentColor" stroke-width="0.8" opacity="0.7"/>
    <line x1="40" y1="22" x2="36" y2="14" stroke="currentColor" stroke-width="1.4"/>
    <line x1="42" y1="22" x2="42" y2="12" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="38" cy="32" r="1.2" fill="#fbf8f1"/>
    <path d="M68,42 L74,46 L70,40 Z"/>
  `,

  mosquito: `
    <ellipse cx="50" cy="32" rx="14" ry="3.5"/>
    <circle cx="62" cy="32" r="3.5"/>
    <path d="M64,30 L80,24" stroke="currentColor" stroke-width="1.4"/>
    <ellipse cx="44" cy="22" rx="10" ry="3" opacity="0.5"/>
    <ellipse cx="44" cy="22" rx="8" ry="2.4" fill="#fbf8f1" opacity="0.5"/>
    <line x1="38" y1="32" x2="32" y2="48" stroke="currentColor" stroke-width="1"/>
    <line x1="46" y1="32" x2="42" y2="50" stroke="currentColor" stroke-width="1"/>
    <line x1="54" y1="32" x2="60" y2="50" stroke="currentColor" stroke-width="1"/>
    <line x1="42" y1="32" x2="22" y2="46" stroke="currentColor" stroke-width="1"/>
    <line x1="50" y1="32" x2="68" y2="46" stroke="currentColor" stroke-width="1"/>
    <line x1="58" y1="32" x2="78" y2="40" stroke="currentColor" stroke-width="1"/>
  `,

  caterpillar: `
    <circle cx="20" cy="36" r="8"/>
    <circle cx="32" cy="34" r="8"/>
    <circle cx="44" cy="36" r="8"/>
    <circle cx="56" cy="34" r="8"/>
    <circle cx="68" cy="36" r="8"/>
    <circle cx="80" cy="34" r="9"/>
    <line x1="78" y1="26" x2="76" y2="18" stroke="currentColor" stroke-width="1.4"/>
    <line x1="84" y1="26" x2="86" y2="18" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="78" cy="32" r="1.2" fill="#fbf8f1"/>
    <circle cx="84" cy="32" r="1.2" fill="#fbf8f1"/>
    <line x1="20" y1="44" x2="20" y2="50" stroke="currentColor" stroke-width="1.4"/>
    <line x1="32" y1="42" x2="32" y2="50" stroke="currentColor" stroke-width="1.4"/>
    <line x1="44" y1="44" x2="44" y2="50" stroke="currentColor" stroke-width="1.4"/>
    <line x1="56" y1="42" x2="56" y2="50" stroke="currentColor" stroke-width="1.4"/>
    <line x1="68" y1="44" x2="68" y2="50" stroke="currentColor" stroke-width="1.4"/>
  `,

  cockroach: `
    <ellipse cx="50" cy="36" rx="26" ry="11"/>
    <ellipse cx="50" cy="32" rx="22" ry="8" fill="#fbf8f1" opacity="0.45"/>
    <line x1="50" y1="32" x2="50" y2="42" stroke="#fbf8f1" stroke-width="1.4"/>
    <ellipse cx="68" cy="28" rx="6" ry="5"/>
    <path d="M70,22 Q90,12 92,4" stroke="currentColor" stroke-width="1.2" fill="none"/>
    <path d="M72,22 Q90,16 96,10" stroke="currentColor" stroke-width="1.2" fill="none"/>
    <line x1="32" y1="42" x2="22" y2="50" stroke="currentColor" stroke-width="1.2"/>
    <line x1="42" y1="44" x2="36" y2="54" stroke="currentColor" stroke-width="1.2"/>
    <line x1="52" y1="44" x2="50" y2="56" stroke="currentColor" stroke-width="1.2"/>
    <line x1="62" y1="44" x2="64" y2="54" stroke="currentColor" stroke-width="1.2"/>
    <line x1="68" y1="42" x2="76" y2="50" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="68" cy="28" r="1" fill="#fbf8f1"/>
  `,

  octopus: `
    <ellipse cx="50" cy="22" rx="22" ry="14"/>
    <path d="M30,28 Q26,40 30,52 Q34,42 32,32 Z"/>
    <path d="M38,30 Q34,46 40,56 Q42,46 40,34 Z"/>
    <path d="M46,30 Q44,50 50,58 Q52,46 50,32 Z"/>
    <path d="M54,30 Q56,50 60,58 Q58,46 58,32 Z"/>
    <path d="M62,30 Q66,46 68,56 Q66,46 66,34 Z"/>
    <path d="M70,28 Q72,42 74,52 Q72,42 72,32 Z"/>
    <circle cx="42" cy="20" r="2" fill="#fbf8f1"/>
    <circle cx="42" cy="20" r="1"/>
    <circle cx="58" cy="20" r="2" fill="#fbf8f1"/>
    <circle cx="58" cy="20" r="1"/>
    <path d="M40,28 Q50,32 60,28" stroke="#fbf8f1" stroke-width="1" fill="none"/>
  `,

  jellyfish: `
    <path d="M22,30 Q22,12 50,12 Q78,12 78,30 Q78,32 74,32 L26,32 Q22,32 22,30 Z"/>
    <path d="M26,32 Q28,42 24,52 Q26,46 30,40 Z"/>
    <path d="M36,32 Q36,46 30,56 Q34,46 38,40 Z"/>
    <path d="M44,32 Q42,48 38,58 Q42,48 46,40 Z"/>
    <path d="M52,32 Q54,48 50,58 Q54,48 54,40 Z"/>
    <path d="M60,32 Q60,46 64,56 Q62,46 62,40 Z"/>
    <path d="M68,32 Q70,42 74,52 Q70,46 70,40 Z"/>
    <ellipse cx="40" cy="22" rx="6" ry="4" fill="#fbf8f1" opacity="0.6"/>
    <ellipse cx="58" cy="22" rx="6" ry="4" fill="#fbf8f1" opacity="0.6"/>
  `,

  shrimp: `
    <path d="M22,40 Q22,28 36,22 Q56,18 70,22 Q80,28 80,38 Q72,42 60,40 Q44,40 32,42 Q22,42 22,40 Z"/>
    <path d="M80,32 L92,28 L88,38 L82,38 Z"/>
    <path d="M82,28 L94,22 L94,32 Z" opacity="0.7"/>
    <line x1="36" y1="22" x2="22" y2="14" stroke="currentColor" stroke-width="1.2"/>
    <line x1="36" y1="22" x2="20" y2="10" stroke="currentColor" stroke-width="1.2"/>
    <line x1="38" y1="40" x2="34" y2="50" stroke="currentColor" stroke-width="1.2"/>
    <line x1="46" y1="40" x2="44" y2="50" stroke="currentColor" stroke-width="1.2"/>
    <line x1="54" y1="40" x2="54" y2="50" stroke="currentColor" stroke-width="1.2"/>
    <line x1="62" y1="40" x2="64" y2="50" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="34" cy="28" r="1.4" fill="#fbf8f1"/>
    <line x1="40" y1="28" x2="68" y2="28" stroke="#fbf8f1" stroke-width="0.8"/>
    <line x1="40" y1="32" x2="68" y2="32" stroke="#fbf8f1" stroke-width="0.8"/>
  `,

  prawn: `
    <path d="M22,40 Q22,28 36,22 Q56,18 70,22 Q80,28 80,38 Q72,42 60,40 Q44,40 32,42 Q22,42 22,40 Z"/>
    <path d="M80,32 L92,28 L88,38 L82,38 Z"/>
    <path d="M82,28 L94,22 L94,32 Z" opacity="0.7"/>
    <line x1="36" y1="22" x2="22" y2="14" stroke="currentColor" stroke-width="1.2"/>
    <line x1="36" y1="22" x2="20" y2="10" stroke="currentColor" stroke-width="1.2"/>
    <line x1="38" y1="40" x2="34" y2="50" stroke="currentColor" stroke-width="1.2"/>
    <line x1="46" y1="40" x2="44" y2="50" stroke="currentColor" stroke-width="1.2"/>
    <line x1="54" y1="40" x2="54" y2="50" stroke="currentColor" stroke-width="1.2"/>
    <line x1="62" y1="40" x2="64" y2="50" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="34" cy="28" r="1.4" fill="#fbf8f1"/>
    <line x1="40" y1="28" x2="68" y2="28" stroke="#fbf8f1" stroke-width="0.8"/>
    <line x1="40" y1="32" x2="68" y2="32" stroke="#fbf8f1" stroke-width="0.8"/>
  `,

  dragonfly: `
    <ellipse cx="50" cy="34" rx="22" ry="3"/>
    <circle cx="70" cy="34" r="5"/>
    <ellipse cx="44" cy="22" rx="14" ry="6" opacity="0.55"/>
    <ellipse cx="56" cy="22" rx="14" ry="6" opacity="0.55"/>
    <ellipse cx="44" cy="46" rx="14" ry="6" opacity="0.55"/>
    <ellipse cx="56" cy="46" rx="14" ry="6" opacity="0.55"/>
    <line x1="74" y1="32" x2="80" y2="28" stroke="currentColor" stroke-width="1.2"/>
    <line x1="74" y1="36" x2="80" y2="40" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="68" cy="32" r="1.2" fill="#fbf8f1"/>
    <circle cx="72" cy="32" r="1.2" fill="#fbf8f1"/>
    <line x1="40" y1="34" x2="20" y2="34" stroke="currentColor" stroke-width="2.4"/>
  `,

  ladybug: `
    <ellipse cx="50" cy="36" rx="22" ry="14"/>
    <line x1="50" y1="22" x2="50" y2="50" stroke="#fbf8f1" stroke-width="1.4"/>
    <ellipse cx="50" cy="22" rx="9" ry="6"/>
    <circle cx="40" cy="32" r="2.4" fill="#fbf8f1"/>
    <circle cx="60" cy="32" r="2.4" fill="#fbf8f1"/>
    <circle cx="42" cy="42" r="2.4" fill="#fbf8f1"/>
    <circle cx="58" cy="42" r="2.4" fill="#fbf8f1"/>
    <circle cx="50" cy="38" r="2" fill="#fbf8f1"/>
    <line x1="46" y1="22" x2="42" y2="14" stroke="currentColor" stroke-width="1.2"/>
    <line x1="54" y1="22" x2="58" y2="14" stroke="currentColor" stroke-width="1.2"/>
  `,
};

/**
 * Look up a silhouette by organism name. Tolerant of common variations:
 * plurals, capitalisation, "African ", "Cape ", "Common " prefixes, and
 * spaces vs hyphens. Returns null if no match.
 *
 * @param {string} name
 * @returns {string|null} the silhouette SVG fragment, or null if unknown
 */
export function lookupSilhouette(name) {
  if (!name || typeof name !== 'string') return null;
  const variants = normalisationCandidates(name);
  for (const key of variants) {
    if (SILHOUETTES[key]) return SILHOUETTES[key];
  }
  return null;
}

export function listSilhouetteKeys() {
  return Object.keys(SILHOUETTES);
}

function normalisationCandidates(name) {
  let s = name.toLowerCase().trim();
  s = s.replace(/[^a-z\s-]/g, '').replace(/\s+/g, ' ');

  // Strip leading qualifiers Claude tends to add ("African Frog", "Cape …").
  const stripPrefixes = /^(african|cape|common|wild|the|a|an|sa|south[- ]african)\s+/;
  let stripped = s;
  while (stripPrefixes.test(stripped)) stripped = stripped.replace(stripPrefixes, '');

  const candidates = new Set();
  for (const base of [s, stripped]) {
    candidates.add(base.replace(/\s+/g, '-'));
    // Crude singularisation — handles "frogs" → "frog", "fishes" → "fish",
    // "berries" → "berry". Good enough for organism names.
    candidates.add(base.replace(/ies$/, 'y').replace(/\s+/g, '-'));
    candidates.add(base.replace(/(s|es)$/, '').replace(/\s+/g, '-'));
    // Last word only — "cape sugarbird" might also match "sugarbird".
    const last = base.split(' ').pop();
    if (last) {
      candidates.add(last);
      candidates.add(last.replace(/(s|es)$/, ''));
    }
  }
  return [...candidates].filter(Boolean);
}
