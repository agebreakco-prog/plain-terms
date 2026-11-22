// Orchestrates one analysis: rules -> routing plan -> model call(s) via the
// injected `runModel` (Firebase AI Logic in the app, a fake in tests) ->
// grounding + merge -> final result. Never throws for model failures: it
// degrades to the next plan, then to rules-only, and says so in `notes`.

import { normalize, chunkText } from './segment.js';
import { detectRisks, classifyDocument } from './detector.js';
import { planAnalysis, DEFAULT_LIMITS, MODE } from './router.js';
import { buildPrompt, buildReducePrompt, RESULT_SCHEMA, REDUCE_SCHEMA } from './prompts.js';
import { parseModelJson, sanitizeModelResult, mergeRisks, combineChunkResults, finalizeResult } from './merge.js';
import { demoAnalyze } from './demo.js';

const SOURCE_LABEL = { on_device: 'On-device (Gemini Nano)', in_cloud: 'Cloud (Gemini)', rules: 'Built-in rules' };
export { SOURCE_LABEL };

/**
 * @param {string} text
 * @param {object} ctx
 * @param {{privacy?:string, demo?:boolean}} ctx.settings
 * @param {{online:boolean, nano:string, firebaseReady:boolean}} ctx.env
 * @param {object} [ctx.limits]
 * @param {(req:{mode:string,prompt:string,schema:object}) => Promise<{text:string, source:string}>} [ctx.runModel]
 * @param {(msg:string) => void} [ctx.onProgress]
 */
export async function analyzeDocument(text, ctx) {
  const t0 = Date.now();
  const clean = normalize(text);
  if (!clean) throw new Error('There is no text to analyse.');
  const limits = { ...DEFAULT_LIMITS, ...(ctx.limits || {}) };
  const progress = ctx.onProgress || (() => {});
  const kind = classifyDocument(clean);
  const ruleRisks = detectRisks(clean);
  const notes = [];
  const sources = new Set();

  const plan = planAnalysis({
    chars: clean.length,
    privacy: ctx.settings?.privacy,
    demo: ctx.settings?.demo,
    online: ctx.env?.online,
    nano: ctx.env?.nano,
    firebaseReady: ctx.env?.firebaseReady && typeof ctx.runModel === 'function',
    limits,
  });

  const rulesOnly = (reason) => {
    const d = demoAnalyze(clean);
    sources.add('rules');
    return pack(d.tldr, d.points, d.risks, reason);
  };

  const pack = (tldr, points, risks, reason) => ({
    result: finalizeResult({ tldr, points, risks, kind, chars: clean.length }),
    plan,
    reason,
    sources: [...sources],
    notes,
    ms: Date.now() - t0,
  });

  if (plan.engine !== 'firebase') return rulesOnly(plan.reason);

  const callModel = async (mode, prompt, schema, sourceText) => {
    const res = await ctx.runModel({ mode, prompt, schema });
    sources.add(res.source);
    let obj = parseModelJson(res.text);
    if (!obj) {
      // One repair attempt: small models occasionally emit prose.
      const retry = await ctx.runModel({ mode, prompt: `${prompt}\n\nReturn ONLY valid JSON.`, schema });
      sources.add(retry.source);
      obj = parseModelJson(retry.text);
    }
    if (!obj) throw new Error('The model did not return valid JSON.');
    return schema === RESULT_SCHEMA ? sanitizeModelResult(obj, sourceText) : obj;
  };

  const runSingle = async (p) => {
    const cloudish = p.mode === MODE.ONLY_IN_CLOUD || p.mode === MODE.PREFER_IN_CLOUD;
    let body = clean;
    if (cloudish && body.length > limits.cloudMaxChars) {
      body = body.slice(0, limits.cloudMaxChars);
      notes.push(`Only the first ${Math.round(limits.cloudMaxChars / 1000)}k characters were analysed.`);
    }
    progress(p.mode === MODE.ONLY_IN_CLOUD ? 'Sending to Gemini in the cloud…' : 'Reading with Firebase AI Logic…');
    return callModel(p.mode, buildPrompt(body, { kind }), RESULT_SCHEMA, body);
  };

  const runChunked = async (p) => {
    let chunks = chunkText(clean, p.chunkChars);
    if (chunks.length > limits.maxChunks) {
      notes.push(`Very long document: the first ${limits.maxChunks} of ${chunks.length} parts were read by the AI; the rules scanned all of it.`);
      chunks = chunks.slice(0, limits.maxChunks);
    }
    const parts = [];
    for (let i = 0; i < chunks.length; i++) {
      progress(`Gemini Nano is reading part ${i + 1} of ${chunks.length} on this device…`);
      parts.push(await callModel(p.mode, buildPrompt(chunks[i], { kind, part: i + 1, parts: chunks.length }), RESULT_SCHEMA, chunks[i]));
    }
    const combined = combineChunkResults(parts);
    if (combined.tldrs.length > 1) {
      try {
        progress('Combining the parts…');
        const red = await callModel(p.mode, buildReducePrompt(combined.tldrs, kind), REDUCE_SCHEMA);
        if (typeof red.tldr === 'string' && red.tldr.trim()) combined.tldr = red.tldr.trim();
      } catch {
        /* keep the joined part summaries */
      }
    }
    return combined;
  };

  const execute = (p) => (p.strategy === 'chunked' ? runChunked(p) : runSingle(p));

  let ai;
  let reason = plan.reason;
  try {
    ai = await execute(plan);
  } catch (err) {
    if (plan.fallback) {
      notes.push(`Cloud step failed (${shortError(err)}).`);
      try {
        ai = await execute(plan.fallback);
        reason = plan.fallback.reason;
      } catch (err2) {
        notes.push(`On-device step failed too (${shortError(err2)}).`);
      }
    } else {
      notes.push(`AI step failed (${shortError(err)}).`);
    }
    if (!ai) return rulesOnly('The AI model was unavailable, so only the built-in rules ran.');
  }

  // Tell the truth about where inference actually happened.
  if (plan.mode === MODE.PREFER_ON_DEVICE && sources.has('in_cloud') && !sources.has('on_device')) {
    reason = 'Gemini Nano isn’t ready on this device, so Firebase AI Logic fell back to Gemini in the cloud.';
  } else if (plan.mode === MODE.PREFER_ON_DEVICE && sources.has('on_device')) {
    reason = 'Short document: read privately by Gemini Nano on this device. Nothing was sent to the cloud.';
  } else if (plan.mode === MODE.PREFER_IN_CLOUD && sources.has('on_device') && !sources.has('in_cloud')) {
    reason = 'The cloud was unreachable, so Firebase AI Logic fell back to Gemini Nano on this device.';
  }
  if (ai.dropped) notes.push(`${ai.dropped} AI finding${ai.dropped === 1 ? ' was' : 's were'} dropped because the quote wasn’t in the document.`);

  const risks = mergeRisks(ai.risks, ruleRisks);
  if (risks.some((r) => r.origin === 'rules')) sources.add('rules');
  const points = ai.points.length ? ai.points : risks.slice(0, 6).map((r) => `${r.label}: ${r.why}`);
  const tldr = ai.tldr || demoAnalyze(clean).tldr;
  return pack(tldr, points, risks, reason);
}

function shortError(err) {
  const m = String(err?.message || err || 'unknown error').replace(/\s+/g, ' ');
  return m.length > 90 ? m.slice(0, 89) + '…' : m;
}
