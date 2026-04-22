// Robust extractor for Claude responses.
//
// The pipeline asks Claude to return JSON shaped like {"content": "..."} and
// strips markdown fences around it. In practice Claude sometimes:
//   * returns the JSON plainly                              → easy case
//   * wraps it in ```json fences                            → strip fences
//   * writes reasoning BEFORE the JSON                      → locate {"content":
//   * writes the content unwrapped (no JSON)                → return the text
//   * writes half-valid escape sequences inside "content"   → graceful fallback
//
// This module handles all of the above deterministically.

/** Unescape common JSON escape sequences in a bare string. */
function unescape(s) {
  return s
    .replace(/\\r\\n|\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/**
 * Find the balanced JSON object that begins at `startIdx`. Returns the slice
 * including both braces, or null if the text is unbalanced.
 */
function extractBalancedObject(text, startIdx) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

/** Strip leading commentary lines until we hit something that looks like real paper content. */
function stripLeadingCommentary(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    // Real content markers: question headings, section headers, numbered items,
    // TOTAL/TOTAAL lines, MEMORANDUM.
    if (/^(SECTION|AFDELING|Question\s+\d|Vraag\s+\d|\d+\.\d|TOTAL\s*:|TOTAAL\s*:|MEMORANDUM)/i.test(l)) {
      return lines.slice(i).join('\n');
    }
  }
  return text;
}

/**
 * Extract the `content` field out of a Claude response.
 *
 *   - If the response parses as JSON with a `content` key, return it.
 *   - Else, if the response contains a `{"content": "..."}` substring, extract
 *     the balanced object starting there and parse that.
 *   - Else, if the content was written inline as a string, try to match the
 *     "content": "..." pair with a non-greedy regex and unescape the value.
 *   - Else, strip leading commentary and return the remaining text.
 *
 * Always returns a string; never throws.
 */
export function extractContent(raw) {
  if (raw == null) return '';
  if (typeof raw !== 'string') raw = String(raw);
  let text = raw.trim();

  // Strip markdown fences around JSON (```json … ```)
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/g, '').trim();

  // Attempt 1: whole thing is JSON.
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.content === 'string') return parsed.content;
  } catch {}

  // Attempt 2: find {"content": …} embedded in prose and extract that object.
  const match = text.match(/\{\s*"content"\s*:/);
  if (match) {
    const startIdx = text.indexOf('{', match.index);
    const slice = extractBalancedObject(text, startIdx);
    if (slice) {
      try {
        const parsed = JSON.parse(slice);
        if (parsed && typeof parsed.content === 'string') return parsed.content;
      } catch {}
    }

    // Attempt 3: regex on the "content" key-value pair as a last resort.
    const kv = /"content"\s*:\s*"((?:[^"\\]|\\[\s\S])*)"/.exec(text.slice(match.index));
    if (kv) return unescape(kv[1]);
  }

  // Attempt 4: no JSON wrapper at all — strip commentary and return.
  return stripLeadingCommentary(text);
}
