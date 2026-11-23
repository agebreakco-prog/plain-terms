// Deterministic risky-clause detector.
//
// This is the "always available" layer: it needs no model at all, runs in
// microseconds, and is used to (a) give an instant first answer, (b) catch
// clauses a small on-device model misses, and (c) keep working when neither
// Gemini Nano nor the cloud is reachable.

import { splitSentences } from './segment.js';

export const CATEGORIES = {
  data_sale: {
    label: 'Sells or shares your data',
    severity: 'high',
    why: 'Your personal information can be sold or handed to advertisers or other companies.',
    tip: "Look for a 'Do not sell or share my personal information' link or opt-out, and turn off ad personalisation in your account settings.",
  },
  auto_renew: {
    label: 'Auto-renewal',
    severity: 'high',
    why: 'You will keep being charged until you actively cancel.',
    tip: "Put a reminder in your calendar a few days before the renewal date, and check how to cancel before you pay.",
  },
  arbitration: {
    label: 'Forced arbitration',
    severity: 'high',
    why: 'You give up the right to sue in court or join a class action. Disputes go to a private arbitrator.',
    tip: "Check for an arbitration opt-out (often 30 days after sign-up, by email or letter) and use it if you may ever need to sue.",
  },
  content_license: {
    label: 'Broad licence to your content',
    severity: 'medium',
    why: 'The company can reuse what you upload, often forever and without paying you.',
    tip: "Don't upload anything you'd mind them reusing, such as personal photos or work you want to sell.",
  },
  unilateral_changes: {
    label: 'Can change terms any time',
    severity: 'medium',
    why: 'The rules can change without you agreeing again. Continuing to use the service counts as accepting.',
    tip: "Keep a copy of the version you agreed to, and skim the change emails they send.",
  },
  tracking: {
    label: 'Tracking and ad cookies',
    severity: 'medium',
    why: 'Your activity may be tracked across sites or devices for advertising.',
    tip: "Choose 'Reject non-essential' or turn off ad partners in Manage preferences. It only takes a click.",
  },
  sensitive_data: {
    label: 'Sensitive data collected',
    severity: 'high',
    why: 'Collects especially sensitive data such as precise location, biometrics, health data or contacts.',
    tip: "Deny optional permissions (precise location, contacts, health data) in your phone or browser settings.",
  },
  data_retention: {
    label: 'Keeps data after you leave',
    severity: 'medium',
    why: 'Your data may be kept for a long time, even after you delete your account.',
    tip: "Ask for deletion before you close your account. In the EU and UK you can make a data-erasure request.",
  },
  termination: {
    label: 'Can cut you off any time',
    severity: 'low',
    why: 'Your account can be suspended or closed at the company’s discretion.',
    tip: "Keep your own copies of anything important you store with them.",
  },
  fees: {
    label: 'Fees or no refunds',
    severity: 'medium',
    why: 'Payments may be non-refundable or come with cancellation fees.',
    tip: "Check the cancellation and refund rules before you pay. Prefer monthly plans when you're unsure.",
  },
  liability: {
    label: 'Limits their liability',
    severity: 'low',
    why: 'If something goes wrong, the company limits what it owes you.',
    tip: "Don't rely on this service as your only copy of anything that matters.",
  },
};

// Patterns are deliberately conservative: precision matters more than recall
// here, because the AI layer handles nuance and this layer must not cry wolf.
const RULES = [
  ['data_sale', /\b(sell|sold|sale of|rent|trade)\b[^.]{0,80}\b(personal (data|information)|your (data|information)|information about you)/i],
  ['data_sale', /\b(share|disclose|transfer)\b[^.]{0,80}\b(with|to)\b[^.]{0,40}\b(advertis\w*|marketing partners|data brokers|third[- ]part(y|ies) for (their own )?(marketing|advertising))/i],
  ['data_sale', /\b(personal (data|information)|your (data|information))\b[^.]{0,80}\b(sold|sell|rented)\b/i],
  ['auto_renew', /\b(automatic(ally)?[- ]renew\w*|auto[- ]renew\w*|renews? automatically|recurring (charge|billing|payment)s?|until you cancel|continuous(ly)? (billed|subscription))\b/i],
  ['arbitration', /\b(binding arbitration|arbitrat(ion|or)\b[^.]{0,60}\b(final|binding|exclusive)|waive\w*[^.]{0,60}\b(jury|class action|class-action|right to (a )?trial)|class action waiver|on an individual basis)\b/i],
  ['content_license', /\b(perpetual|irrevocable|worldwide|royalty[- ]free|sublicensable|transferable)\b[^.]{0,120}\blicen[cs]e\b/i],
  ['content_license', /\blicen[cs]e\b[^.]{0,80}\b(perpetual|irrevocable|royalty[- ]free|sublicensable)\b/i],
  ['unilateral_changes', /\b(may|reserve the right to|can)\b[^.]{0,30}\b(modify|change|update|amend|revise)\b[^.]{0,60}\b(at any time|from time to time|without (prior )?notice|in our sole discretion)\b/i],
  ['unilateral_changes', /\bcontinued use\b[^.]{0,80}\b(accept|agree|constitutes)\w*/i],
  ['tracking', /\b(cookies?|pixels?|web beacons?|trackers?|sdks?)\b[^.]{0,100}\b(advertis\w*|marketing|third[- ]part(y|ies)|cross[- ](site|device)|personali[sz]ed ads|profil\w*)\b/i],
  ['tracking', /\b(track\w*|follow)\b[^.]{0,40}\bacross\b[^.]{0,40}\b(sites|websites|apps|devices|the internet)\b/i],
  ['tracking', /\bfingerprint\w*\b/i],
  ['sensitive_data', /\b(precise (geo)?location|gps location|biometric\w*|face ?print|voice ?print|health (data|information)|contact list|address book)\b/i],
  ['data_retention', /\b(retain|keep|store)\w*\b[^.]{0,80}\b(indefinitely|as long as (we|necessary|needed)|after (you )?(delete|close|terminate)|even after)\b/i],
  ['termination', /\b(suspend|terminate|disable|close)\b[^.]{0,80}\b(at any time|for any reason|without (prior )?notice|in our sole discretion)\b/i],
  ['fees', /\b(non[- ]?refundable|no refunds?|early (termination|cancellation) fee|cancellation fee)\b/i],
  ['liability', /\b(limitation of liability|not (be )?liable for|in no event shall|provided ["“]?as is["”]?|without warrant(y|ies) of any kind)\b/i],
];

const SEVERITY_WEIGHT = { high: 3, medium: 2, low: 1 };

/** Trim a quote to a readable length around the matched clause. */
function clip(sentence, max = 280) {
  if (sentence.length <= max) return sentence;
  return sentence.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

/**
 * Scan text and return one finding per category (the first, clearest match),
 * in document order. Each finding: { category, label, severity, quote, why, origin }.
 */
export function detectRisks(text) {
  const found = new Map();
  const sentences = splitSentences(text);
  sentences.forEach((sentence, idx) => {
    if (sentence.length < 40) return; // headings like "Limitation of liability" are not clauses
    for (const [category, re] of RULES) {
      if (found.has(category)) continue;
      if (re.test(sentence)) {
        const meta = CATEGORIES[category];
        found.set(category, {
          category,
          label: meta.label,
          severity: meta.severity,
          quote: clip(sentence),
          why: meta.why,
          origin: 'rules',
          position: idx,
        });
      }
    }
  });
  return [...found.values()].sort((a, b) => a.position - b.position);
}

/** Overall concern score 0-100 plus a human label. */
export function scoreRisks(risks) {
  const raw = risks.reduce((sum, r) => sum + (SEVERITY_WEIGHT[r.severity] ?? 1), 0);
  const score = Math.min(100, Math.round((raw / 18) * 100));
  const label = score >= 55 ? 'High concern' : score >= 25 ? 'Read carefully' : 'Low concern';
  return { score, label };
}

/** Guess what kind of document this is, for prompts and UI copy. */
export function classifyDocument(text) {
  const all = String(text ?? '').toLowerCase();
  if (all.length < 3000 && /\b(cookies?|consent|accept all|manage preferences)\b/.test(all)) return 'cookie banner';
  const tests = [
    ['terms of service', /\b(terms of (service|use)|terms and conditions|user agreement|end user licen[cs]e)\b/],
    ['privacy policy', /\bprivacy (policy|notice|statement)\b/],
    ['cookie policy', /\bcookie (policy|notice)\b/],
  ];
  // The title (first lines) wins; otherwise the earliest mention in the text.
  const head = all.slice(0, 200);
  for (const [kind, re] of tests) if (re.test(head)) return kind;
  let best = ['legal text', Infinity];
  for (const [kind, re] of tests) {
    const i = all.slice(0, 6000).search(re);
    if (i >= 0 && i < best[1]) best = [kind, i];
  }
  return best[0];
}
