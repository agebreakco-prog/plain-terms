// Guards the contest requirements that live in code: Firebase AI Logic must be
// imported AND called at runtime, App Check must be initialised, and no
// secrets may be committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('Firebase AI Logic hybrid SDK is imported and called', () => {
  const src = read('src/firebase/client.js');
  assert.match(src, /from 'firebase\/ai'/);
  assert.match(src, /getGenerativeModel\(ai, \{\s*mode,/);
  assert.match(src, /\.generateContent\(prompt\)/);
  assert.match(src, /initializeDeviceModel\(/);
  assert.match(src, /inferenceSource/);
});

test('App Check and Remote Config are initialised', () => {
  const src = read('src/firebase/client.js');
  assert.match(src, /initializeAppCheck\(app/);
  assert.match(src, /fetchAndActivate\(rc\)/);
});

test('UI wires the Firebase client into the engine', () => {
  const src = read('src/ui/app.js');
  assert.match(src, /createHybridClient\(/);
  assert.match(src, /client\.runModel\(req\)/);
  assert.match(src, /client\s*\n?\s*\.warmUp\(/);
});

test('manifest is valid MV3 with minimal permissions', () => {
  const m = JSON.parse(read('extension/manifest.json'));
  assert.equal(m.manifest_version, 3);
  assert.ok(!m.host_permissions, 'no blanket host permissions');
  assert.ok(m.permissions.includes('sidePanel'));
});

test('no Firebase config or tokens are committed', () => {
  const ex = JSON.parse(read('firebase.config.example.json'));
  assert.equal(ex.apiKey, '');
  assert.match(read('.gitignore'), /firebase\.config\.json/);
  for (const f of ['src/firebase/client.js', 'src/ui/app.js', 'src/entry-extension.js', 'src/entry-web.js']) {
    assert.doesNotMatch(read(f), /AIza[0-9A-Za-z_-]{20,}/, f);
    assert.doesNotMatch(read(f), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, f);
  }
  assert.ok(existsSync(new URL('../LICENSE', import.meta.url)), 'LICENSE file');
});
