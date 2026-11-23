// Simulated model for offline demos, screenshots and tests. It mimics the
// runModel contract (JSON text + inferenceSource) without any network or AI,
// so the full hybrid pipeline (routing, chunking, grounding, merge) can be
// exercised anywhere. The UI marks results produced this way as "simulated".

import { demoAnalyze } from './demo.js';
import { detectRisks } from './detector.js';

const PLAIN = {
  data_sale: 'They can sell or pass your personal details to advertisers.',
  auto_renew: 'Your plan renews and charges you automatically until you cancel.',
  arbitration: 'You cannot take them to court or join a class action; a private arbitrator decides.',
  content_license: 'They may reuse anything you upload, forever, without paying you.',
  unilateral_changes: 'They can change these rules whenever they like; using the service means you accept.',
  tracking: 'Ad cookies and trackers follow what you do across other sites.',
  sensitive_data: 'They collect sensitive data such as your exact location or biometrics.',
  data_retention: 'They may keep your data even after you delete your account.',
  termination: 'They can close your account at any time, for any reason.',
  fees: 'Payments are non-refundable and cancelling early may cost extra.',
  liability: 'If the service fails or loses your data, they owe you very little.',
};

/**
 * @param {'on_device'|'in_cloud'|((mode:string)=>string)} source which source to report
 * @param {{latencyMs?:number, failModes?:string[]}} [opts]
 */
export function createMockModel(source = 'on_device', opts = {}) {
  const calls = [];
  const runModel = async ({ mode, prompt }) => {
    calls.push({ mode, chars: prompt.length });
    if (opts.failModes?.includes(mode)) {
      const e = new Error(`simulated failure for ${mode}`);
      throw e;
    }
    if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
    const src = typeof source === 'function' ? source(mode) : source;
    const ask = /Question: (.*)\n\n<passages>\n([\s\S]*)\n<\/passages>/.exec(prompt);
    if (ask) return { source: src, text: JSON.stringify(mockAnswer(ask[1], ask[2].split('\n'))) };
    const doc = /<document>\n([\s\S]*)\n<\/document>/.exec(prompt);
    if (!doc) {
      return { source: src, text: JSON.stringify({ tldr: 'Overall: you give up several rights and your data is widely shared. Read the flagged parts before agreeing.' }) };
    }
    const d = demoAnalyze(doc[1]);
    const risks = d.risks.map((r) => ({ category: r.category, severity: r.severity, quote: r.quote.replace(/…$/, ''), why: PLAIN[r.category] || r.why }));
    const tldr = risks.length
      ? `You agree to ${risks.length} things worth knowing, most importantly: ${PLAIN[risks[0].category].replace(/\.$/, '').toLowerCase()}.`
      : 'Nothing unusual: standard rules for using the service.';
    const points = [
      ...risks.slice(0, 5).map((r) => PLAIN[r.category]),
      'You can stop using the service at any time.',
    ];
    return { source: src, text: '```json\n' + JSON.stringify({ tldr, points, risks }) + '\n```' };
  };
  return { runModel, calls };
}

// Simulated answer for "Ask the fine print": cites the first passage; says "yes"
// (with a warning) when a risky clause on the topic exists, else "depends".
function mockAnswer(question, passages) {
  const quote = passages[0] || '';
  const risk = detectRisks(passages.join('\n'))[0];
  if (!quote) return { verdict: 'not_stated', answer: 'The document does not say.', quote: '' };
  return {
    verdict: risk ? 'yes' : 'depends',
    answer: risk ? `Watch out: ${PLAIN[risk.category] || risk.why}` : 'The document addresses this in the passage below.',
    quote: risk ? risk.quote.replace(/…$/, '') : quote,
  };
}
