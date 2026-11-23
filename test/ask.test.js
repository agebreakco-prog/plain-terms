import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion, retrievePassages, queryTerms, buildAskPrompt } from '../src/core/ask.js';
import { createMockModel } from '../src/core/mock-model.js';
import { CATEGORIES } from '../src/core/detector.js';
import { MODE, PRIVACY } from '../src/core/router.js';
import { STREAMING_TERMS, FITNESS_PRIVACY } from '../samples/samples.js';

const hybrid = (nano = true) => (mode) =>
  mode === MODE.ONLY_ON_DEVICE || (mode === MODE.PREFER_ON_DEVICE && nano) ? 'on_device' : 'in_cloud';
const env = (o = {}) => ({ online: true, nano: 'available', firebaseReady: true, ...o });

test('query terms expand everyday words into legal wording', () => {
  const t = queryTerms('Can I sue them?');
  assert.ok(t.has('arbitration') || t.has('arbitr'));
  assert.ok(!t.has('can'));
});

test('retrieval finds the refund clause and stays small', () => {
  const p = retrievePassages(STREAMING_TERMS, 'Can I get a refund?');
  assert.ok(p.length > 0);
  assert.ok(p.some((s) => /non-refundable/i.test(s)));
  assert.ok(p.join('\n').length <= 3500);
});

test('a question about a long policy is answered on-device from a few passages', async () => {
  assert.ok(FITNESS_PRIVACY.length > 12000, 'sample should exceed the on-device window');
  const m = createMockModel(hybrid());
  const a = await answerQuestion(FITNESS_PRIVACY, 'Do they sell or share my data?', { settings: { privacy: PRIVACY.BALANCED }, env: env(), runModel: m.runModel });
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].mode, MODE.PREFER_ON_DEVICE);
  assert.ok(m.calls[0].chars < 5000);
  assert.deepEqual(a.sources, ['on_device']);
  assert.match(a.reason, /Nothing was sent to the cloud/);
  assert.ok(a.quote && FITNESS_PRIVACY.includes(a.quote.slice(0, 40)));
});

test('without Nano the question falls back to the cloud and says so', async () => {
  const m = createMockModel(hybrid(false));
  const a = await answerQuestion(STREAMING_TERMS, 'Can I cancel any time?', { settings: {}, env: env({ nano: 'unavailable' }), runModel: m.runModel });
  assert.deepEqual(a.sources, ['in_cloud']);
  assert.match(a.reason, /cloud/);
});

test('model failure degrades to showing the matching passages', async () => {
  const m = createMockModel(hybrid(), { failModes: [MODE.PREFER_ON_DEVICE] });
  const a = await answerQuestion(STREAMING_TERMS, 'Can I get a refund?', { settings: {}, env: env(), runModel: m.runModel });
  assert.equal(a.verdict, 'unclear');
  assert.deepEqual(a.sources, ['rules']);
  assert.ok(a.passages.length > 0);
});

test('demo mode answers from passages without calling a model', async () => {
  const a = await answerQuestion(STREAMING_TERMS, 'Can I cancel any time?', { settings: { demo: true }, env: env() });
  assert.deepEqual(a.sources, ['rules']);
  assert.ok(a.quote.length > 0);
});

test('a question the document does not cover needs no AI call', async () => {
  const m = createMockModel(hybrid());
  const a = await answerQuestion(STREAMING_TERMS, 'Zebra xylophone?', { settings: {}, env: env(), runModel: m.runModel });
  assert.equal(m.calls.length, 0);
  assert.equal(a.verdict, 'not_stated');
});

test('hallucinated quotes are removed from answers', async () => {
  const runModel = async () => ({ source: 'on_device', text: JSON.stringify({ verdict: 'yes', answer: 'Yes, anytime.', quote: 'You may cancel at any moment and get all your money back with a smile.' }) });
  const a = await answerQuestion(STREAMING_TERMS, 'Can I cancel any time?', { settings: {}, env: env(), runModel });
  assert.equal(a.quote, '');
  assert.equal(a.grounded, false);
});

test('private mode never routes a question to the cloud', async () => {
  const m = createMockModel(hybrid());
  await answerQuestion(FITNESS_PRIVACY, 'Is my data deleted when I leave?', { settings: { privacy: PRIVACY.PRIVATE }, env: env(), runModel: m.runModel });
  assert.ok(m.calls.every((c) => c.mode === MODE.ONLY_ON_DEVICE));
});

test('ask prompt keeps the question and only the passages', () => {
  const p = buildAskPrompt('Can I cancel?', ['A.', 'B.']);
  assert.match(p, /Question: Can I cancel\?/);
  assert.match(p, /<passages>\nA\.\nB\.\n<\/passages>/);
});

test('every risk category has a practical tip', () => {
  for (const [k, c] of Object.entries(CATEGORIES)) assert.ok(c.tip && c.tip.length > 20, k);
});
