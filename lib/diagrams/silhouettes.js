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
