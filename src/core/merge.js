// Turning raw model output into a trustworthy result:
//  - tolerant JSON parsing (small models sometimes wrap JSON in fences or prose)
//  - grounding: every quote a model returns is checked against the source text
//  - merging model findings with the deterministic rule findings

import { CATEGORIES, scoreRisks } from './detector.js';
import { squash } from './segment.js';

/** Parse the first JSON object in a model reply. Returns null on failure. */
export function parseModelJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  const s = String(raw ?? '').replace(/```(?:json)?/gi, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Is `quote` really in `source`? Exact match after squashing, or at least 80%
 * of its 4-word shingles present (tolerates small punctuation/ellipsis edits).
 */
export function isGrounded(quote, source) {
  const q = squash(quote);
  if (q.length < 12) return false;
  const src = typeof source === 'string' ? squash(source) : source.squashed;
  if (src.includes(q)) return true;
  const words = q.split(' ');
  if (words.length < 6) return false;
  let hit = 0;
  let total = 0;
  for (let i = 0; i + 4 <= words.length; i++) {
    total++;
    if (src.includes(words.slice(i, i + 4).join(' '))) hit++;
  }
  return total > 0 && hit / total >= 0.8;
}

const SEVERITIES = new Set(['high', 'medium', 'low']);

/** Validate and normalise one model result against the source text. */
export function sanitizeModelResult(obj, sourceText) {
  const source = { squashed: squash(sourceText) };
  const tldr = typeof obj?.tldr === 'string' ? obj.tldr.trim() : '';
  const points = Array.isArray(obj?.points)
    ? obj.points.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim()).slice(0, 6)
    : [];
  const risks = [];
  let dropped = 0;
  for (const r of Array.isArray(obj?.risks) ? obj.risks : []) {
    if (!r || typeof r.quote !== 'string') continue;
    if (!isGrounded(r.quote, source)) {
      dropped++;
      continue;
    }
    const category = CATEGORIES[r.category] ? r.category : 'other';
    risks.push({
      category,
      label: CATEGORIES[category]?.label ?? 'Worth a look',
      severity: SEVERITIES.has(r.severity) ? r.severity : CATEGORIES[category]?.severity ?? 'low',
      quote: r.quote.trim(),
      why: typeof r.why === 'string' && r.why.trim() ? r.why.trim() : CATEGORIES[category]?.why ?? '',
      origin: 'ai',
    });
  }
  return { tldr, points, risks, dropped };
}

/** Do two quotes overlap enough to be the same clause? */
function sameClause(a, b) {
  const x = squash(a);
  const y = squash(b);
  return x.includes(y.slice(0, 60)) || y.includes(x.slice(0, 60));
}

/**
 * Merge model risks with rule risks. Model wording wins when both found the
 * same category/clause; rule-only findings are kept and marked as such.
 */
export function mergeRisks(aiRisks, ruleRisks) {
  const merged = [];
  for (const r of aiRisks) {
    const dup = merged.find((m) => (m.category === r.category && r.category !== 'other') || sameClause(m.quote, r.quote));
    if (!dup) merged.push({ ...r });
  }
  for (const r of ruleRisks) {
    const match = merged.find((m) => m.category === r.category || sameClause(m.quote, r.quote));
    if (match) match.origin = 'ai+rules';
    else merged.push({ ...r });
  }
  const order = { high: 0, medium: 1, low: 2 };
  return merged.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
}

/** Combine per-chunk model results (map step) into one. */
export function combineChunkResults(results) {
  const points = [];
  const seen = new Set();
  for (const r of results) {
    for (const p of r.points) {
      const key = squash(p).slice(0, 50);
      if (!seen.has(key)) {
        seen.add(key);
        points.push(p);
      }
    }
  }
  return {
    tldr: results.map((r) => r.tldr).filter(Boolean).join(' '),
    tldrs: results.map((r) => r.tldr).filter(Boolean),
    points: points.slice(0, 8),
    risks: mergeRisks(results.flatMap((r) => r.risks), []),
    dropped: results.reduce((n, r) => n + (r.dropped || 0), 0),
  };
}

/** Final result object consumed by the UI. */
export function finalizeResult({ tldr, points, risks, kind, chars }) {
  const { score, label } = scoreRisks(risks);
  return { kind, chars, tldr, points, risks, score, scoreLabel: label };
}
