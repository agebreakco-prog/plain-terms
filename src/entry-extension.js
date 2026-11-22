// Chrome extension side panel entry point.
/* global chrome, __PT_CONFIG__ */
import { mountApp } from './ui/app.js';
import { extractPage, extractCookieBanner, extractSelection } from './extract.js';
import { createMockModel } from './core/mock-model.js';

const storage = {
  get: async (k) => (await chrome.storage.local.get(k))[k],
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
};

let pending = null;

async function runInTab(func) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || 'https:')) {
    throw new Error('Open a normal web page (http or https) first.');
  }
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func });
    return res?.result;
  } catch {
    // activeTab may have expired: ask for this site only, then retry.
    const origin = new URL(tab.url).origin + '/*';
    const ok = await chrome.permissions.request({ origins: [origin] });
    if (!ok) throw new Error('Plain Terms needs permission to read this page.');
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func });
    return res?.result;
  }
}

const sources = [
  { id: 'page', label: 'This page', load: () => runInTab(extractPage) },
  { id: 'cookie', label: 'Cookie banner', load: () => runInTab(extractCookieBanner) },
  {
    id: 'selection',
    label: 'Selection',
    load: async () => {
      if (pending) {
        const p = pending;
        pending = null;
        return p;
      }
      return runInTab(extractSelection);
    },
  },
];

const root = document.getElementById('app');
// Preview harness only (scripts/ext-preview.html): simulated model + fake Nano state.
const preview = globalThis.__PT_PREVIEW__;
const mockModel = preview ? createMockModel((mode) => (mode.includes('cloud') ? 'in_cloud' : 'on_device')).runModel : undefined;

mountApp(root, {
  kind: 'extension',
  firebaseConfig: __PT_CONFIG__,
  storage,
  sources,
  mockModel,
  fakeEnv: preview ? { nano: 'available' } : undefined,
}).then(() => {
  const consume = async () => {
    const { pendingSelection } = await chrome.storage.session.get('pendingSelection');
    if (!pendingSelection?.text) return;
    await chrome.storage.session.remove('pendingSelection');
    pending = pendingSelection;
    root.querySelector('[data-src="selection"]')?.click();
    root.querySelector('[data-ref="go"]')?.click();
  };
  consume();
  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes.pendingSelection?.newValue) consume();
  });
});
