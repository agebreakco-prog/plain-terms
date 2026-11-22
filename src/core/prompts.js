// Prompt and output schema shared by the on-device and cloud paths.
// The same JSON schema is passed to Gemini Nano (Prompt API responseConstraint)
// and to the cloud model (responseJsonSchema), so both return the same shape.

import { CATEGORIES } from './detector.js';

export const CATEGORY_KEYS = Object.keys(CATEGORIES);

export const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    tldr: { type: 'string', description: 'One or two plain sentences: what the user is agreeing to.' },
    points: {
      type: 'array',
      description: 'Up to 6 short plain-language bullet points, most important first.',
      items: { type: 'string' },
    },
    risks: {
      type: 'array',
      description: 'Clauses that could hurt the user.',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: [...CATEGORY_KEYS, 'other'] },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          quote: { type: 'string', description: 'Exact words copied from the document.' },
          why: { type: 'string', description: 'One plain sentence on why this matters to the user.' },
        },
        required: ['category', 'severity', 'quote', 'why'],
      },
    },
  },
  required: ['tldr', 'points', 'risks'],
};

const STYLE = [
  'You rewrite legal text for ordinary people.',
  'Write at a 12-year-old reading level. Use "you" and "they". No legal jargon.',
  'Be accurate: never invent terms that are not in the document.',
  'For each risk, copy the quote word for word from the document.',
  `Risk categories: ${CATEGORY_KEYS.join(', ')}, other.`,
  'Answer only with JSON matching the schema.',
].join(' ');

/** Prompt for analysing one document or one part of a document. */
export function buildPrompt(text, { kind = 'legal text', part, parts } = {}) {
  const scope = parts > 1 ? ` This is part ${part} of ${parts} of the ${kind}.` : '';
  return `${STYLE}\n\nDocument type: ${kind}.${scope}\n\n<document>\n${text}\n</document>`;
}

/** Prompt that merges several part-summaries into one TL;DR (map-reduce). */
export function buildReducePrompt(tldrs, kind = 'legal text') {
  const list = tldrs.map((t, i) => `${i + 1}. ${t}`).join('\n');
  return (
    `These are plain-language summaries of consecutive parts of one ${kind}.\n${list}\n\n` +
    'Write one plain summary of the whole document in at most two sentences. ' +
    'Answer only with JSON: {"tldr": "..."}'
  );
}

export const REDUCE_SCHEMA = {
  type: 'object',
  properties: { tldr: { type: 'string' } },
  required: ['tldr'],
};
