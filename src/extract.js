// Page extractors. Each function is serialised and injected into the active tab
// with chrome.scripting.executeScript, so it must be self-contained (no imports,
// no closures over module scope).

export function extractPage() {
  const pick =
    document.querySelector('main article') ||
    document.querySelector('article') ||
    document.querySelector('main') ||
    document.querySelector('[role="main"]') ||
    document.body;
  const text = (pick?.innerText || '').slice(0, 300000);
  return { text, title: document.title };
}

export function extractCookieBanner() {
  const hint = /cookie|consent|gdpr|ccpa|cmp|onetrust|didomi|truste|usercentrics|quantcast|privacy[-_]?banner/i;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 120 && r.height > 30 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const candidates = new Set();
  document.querySelectorAll('[id],[class],[aria-label],[role="dialog"],[role="alertdialog"]').forEach((el) => {
    const label = `${el.id} ${typeof el.className === 'string' ? el.className : ''} ${el.getAttribute('aria-label') || ''}`;
    if (hint.test(label) || ((el.getAttribute('role') || '').includes('dialog') && /cookie/i.test(el.innerText || ''))) {
      candidates.add(el);
    }
  });
  let best = null;
  let bestScore = 0;
  for (const el of candidates) {
    if (!visible(el)) continue;
    const t = (el.innerText || '').trim();
    if (t.length < 40 || t.length > 8000) continue;
    const score = (t.match(/cookie|consent|partner|track|advertis|personal data/gi) || []).length * 100 + Math.min(t.length, 2000) / 100;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best
    ? { text: best, title: document.title }
    : { text: '', title: document.title, empty: 'No visible cookie banner found on this page.' };
}

export function extractSelection() {
  const text = String(window.getSelection?.() || '').trim();
  return text
    ? { text, title: document.title }
    : { text: '', title: document.title, empty: 'Select some text on the page first.' };
}
