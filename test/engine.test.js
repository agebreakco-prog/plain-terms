import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/core/engine.js';
import { createMockModel } from '../src/core/mock-model.js';
import { MODE, PRIVACY } from '../src/core/router.js';
import { STREAMING_TERMS, FITNESS_PRIVACY, COOKIE_BANNER } from '../samples/samples.js';

// Mirrors Firebase AI Logic: prefer_on_device runs on device when Nano is
// available, *_in_cloud runs in the cloud.
const hybrid = (nano = true) => (mode) =>
  mode === MODE.ONLY_ON_DEVICE || (mode === MODE.PREFER_ON_DEVICE && nano) ? 'on_device' : 'in_cloud';
const env = (o = {}) => ({ online: true, nano: 'available', firebaseReady: true, ...o });

test('short terms are read on-device in one call', async () => {
  const m = createMockModel(hybrid());
  const out = await analyzeDocument(STREAMING_TERMS, { settings: { privacy: PRIVACY.BALANCED }, env: env(), runModel: m.runModel });
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].mode, MODE.PREFER_ON_DEVICE);
  assert.deepEqual(out.sources.filter((s) => s !== 'rules'), ['on_device']);
  assert.match(out.reason, /on this device/);
  assert.ok(out.result.risks.length >= 6);
  assert.equal(out.result.kind, 'terms of service');
});

test('without Nano, prefer_on_device falls back to cloud and the reason says so', async () => {
  const m = createMockModel(hybrid(false));
  const out = await analyzeDocument(COOKIE_BANNER, { settings: {}, env: env({ nano: 'unavailable' }), runModel: m.runModel });
  assert.ok(out.sources.includes('in_cloud'));
  assert.match(out.reason, /fell back to Gemini in the cloud/);
});

test('long policy goes to the cloud in balanced mode', async () => {
  const m = createMockModel(hybrid());
  const out = await analyzeDocument(FITNESS_PRIVACY, { settings: { privacy: PRIVACY.BALANCED }, env: env(), runModel: m.runModel });
  assert.equal(m.calls[0].mode, MODE.ONLY_IN_CLOUD);
  assert.ok(out.sources.includes('in_cloud'));
});

test('long policy in private mode is chunked on-device and reduced', async () => {
  const m = createMockModel(hybrid());
  const progress = [];
  const out = await analyzeDocument(FITNESS_PRIVACY, {
    settings: { privacy: PRIVACY.PRIVATE },
    env: env(),
    runModel: m.runModel,
    onProgress: (p) => progress.push(p),
  });
  assert.ok(m.calls.length >= 3, 'chunks + reduce');
  assert.ok(m.calls.every((c) => c.mode === MODE.ONLY_ON_DEVICE));
  assert.ok(!out.sources.includes('in_cloud'));
  assert.ok(progress.some((p) => /part 2 of/.test(p)));
  assert.ok(out.result.tldr.length > 10);
});

test('cloud failure on a long doc falls back to on-device chunks', async () => {
  const m = createMockModel(hybrid(), { failModes: [MODE.ONLY_IN_CLOUD] });
  const out = await analyzeDocument(FITNESS_PRIVACY, { settings: {}, env: env(), runModel: m.runModel });
  assert.ok(out.sources.includes('on_device'));
  assert.match(out.reason, /Cloud was unreachable/);
  assert.ok(out.notes.some((n) => /Cloud step failed/.test(n)));
});

test('total AI failure degrades to rules-only, never throws', async () => {
  const runModel = async () => {
    throw new Error('quota exceeded');
  };
  const out = await analyzeDocument(STREAMING_TERMS, { settings: {}, env: env(), runModel });
  assert.deepEqual(out.sources, ['rules']);
  assert.ok(out.result.risks.length > 0);
  assert.ok(out.notes.some((n) => /quota exceeded/.test(n)));
});

test('invalid JSON is retried once, then rules-only', async () => {
  let n = 0;
  const runModel = async () => {
    n++;
    return { text: n === 1 ? 'I think it is fine.' : '{"tldr":"ok","points":["p"],"risks":[]}', source: 'on_device' };
  };
  const out = await analyzeDocument(COOKIE_BANNER, { settings: {}, env: env(), runModel });
  assert.equal(n, 2);
  assert.equal(out.result.tldr, 'ok');
  // Rule findings still appear even though the model returned none.
  assert.ok(out.result.risks.some((r) => r.origin === 'rules'));
});

test('demo mode makes no model calls', async () => {
  const m = createMockModel('on_device');
  const out = await analyzeDocument(COOKIE_BANNER, { settings: { demo: true }, env: env(), runModel: m.runModel });
  assert.equal(m.calls.length, 0);
  assert.deepEqual(out.sources, ['rules']);
});

test('empty input is rejected', async () => {
  await assert.rejects(analyzeDocument('   ', { settings: {}, env: env() }), /no text/);
});
