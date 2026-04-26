// Robust extractor for Claude responses.
//
// The pipeline asks Claude to return JSON shaped like {"content": "..."} and
// strips markdown fences around it. In practice Claude sometimes:
//   * returns the JSON plainly                              → easy case
//   * wraps it in ```json fences                            → strip fences
//   * writes reasoning BEFORE the JSON                      → locate {"content":
//   * writes the content unwrapped (no JSON)                → return the text
//   * writes half-valid escape sequences inside "content"   → graceful fallback
//   * truncates the JSON mid-string (max_tokens hit)        → recover what we have
//   * leaks "Q7.x: ..." phase-commentary preamble (Bug 21)  → strip + recover
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
 * Pull a `\`\`\`json … \`\`\`` block out of the middle of a response.
 * Claude sometimes prefixes a fenced JSON block with reasoning text, so the
 * outer fence-strip regex (anchored to ^ and $) does not catch it. Returns
 * the unfenced content if a single block is found, or null otherwise.
 *
 * The match is non-greedy so a response with multiple fenced blocks returns
 * the FIRST one — that's almost always the corrected output, not a follow-up
 * "and here's an explanation" block.
 */
function extractFromFencedBlock(text) {
  const m = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text);
  if (!m) return null;
  const inner = m[1].trim();
  if (!inner) return null;
  return inner;
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
    // TOTAL/TOTAAL lines, MEMORANDUM, or a pipe-table row.
    if (
      /^(SECTION|AFDELING|Question\s+\d|Vraag\s+\d|\d+\.\d|TOTAL\s*:|TOTAAL\s*:|MEMORANDUM)/i.test(l) ||
      /^\|\s*(NO\.|NR\.|N°|#)/i.test(l) ||
      /^\|\s*\d+\.\d/.test(l) // a pipe-table row whose first cell is "1.1" / "2.3" / etc.
    ) {
      return lines.slice(i).join('\n');
    }
  }
  return text;
}

/**
 * Strip stray JSON envelope artifacts that survive the parsing attempts —
 * e.g. a lone `"}` or `}` line at the tail when the content was extracted
 * from a partially-parseable response. Conservative: only matches lines
 * that are EXACTLY the artifact, never a line containing other content.
 */
function stripJsonEnvelopeArtifacts(text) {
  if (!text) return text;
  const lines = text.split('\n');
  // Drop trailing artifact lines (possibly preceded by blanks).
  while (lines.length) {
    const tail = lines[lines.length - 1].trim();
    if (tail === '' || tail === '"}' || tail === '}' || tail === '```' || tail === '"') {
      lines.pop();
      continue;
    }
    break;
  }
  // Drop a leading `{"content":"` opener if it survived as its own line —
  // happens when Claude wraps its JSON unusually and the body text begins
  // straight after the colon.
  while (lines.length && lines[0].trim() === '') lines.shift();
  if (lines.length) {
    const head = lines[0].trim();
    const opener = /^\{\s*"content"\s*:\s*"?$/;
    if (opener.test(head)) lines.shift();
  }
  return lines.join('\n');
}

/**
 * Last-resort recovery for a truncated `{"content":"…"` envelope: if Claude
 * hit max_tokens mid-string the closing `"}` never appears, so the JSON
 * parser fails and the regex match also fails. Read everything AFTER the
 * `{"content":"` opener up to the natural end of the response, unescape
 * the JSON escape sequences, and return that. Better to ship a slightly
 * truncated paper than the entire malformed JSON envelope (the Paper 11
 * leak — Bug 21).
 *
 * Returns null if no `{"content":"` opener is present.
 */
function recoverTruncatedContent(text) {
  const opener = /\{\s*"content"\s*:\s*"/;
  const m = opener.exec(text);
  if (!m) return null;
  let body = text.slice(m.index + m[0].length);
  // Strip a trailing markdown fence and any partial closing of the JSON
  // (e.g. `…\n` or `…",`). We unescape so newlines / quotes render correctly.
  body = body.replace(/```\s*$/, '').replace(/"\s*\}\s*$/, '').replace(/"\s*$/, '');
  body = unescape(body);
  return body;
}

/**
 * Extract the `content` field out of a Claude response.
 *
 *   - If the response parses as JSON with a `content` key, return it.
 *   - Else, if a fenced ```json … ``` block sits in the middle of prose
 *     (Bug 21 leak shape), peel it out and parse from there.
 *   - Else, if the response contains a `{"content": "..."}` substring, extract
 *     the balanced object starting there and parse that.
 *   - Else, if the content was written inline as a string, try to match the
 *     "content": "..." pair with a non-greedy regex and unescape the value.
 *   - Else, if a `{"content":"` opener is present but parsing failed (the
 *     model hit max_tokens mid-string), salvage everything AFTER the opener.
 *   - Else, strip leading commentary and return the remaining text.
 *
 * Always returns a string; never throws.
 */
export function extractContent(raw) {
  if (raw == null) return '';
  if (typeof raw !== 'string') raw = String(raw);
  let text = raw.trim();

  // Strip markdown fences around JSON when they sit at the very start/end
  // (the simple shape — nothing else outside the fences).
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/g, '').trim();

  // Attempt 1: whole thing is JSON.
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.content === 'string') return parsed.content;
  } catch {}

  // Attempt 1b: a ```json fence embedded in prose. Pull just the fenced
  // body and recurse so the JSON-parsing attempts above can run on it.
  // This catches the Paper 11 leak shape:
  //   "Q7.4: <reasoning>\n\n```json\n{\"content\":\"…\"}\n```"
  const fenced = extractFromFencedBlock(raw);
  if (fenced && fenced !== text) {
    try {
      const parsed = JSON.parse(fenced);
      if (parsed && typeof parsed.content === 'string') return parsed.content;
    } catch {}
    // Even if the fenced block isn't strictly parseable, try the embedded
    // {"content":…} extraction on it.
    const fencedMatch = fenced.match(/\{\s*"content"\s*:/);
    if (fencedMatch) {
      const startIdx = fenced.indexOf('{', fencedMatch.index);
      const slice = extractBalancedObject(fenced, startIdx);
      if (slice) {
        try {
          const parsed = JSON.parse(slice);
          if (parsed && typeof parsed.content === 'string') return parsed.content;
        } catch {}
      }
    }
  }

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

    // Attempt 3b: truncated JSON recovery (Bug 21). The opener is present
    // but neither the balanced extractor nor the regex could close the
    // string — almost certainly a max_tokens cutoff. Salvage the body
    // anyway so the user gets the partial paper, not the JSON envelope.
    const recovered = recoverTruncatedContent(text);
    if (recovered) return stripJsonEnvelopeArtifacts(recovered);
  }

  // Attempt 4: no parseable JSON wrapper. Strip commentary, then defensively
  // strip any envelope artifacts left over from a malformed response.
  return stripJsonEnvelopeArtifacts(stripLeadingCommentary(text));
}
