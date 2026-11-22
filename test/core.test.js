import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, splitSentences, chunkText } from '../src/core/segment.js';
import { detectRisks, scoreRisks, classifyDocument } from '../src/core/detector.js';
import { planAnalysis, MODE, PRIVACY } from '../src/core/router.js';
import { parseModelJson, isGrounded, sanitizeModelResult, mergeRisks } from '../src/core/merge.js';
import { COOKIE_BANNER, STREAMING_TERMS, FITNESS_PRIVACY } from '../samples/samples.js';

test('normalize collapses whitespace but keeps paragraphs', () => {
  assert.equal(normalize('a  b\r\n\r\n\r\n\tc'), 'a b\n\nc');
});

test('splitSentences respects abbreviations', () => {
  const s = splitSentences('We share data, e.g. emails. You agree. Done!');
  assert.deepEqual(s, ['We share data, e.g. emails.', 'You agree.', 'Done!']);
});

test('chunkText keeps every chunk under the limit and loses no words', () => {
  const chunks = chunkText(FITNESS_PRIVACY, 2000);
  assert.ok(chunks.length > 5);
  for (const c of chunks) assert.ok(c.length <= 2000);
  const words = (t) => t.split(/\s+/).filter(Boolean).length;
  assert.equal(words(chunks.join(' ')), words(normalize(FITNESS_PRIVACY)));
});

test('detector finds the expected clauses in the sample terms', () => {
  const cats = detectRisks(STREAMING_TERMS).map((r) => r.category);
  for (const c of ['auto_renew', 'arbitration', 'content_license', 'data_sale', 'unilateral_changes', 'fees']) {
    assert.ok(cats.includes(c), `missing ${c}`);
  }
});

test('detector does not flag a benign text', () => {
  const benign = 'You can cancel any time from your account page. We only use essential cookies to keep you signed in. We never sell your data.';
  const cats = detectRisks(benign).map((r) => r.category);
  assert.ok(!cats.includes('data_sale'), cats.join());
  assert.ok(!cats.includes('auto_renew'));
  assert.equal(scoreRisks(detectRisks(benign)).label, 'Low concern');
});

test('classifyDocument', () => {
  assert.equal(classifyDocument(COOKIE_BANNER), 'cookie banner');
  assert.equal(classifyDocument(STREAMING_TERMS), 'terms of service');
  assert.equal(classifyDocument(FITNESS_PRIVACY), 'privacy policy');
});

const base = { online: true, nano: 'available', firebaseReady: true };

test('router: short doc, balanced -> prefer on-device', () => {
  const p = planAnalysis({ ...base, chars: 3000, privacy: PRIVACY.BALANCED });
  assert.equal(p.mode, MODE.PREFER_ON_DEVICE);
  assert.equal(p.strategy, 'single');
});

test('router: long doc, balanced -> cloud, with on-device chunked fallback', () => {
  const p = planAnalysis({ ...base, chars: 40000, privacy: PRIVACY.BALANCED });
  assert.equal(p.mode, MODE.ONLY_IN_CLOUD);
  assert.equal(p.fallback.mode, MODE.ONLY_ON_DEVICE);
  assert.equal(p.fallback.strategy, 'chunked');
});

test('router: private mode never uses the cloud', () => {
  for (const chars of [500, 50000]) {
    const p = planAnalysis({ ...base, chars, privacy: PRIVACY.PRIVATE });
    assert.equal(p.mode, MODE.ONLY_ON_DEVICE);
  }
  const none = planAnalysis({ ...base, nano: 'unavailable', chars: 500, privacy: PRIVACY.PRIVATE });
  assert.equal(none.engine, 'rules');
});

test('router: offline behaves like private', () => {
  const p = planAnalysis({ ...base, online: false, chars: 50000, privacy: PRIVACY.CLOUD });
  assert.equal(p.mode, MODE.ONLY_ON_DEVICE);
  assert.equal(p.strategy, 'chunked');
});

test('router: cloud-first and Remote Config limit override', () => {
  assert.equal(planAnalysis({ ...base, chars: 100, privacy: PRIVACY.CLOUD }).mode, MODE.PREFER_IN_CLOUD);
  const p = planAnalysis({ ...base, chars: 20000, privacy: PRIVACY.BALANCED, limits: { onDeviceMaxChars: 30000 } });
  assert.equal(p.mode, MODE.PREFER_ON_DEVICE);
});

test('router: no firebase -> demo', () => {
  assert.equal(planAnalysis({ ...base, firebaseReady: false, chars: 10 }).engine, 'demo');
});

test('parseModelJson tolerates fences and prose', () => {
  assert.deepEqual(parseModelJson('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(parseModelJson('no json here'), null);
});

test('grounding rejects invented quotes and accepts light edits', () => {
  const src = 'Your membership will automatically renew at the end of each billing period until you cancel.';
  assert.ok(isGrounded('Your membership will automatically renew at the end of each billing period', src));
  assert.ok(isGrounded('your membership will automatically renew, at the end of each billing period...', src));
  assert.ok(!isGrounded('We will sell your browsing history to insurers', src));
});

test('sanitizeModelResult drops hallucinated risks and fixes bad fields', () => {
  const out = sanitizeModelResult(
    {
      tldr: ' Short. ',
      points: ['a', '', 3],
      risks: [
        { category: 'auto_renew', severity: 'HIGH?', quote: 'Your Brightloop membership will automatically renew', why: '' },
        { category: 'data_sale', severity: 'high', quote: 'We sell your DNA to the moon', why: 'x' },
        { category: 'made_up', severity: 'low', quote: 'Free trials convert to a paid membership unless you cancel', why: 'y' },
      ],
    },
    STREAMING_TERMS,
  );
  assert.equal(out.tldr, 'Short.');
  assert.deepEqual(out.points, ['a']);
  assert.equal(out.risks.length, 2);
  assert.equal(out.dropped, 1);
  assert.equal(out.risks[0].severity, 'high');
  assert.equal(out.risks[1].category, 'other');
});

test('mergeRisks dedupes AI and rule findings and sorts by severity', () => {
  const rules = detectRisks(STREAMING_TERMS);
  const ai = [{ category: 'auto_renew', severity: 'high', quote: 'automatically renew', why: 'w', origin: 'ai' }];
  const merged = mergeRisks(ai, rules);
  assert.equal(merged.filter((r) => r.category === 'auto_renew').length, 1);
  assert.equal(merged.find((r) => r.category === 'auto_renew').origin, 'ai+rules');
  assert.equal(merged[merged.length - 1].severity, 'low');
});
