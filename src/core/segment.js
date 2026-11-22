// Text helpers: normalisation, sentence splitting and chunking.
// Pure functions with no browser or Firebase dependencies, so they run in Node tests.

/** Collapse runs of whitespace while keeping paragraph breaks. */
export function normalize(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lowercase, single-spaced form used for fuzzy quote matching. */
export function squash(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9'"%$ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ABBREVIATIONS = /\b(?:e\.g|i\.e|etc|inc|ltd|llc|co|corp|no|vs|u\.s|mr|ms|dr|st|sec)\.$/i;

/** Split text into sentences. Headings and list items count as sentences. */
export function splitSentences(text) {
  const out = [];
  for (const para of normalize(text).split(/\n+/)) {
    let buf = '';
    const parts = para.split(/(?<=[.!?;])\s+(?=[("'A-Z0-9•-])/);
    for (const part of parts) {
      buf = buf ? `${buf} ${part}` : part;
      if (!ABBREVIATIONS.test(buf)) {
        if (buf.trim()) out.push(buf.trim());
        buf = '';
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

/**
 * Split text into chunks of at most maxChars, cutting on paragraph and then
 * sentence boundaries. A single oversize sentence is hard-cut as a last resort.
 */
export function chunkText(text, maxChars) {
  const clean = normalize(text);
  if (!maxChars || clean.length <= maxChars) return clean ? [clean] : [];
  const chunks = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = '';
  };
  const add = (piece, sep) => {
    if (piece.length > maxChars) {
      push();
      for (let i = 0; i < piece.length; i += maxChars) chunks.push(piece.slice(i, i + maxChars));
      return;
    }
    if (cur.length + sep.length + piece.length > maxChars) push();
    cur = cur ? cur + sep + piece : piece;
  };
  for (const para of clean.split(/\n\n+/)) {
    if (para.length <= maxChars) add(para, '\n\n');
    else for (const s of splitSentences(para)) add(s, ' ');
  }
  push();
  return chunks;
}

/** Rough token estimate (about 4 characters per token for English). */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}
