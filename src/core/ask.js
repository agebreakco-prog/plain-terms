// "Ask the fine print": answer one question about a document, with a quote.
//
// The hybrid trick: instead of sending the whole document, a deterministic
// retriever picks the few passages most relevant to the question. That context
// is small (a few thousand characters), so even a 40-page privacy policy can be
// questioned privately by Gemini Nano on the device. The cloud is only used
// when Nano is missing (or the user picked Cloud first). Like the main
// analysis, the answer's quote is grounded against the document and the
// routing reason reports where inference actually ran.

import { normalize, splitSentences } from './segment.js';
import { planAnalysis, MODE } from './router.js';
import { parseModelJson, isGrounded } from './merge.js';

export const ASK_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['yes', 'no', 'depends', 'not_stated'], description: 'Short answer to the question.' },
    answer: { type: 'string', description: 'One or two plain sentences answering the question from the passages only.' },
    quote: { type: 'string', description: 'The exact words from the passages that support the answer, or empty.' },
  },
  required: ['verdict', 'answer', 'quote'],
};

export const SUGGESTED_QUESTIONS = [
  'Can I cancel any time?',
  'Do they sell or share my data?',
  'Can I get a refund?',
  'Can I sue them?',
  'Is my data deleted when I leave?',
];

// Small synonym map so everyday questions find legal wording.
const EXPAND = {
  cancel: ['cancel', 'cancellation', 'terminate', 'termination', 'renew', 'renewal', 'subscription', 'trial'],
  refund: ['refund', 'refunds', 'refundable', 'non-refundable', 'credit', 'credits', 'fee', 'fees', 'charge'],
  sell: ['sell', 'sold', 'sale', 'share', 'shared', 'disclose', 'advertising', 'advertisers', 'partners', 'brokers', 'third'],
  share: ['share', 'shared', 'sharing', 'disclose', 'sell', 'partners', 'advertisers', 'third'],
  data: ['data', 'information', 'personal'],
  sue: ['sue', 'court', 'arbitration', 'arbitrator', 'class', 'jury', 'dispute', 'disputes', 'waive'],
  court: ['court', 'arbitration', 'class', 'jury', 'dispute'],
  delete: ['delete', 'deletion', 'deleted', 'retain', 'retention', 'keep', 'kept', 'erase', 'close', 'closed'],
  leave: ['delete', 'close', 'terminate', 'retain', 'after'],
  track: ['track', 'tracking', 'cookies', 'pixels', 'sdks', 'profiles', 'across', 'advertising'],
  cookies: ['cookies', 'cookie', 'pixels', 'trackers', 'consent'],
  location: ['location', 'geolocation', 'gps', 'precise'],
  content: ['content', 'licence', 'license', 'upload', 'post', 'perpetual', 'royalty'],
  photos: ['content', 'licence', 'license', 'upload', 'photos', 'videos'],
  price: ['price', 'prices', 'fee', 'fees', 'charge', 'increase'],
  change: ['change', 'changes', 'modify', 'update', 'amend', 'revise'],
  kids: ['children', 'child', 'minors', 'age', '13', '16'],
  children: ['children', 'child', 'minors', 'age'],
  health: ['health', 'heart', 'medical', 'biometric', 'sleep'],
};

const STOP = new Set(
  'a an the and or but if of to in on at by for with from as is are was be can i my me you your they them their it its do does did will would should could any all this that what when where who how which there here have has had not no yes about into than then so'.split(' '),
);

// Words that appear everywhere in policies: they barely help ranking.
const GENERIC = new Set(['data', 'information', 'personal', 'account', 'service', 'services', 'use', 'get', 'them', 'leave']);

const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');

/** Content words of a question, expanded with legal synonyms, stemmed. */
export function queryTerms(question) {
  const words = String(question ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9' -]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
  const terms = new Map();
  for (const w of words) {
    const weight = GENERIC.has(w) ? 0.5 : 2;
    terms.set(stem(w), Math.max(terms.get(stem(w)) || 0, weight));
    for (const syn of EXPAND[w] || EXPAND[stem(w)] || []) {
      const s = stem(syn);
      if (!terms.has(s)) terms.set(s, GENERIC.has(syn) ? 0.5 : 1);
    }
  }
  return terms;
}

/**
 * Pick the passages most relevant to the question (keyword overlap with
 * synonym expansion), returned in document order and capped at maxChars.
 */
export function retrievePassages(text, question, { maxChars = 3500, k = 8 } = {}) {
  const terms = queryTerms(question);
  const sentences = splitSentences(text).filter((s) => s.length >= 25);
  const scored = sentences.map((s, idx) => {
    const words = new Set(s.toLowerCase().replace(/[^a-z0-9' -]+/g, ' ').split(/\s+/).map(stem));
    let score = 0;
    for (const [t, w] of terms) if (words.has(t)) score += w;
    return { s, idx, score: score / Math.sqrt(Math.max(8, words.size) / 8) };
  });
  const picked = [];
  let used = 0;
  for (const c of scored.filter((c) => c.score > 0).sort((a, b) => b.score - a.score)) {
    if (picked.length >= k || used + c.s.length > maxChars) continue;
    picked.push(c);
    used += c.s.length;
  }
  return picked.sort((a, b) => a.idx - b.idx).map((c) => c.s);
}

export function buildAskPrompt(question, passages, kind = 'legal text') {
  return (
    'You answer questions about legal text for ordinary people. Use plain words, "you" and "they", no jargon. ' +
    'Answer ONLY from the passages below. If they do not answer the question, use verdict "not_stated". ' +
    'Copy the supporting quote word for word from the passages. Answer only with JSON matching the schema.\n\n' +
    `Document type: ${kind}.\nQuestion: ${question}\n\n<passages>\n${passages.join('\n')}\n</passages>`
  );
}

const VERDICT_TEXT = { yes: 'Yes', no: 'No', depends: 'It depends', not_stated: 'Not stated', unclear: 'See the passages' };
export { VERDICT_TEXT };

/**
 * @param {string} text full document
 * @param {string} question
 * @param {object} ctx same shape as analyzeDocument's ctx (settings, env, runModel, kind)
 * @returns {Promise<{verdict:string, answer:string, quote:string, passages:string[], sources:string[], reason:string, ms:number}>}
 */
export async function answerQuestion(text, question, ctx = {}) {
  const t0 = Date.now();
  const q = String(question ?? '').trim();
  if (!q) throw new Error('Type a question first.');
  const clean = normalize(text);
  if (!clean) throw new Error('There is no document to ask about. Explain a document first.');
  const passages = retrievePassages(clean, q);
  const sources = new Set();
  const done = (o) => ({ passages, sources: [...sources], ms: Date.now() - t0, ...o });

  const fallback = (reason) => {
    sources.add('rules');
    return done({
      verdict: passages.length ? 'unclear' : 'not_stated',
      answer: passages.length
        ? 'These are the parts of the document that talk about this. Read them before you agree.'
        : 'The document does not seem to mention this.',
      quote: passages[0] || '',
      reason,
    });
  };

  if (!passages.length) return fallback('No passage in the document matches this question, so no AI call was needed.');

  const context = passages.join('\n');
  const plan = planAnalysis({
    chars: context.length,
    privacy: ctx.settings?.privacy,
    demo: ctx.settings?.demo,
    online: ctx.env?.online,
    nano: ctx.env?.nano,
    firebaseReady: ctx.env?.firebaseReady && typeof ctx.runModel === 'function',
    limits: ctx.limits,
  });
  if (plan.engine !== 'firebase') return fallback(plan.reason.replace(/the built-in rules ran/, 'the matching passages are shown'));

  const prompt = buildAskPrompt(q, passages, ctx.kind);
  let obj = null;
  try {
    const res = await ctx.runModel({ mode: plan.mode, prompt, schema: ASK_SCHEMA });
    sources.add(res.source);
    obj = parseModelJson(res.text);
  } catch (err) {
    return fallback(`The AI model was unavailable (${String(err?.message || err).slice(0, 80)}), so the matching passages are shown instead.`);
  }
  if (!obj || typeof obj.answer !== 'string' || !obj.answer.trim()) {
    return fallback('The AI answer could not be read, so the matching passages are shown instead.');
  }
  const verdict = VERDICT_TEXT[obj.verdict] ? obj.verdict : 'depends';
  let quote = typeof obj.quote === 'string' ? obj.quote.trim() : '';
  const grounded = quote ? isGrounded(quote, clean) : false;
  if (quote && !grounded) quote = '';

  const onDevice = sources.has('on_device') && !sources.has('in_cloud');
  const n = passages.length;
  const reason = onDevice
    ? `Only the ${n} most relevant passage${n === 1 ? '' : 's'} (${Math.round(context.length / 100) / 10}k characters) were picked on this device and answered by Gemini Nano. Nothing was sent to the cloud.`
    : plan.mode === MODE.PREFER_IN_CLOUD || plan.mode === MODE.ONLY_IN_CLOUD
      ? `Cloud-first is selected: the ${n} most relevant passages were answered by Gemini in the cloud.`
      : `Gemini Nano isn’t ready on this device, so Firebase AI Logic answered from the ${n} most relevant passages in the cloud.`;
  return done({ verdict, answer: obj.answer.trim(), quote, grounded, reason });
}
