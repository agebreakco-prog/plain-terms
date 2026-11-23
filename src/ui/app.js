// Shared UI for the Chrome side panel and the web app.

import { analyzeDocument, SOURCE_LABEL } from '../core/engine.js';
import { PRIVACY } from '../core/router.js';
import { createHybridClient, nanoStatus, isConfigured } from '../firebase/client.js';
import { CATEGORIES } from '../core/detector.js';
import { answerQuestion, SUGGESTED_QUESTIONS, VERDICT_TEXT } from '../core/ask.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const NANO_TEXT = {
  available: ['ok', 'Gemini Nano ready on this device'],
  downloadable: ['warn', 'Gemini Nano can be downloaded'],
  downloading: ['warn', 'Gemini Nano downloading…'],
  unavailable: ['off', 'No Gemini Nano here: cloud fallback'],
  unsupported: ['off', 'No on-device AI in this browser: cloud fallback'],
};

const PRIVACY_OPTIONS = [
  [PRIVACY.PRIVATE, 'On-device only', 'Never leaves this device'],
  [PRIVACY.BALANCED, 'Balanced', 'Device first, cloud for long texts'],
  [PRIVACY.CLOUD, 'Cloud first', 'Best quality, device as backup'],
];

/**
 * @param {HTMLElement} root
 * @param {object} host
 * @param {'extension'|'web'} host.kind
 * @param {object|null} host.firebaseConfig
 * @param {{get:(k:string)=>Promise<any>, set:(k:string,v:any)=>Promise<void>}} host.storage
 * @param {Array<{id:string,label:string,load:()=>Promise<{text:string,title?:string}>}>} host.sources
 * @param {boolean} [host.forceDemo]
 * @param {object} [host.fakeEnv] screenshot/demo override for env (nano, online)
 * @param {Function} [host.mockModel] simulated runModel (demo/screenshots); results are labelled simulated
 */
export async function mountApp(root, host) {
  const state = {
    privacy: (await host.storage.get('privacy')) || PRIVACY.BALANCED,
    demo: host.forceDemo || Boolean(await host.storage.get('demo')),
    nano: 'unsupported',
    limits: null,
    busy: false,
  };

  let debugToken = await host.storage.get('appCheckDebugToken');
  const configured = isConfigured(host.firebaseConfig);
  const needsDebug = configured && (host.kind === 'extension' || !host.firebaseConfig.recaptchaSiteKey);
  if (needsDebug && !debugToken) {
    debugToken = crypto.randomUUID();
    await host.storage.set('appCheckDebugToken', debugToken);
  }
  let client = null;
  try {
    client = configured ? createHybridClient(host.firebaseConfig, { debugToken: needsDebug ? debugToken : undefined }) : null;
  } catch (e) {
    console.warn('Firebase init failed, running in demo mode', e);
  }

  root.innerHTML = `
    <header class="pt-head">
      <div class="pt-brand"><span class="pt-logo" aria-hidden="true">¶</span><div><h1>Plain Terms</h1><p>Fine print, in plain words.</p></div></div>
      <span class="pt-pill" data-ref="nano"></span>
    </header>
    <section class="pt-input" data-ref="input"></section>
    <fieldset class="pt-privacy" data-ref="privacy"><legend>Where may the AI run?</legend></fieldset>
    <button class="pt-go" data-ref="go" type="button">Explain in plain terms</button>
    <p class="pt-progress" data-ref="progress" role="status" aria-live="polite"></p>
    <section class="pt-result" data-ref="result" aria-live="polite"></section>
    <details class="pt-settings"><summary>Settings and diagnostics</summary><div data-ref="settings"></div></details>
  `;
  const ref = (n) => root.querySelector(`[data-ref="${n}"]`);

  // Input area: source buttons (extension) or textarea + samples (web).
  let selectedSource = host.sources[0]?.id;
  const input = ref('input');
  if (host.kind === 'web') {
    input.innerHTML = `
      <label class="pt-label" for="pt-text">Paste terms, a privacy policy or a cookie banner</label>
      <textarea id="pt-text" rows="8" placeholder="Paste the fine print here…"></textarea>
      <div class="pt-samples">${host.sources.map((s) => `<button type="button" class="pt-chip" data-sample="${esc(s.id)}">${esc(s.label)}</button>`).join('')}</div>`;
    input.querySelectorAll('[data-sample]').forEach((b) =>
      b.addEventListener('click', async () => {
        const src = host.sources.find((s) => s.id === b.dataset.sample);
        input.querySelector('textarea').value = (await src.load()).text;
      }),
    );
  } else {
    input.innerHTML = `<div class="pt-seg" role="radiogroup" aria-label="What to explain">${host.sources
      .map((s, i) => `<button type="button" role="radio" aria-checked="${i === 0}" data-src="${esc(s.id)}">${esc(s.label)}</button>`)
      .join('')}</div>`;
    input.querySelectorAll('[data-src]').forEach((b) =>
      b.addEventListener('click', () => {
        selectedSource = b.dataset.src;
        input.querySelectorAll('[data-src]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      }),
    );
  }

  const privacyEl = ref('privacy');
  privacyEl.insertAdjacentHTML(
    'beforeend',
    PRIVACY_OPTIONS.map(
      ([v, l, d]) =>
        `<label class="pt-radio"><input type="radio" name="pt-privacy" value="${v}" ${v === state.privacy ? 'checked' : ''}><span><b>${l}</b><small>${d}</small></span></label>`,
    ).join(''),
  );
  privacyEl.addEventListener('change', (e) => {
    state.privacy = e.target.value;
    host.storage.set('privacy', state.privacy);
  });

  function renderNano(extra) {
    const pill = ref('nano');
    if (state.demo || (!client && !host.mockModel)) {
      pill.className = 'pt-pill pt-demo';
      pill.textContent = 'Demo mode: rules only';
      return;
    }
    const [cls, text] = NANO_TEXT[state.nano] || NANO_TEXT.unavailable;
    pill.className = `pt-pill pt-${cls}`;
    pill.textContent = extra || (host.mockModel ? `${text} (simulated)` : text);
  }

  function renderSettings() {
    ref('settings').innerHTML = `
      <label class="pt-check"><input type="checkbox" data-ref="demo" ${state.demo ? 'checked' : ''} ${host.forceDemo || !client ? 'disabled' : ''}> Demo mode (no AI calls, built-in rules only)</label>
      <dl class="pt-diag">
        <dt>Firebase</dt><dd>${client ? `connected to <code>${esc(host.firebaseConfig.projectId)}</code>` : 'not configured (see README)'}</dd>
        <dt>Gemini Nano</dt><dd><code>${esc(state.nano)}</code></dd>
        <dt>On-device window</dt><dd>${esc((state.limits?.onDeviceMaxChars ?? 12000).toLocaleString('en-US'))} characters${state.limits?.fromRemote ? ' (Remote Config)' : ''}</dd>
        <dt>Cloud model</dt><dd><code>${esc(state.limits?.cloudModel ?? 'gemini-3.5-flash-lite')}</code></dd>
        ${needsDebug ? `<dt>App Check debug token</dt><dd><code class="pt-token">${esc(debugToken)}</code><small>Register once in Firebase console → App Check → Apps → Manage debug tokens.</small></dd>` : ''}
      </dl>`;
    const demoBox = ref('settings').querySelector('[data-ref="demo"]');
    demoBox?.addEventListener('change', () => {
      state.demo = demoBox.checked;
      host.storage.set('demo', state.demo);
      renderNano();
    });
  }

  async function refreshEnv() {
    state.nano = host.fakeEnv?.nano ?? (await nanoStatus());
    renderNano();
    renderSettings();
  }

  await refreshEnv();
  if (client) {
    client
      .loadRemoteLimits()
      .then((l) => {
        state.limits = l;
        renderSettings();
      })
      .catch(() => {});
  }

  ref('go').addEventListener('click', async () => {
    if (state.busy) return;
    // initializeDeviceModel must run inside the click (user activation).
    if (client && !state.demo && state.nano !== 'unsupported' && state.nano !== 'unavailable') {
      client
        .warmUp((p) => renderNano(`Downloading Gemini Nano ${Math.round(p * 100)}%`))
        .then(refreshEnv)
        .catch(() => {});
    }
    state.busy = true;
    ref('go').disabled = true;
    ref('result').innerHTML = '';
    const progress = (m) => (ref('progress').textContent = m);
    try {
      let doc;
      if (host.kind === 'web') {
        doc = { text: input.querySelector('textarea').value, title: '' };
      } else {
        progress('Reading the page…');
        doc = await host.sources.find((s) => s.id === selectedSource).load();
      }
      if (!doc?.text?.trim()) throw new Error(doc?.empty || 'No text found. Try selecting the text first.');
      const runModel = host.mockModel || (client ? (req) => client.runModel(req) : undefined);
      const env = { online: host.fakeEnv?.online ?? navigator.onLine, nano: state.nano, firebaseReady: Boolean(runModel) };
      const out = await analyzeDocument(doc.text, {
        settings: { privacy: state.privacy, demo: state.demo },
        env,
        limits: state.limits || undefined,
        runModel,
        onProgress: progress,
      });
      renderResult(ref('result'), out, doc.title, Boolean(host.mockModel));
      mountAsk(ref('result'), { text: doc.text, kind: out.result.kind, runModel, env, simulated: Boolean(host.mockModel) });
      progress('');
    } catch (e) {
      progress('');
      ref('result').innerHTML = `<div class="pt-error">${esc(e.message || e)}</div>`;
    } finally {
      state.busy = false;
      ref('go').disabled = false;
    }
  });

  // "Ask the fine print": one question at a time about the document just explained.
  function mountAsk(el, docCtx) {
    const box = document.createElement('section');
    box.className = 'pt-card pt-ask';
    box.innerHTML = `
      <h3>Ask the fine print</h3>
      <form class="pt-ask-form"><input type="text" name="q" placeholder="e.g. Can I cancel any time?" aria-label="Your question" maxlength="200" autocomplete="off"><button type="submit">Ask</button></form>
      <div class="pt-samples">${SUGGESTED_QUESTIONS.map((q) => `<button type="button" class="pt-chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <div class="pt-answer" aria-live="polite"></div>`;
    el.appendChild(box);
    const form = box.querySelector('form');
    const field = form.querySelector('input');
    const out = box.querySelector('.pt-answer');
    let asking = false;
    const ask = async (q) => {
      if (asking) return;
      asking = true;
      form.querySelector('button').disabled = true;
      out.innerHTML = '<p class="pt-progress">Finding the relevant passages…</p>';
      try {
        const a = await answerQuestion(docCtx.text, q, {
          settings: { privacy: state.privacy, demo: state.demo },
          env: docCtx.env,
          limits: state.limits || undefined,
          runModel: docCtx.runModel,
          kind: docCtx.kind,
        });
        out.innerHTML = `
          <p class="pt-q">${esc(q)}</p>
          <p><span class="pt-verdict-chip pt-v-${esc(a.verdict)}">${esc(VERDICT_TEXT[a.verdict] || a.verdict)}</span> ${esc(a.answer)}</p>
          ${a.quote ? `<blockquote>“${esc(a.quote)}”</blockquote>` : ''}
          <div class="pt-where">${a.sources.map((s) => `<span class="pt-src pt-src-${esc(s)}">${esc(SOURCE_LABEL[s] || s)}${docCtx.simulated && s !== 'rules' ? ' \u00b7 simulated' : ''}</span>`).join('')}<span class="pt-ms">${(a.ms / 1000).toFixed(1)} s</span><p>${esc(a.reason)}</p></div>
          ${a.verdict === 'unclear' && a.passages.length > 1 ? `<details><summary>${a.passages.length} matching passages</summary><ul class="pt-notes">${a.passages.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}`;
      } catch (e) {
        out.innerHTML = `<div class="pt-error">${esc(e.message || e)}</div>`;
      } finally {
        asking = false;
        form.querySelector('button').disabled = false;
      }
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (field.value.trim()) ask(field.value.trim());
    });
    box.querySelectorAll('[data-q]').forEach((b) =>
      b.addEventListener('click', () => {
        field.value = b.dataset.q;
        ask(b.dataset.q);
      }),
    );
  }

  return { state, rerender: refreshEnv };
}

/** Plain-text version of a result, for the Copy button (paste into a chat or note). */
export function resultToText(out, title) {
  const { result } = out;
  const lines = [`Plain Terms: ${title ? `${title} (${result.kind})` : result.kind}`, `${result.scoreLabel} (${result.score}/100). ${result.tldr}`, ''];
  if (result.points.length) lines.push('In plain terms:', ...result.points.map((p) => `- ${p}`), '');
  if (result.risks.length) {
    lines.push('Watch out for:');
    for (const r of result.risks) {
      lines.push(`- [${r.severity}] ${r.label}: ${r.why}`, `  "${r.quote}"`);
      const tip = CATEGORIES[r.category]?.tip;
      if (tip) lines.push(`  What you can do: ${tip}`);
    }
    lines.push('');
  }
  lines.push('Explained by Plain Terms (not legal advice): https://plain-terms.web.app');
  return lines.join('\n');
}

export function renderResult(el, out, title, simulated = false) {
  const { result, reason, sources, notes, ms } = out;
  const tone = result.score >= 55 ? 'high' : result.score >= 25 ? 'medium' : 'low';
  const originText = { ai: 'Found by AI, quote verified', rules: 'Found by built-in rules', 'ai+rules': 'AI and rules agree' };
  el.innerHTML = `
    <div class="pt-card pt-summary">
      <div class="pt-score pt-${tone}" style="--v:${result.score}"><span>${result.score}</span></div>
      <div>
        <p class="pt-kind">${esc(title ? `${title} · ` : '')}${esc(result.kind)}</p>
        <h2 class="pt-verdict pt-${tone}-text">${esc(result.scoreLabel)}</h2>
        <p class="pt-tldr">${esc(result.tldr)}</p>
      </div>
    </div>
    <div class="pt-where">
      ${sources.map((s) => `<span class="pt-src pt-src-${esc(s)}">${esc(SOURCE_LABEL[s] || s)}${simulated && s !== 'rules' ? ' \u00b7 simulated' : ''}</span>`).join('')}
      <span class="pt-ms">${(ms / 1000).toFixed(1)} s</span>
      <button type="button" class="pt-chip pt-copy" data-ref="copy">Copy summary</button>
      <p>${esc(reason)}</p>
    </div>
    ${result.points.length ? `<h3>In plain terms</h3><ul class="pt-points">${result.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    <h3>Watch out for ${result.risks.length ? `<span class="pt-count">${result.risks.length}</span>` : ''}</h3>
    ${
      result.risks.length
        ? result.risks
            .map(
              (r) => `
      <article class="pt-risk pt-risk-${esc(r.severity)}">
        <header><span class="pt-sev">${esc(r.severity)}</span><b>${esc(r.label)}</b></header>
        <p>${esc(r.why)}</p>
        <blockquote>“${esc(r.quote)}”</blockquote>
        ${CATEGORIES[r.category]?.tip ? `<p class="pt-tip"><b>What you can do:</b> ${esc(CATEGORIES[r.category].tip)}</p>` : ''}
        <small>${esc(originText[r.origin] || '')}</small>
      </article>`,
            )
            .join('')
        : '<p class="pt-none">No common red flags found. Still worth a skim.</p>'
    }
    ${notes.length ? `<ul class="pt-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  `;
  const copy = el.querySelector('[data-ref="copy"]');
  copy?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(resultToText(out, title));
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Copy failed';
    }
    setTimeout(() => (copy.textContent = 'Copy summary'), 1600);
  });
}
