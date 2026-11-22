// Web app entry point (hosted on Firebase Hosting, or opened locally).
/* global __PT_CONFIG__ */
import { mountApp } from './ui/app.js';
import { createMockModel } from './core/mock-model.js';
import { SAMPLES } from '../samples/samples.js';

const params = new URLSearchParams(location.search);
const storage = {
  get: async (k) => {
    try {
      const v = localStorage.getItem(`pt:${k}`);
      return v == null ? undefined : JSON.parse(v);
    } catch {
      return undefined;
    }
  },
  set: async (k, v) => {
    try {
      localStorage.setItem(`pt:${k}`, JSON.stringify(v));
    } catch {
      /* storage blocked: settings just won't persist */
    }
  },
};

// ?mock=device|cloud|auto runs the full pipeline with a simulated model
// (for offline demos and screenshots). ?nano=available|unavailable fakes the
// device check. ?demo=1 forces rules-only mode. ?theme=dark|light.
const mock = params.get('mock');
const fakeEnv = {};
if (params.get('nano')) fakeEnv.nano = params.get('nano');
if (params.get('offline') === '1') fakeEnv.online = false;
if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme');
const mockModel = mock
  ? createMockModel(mock === 'auto' ? (mode) => (mode.includes('cloud') || (mode === 'prefer_on_device' && (fakeEnv.nano ?? 'available') !== 'available') ? 'in_cloud' : 'on_device') : mock === 'cloud' ? 'in_cloud' : 'on_device', { latencyMs: 300 }).runModel
  : undefined;

const root = document.getElementById('app');
const sources = SAMPLES.map((s) => ({ id: s.id, label: s.label, load: async () => ({ text: s.text, title: '' }) }));
mountApp(root, {
  kind: 'web',
  firebaseConfig: __PT_CONFIG__,
  storage: mock || params.get('demo') ? { get: async () => undefined, set: async () => {} } : storage,
  sources,
  forceDemo: params.get('demo') === '1',
  fakeEnv: Object.keys(fakeEnv).length ? fakeEnv : undefined,
  mockModel,
}).then(() => {
  // ?sample=terms&run=1 preloads a sample and runs it (used for screenshots).
  const sample = SAMPLES.find((s) => s.id === params.get('sample'));
  if (sample) root.querySelector('textarea').value = sample.text;
  const privacy = params.get('privacy');
  if (privacy) root.querySelector(`input[name="pt-privacy"][value="${privacy}"]`)?.click();
  if (params.get('run') === '1') root.querySelector('[data-ref="go"]').click();
  if (params.get('settings') === '1') root.querySelector('details.pt-settings').open = true;
});
