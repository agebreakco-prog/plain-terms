// Demo engine: produces a complete, honest result with no AI model at all,
// built only from the rule detector. Used when Firebase isn't configured,
// for screenshots, and as the last-resort fallback. The UI labels it clearly.

import { detectRisks, classifyDocument } from './detector.js';

const KIND_TLDR = {
  'cookie banner': 'This banner asks to put cookies and similar trackers on your device.',
  'privacy policy': 'This policy explains what personal data the company collects and who gets it.',
  'terms of service': 'These are the rules you agree to by using the service.',
  'cookie policy': 'This policy explains which cookies and trackers the site uses.',
  'legal text': 'This is a legal text that sets out your rights and obligations.',
};

export function demoAnalyze(text) {
  const kind = classifyDocument(text);
  const risks = detectRisks(text);
  const high = risks.filter((r) => r.severity === 'high').length;
  const tail = risks.length
    ? ` The built-in rules found ${risks.length} clause${risks.length === 1 ? '' : 's'} worth reading${high ? `, ${high} of them serious` : ''}.`
    : ' The built-in rules found no common red flags.';
  const points = risks.slice(0, 6).map((r) => `${r.label}: ${r.why}`);
  return { kind, tldr: KIND_TLDR[kind] + tail, points, risks };
}
