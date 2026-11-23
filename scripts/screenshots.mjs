// Renders docs/ screenshots and extension icons with headless Chrome.
// Serves dist/web over a local HTTP server and drives Chrome's --screenshot.
// Set CHROME to a Chrome/Chromium binary (on WSL the Windows chrome.exe works).
//
//   CHROME="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" npm run screenshots
//   node scripts/screenshots.mjs icons
import { createServer } from 'node:http';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
import { existsSync, mkdirSync, readFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const isWinChrome = CHROME.endsWith('.exe');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json' };

// Windows Chrome cannot write into the WSL filesystem by Linux path; use its temp dir.
function scratch() {
  if (!isWinChrome) return { dir: mkdtempSync(join(tmpdir(), 'pt-shot-')), win: null };
  const win = execFileSync('cmd.exe', ['/c', 'echo %TEMP%'], { cwd: '/mnt/c' }).toString().trim() + '\\plainterms-shots';
  const dir = execFileSync('wslpath', [win.replace(/\\plainterms-shots$/, '')]).toString().trim() + '/plainterms-shots';
  mkdirSync(dir, { recursive: true });
  return { dir, win };
}
const tmp = scratch();
const outPath = (name) => (tmp.win ? `${tmp.win}\\${name}` : join(tmp.dir, name));

// Async on purpose: the HTTP server below lives in this same process.
async function shot(url, name, w, h, extra = []) {
  const r = await run(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      `--user-data-dir=${outPath('profile-' + name.replace(/\W/g, ''))}`,
      `--window-size=${w},${h}`,
      '--virtual-time-budget=8000',
      ...(name.startsWith('icon') ? [] : ['--force-device-scale-factor=2']),
      `--screenshot=${outPath(name)}`,
      ...extra,
      url,
    ],
    { cwd: isWinChrome ? '/mnt/c' : root, timeout: 90000 },
  );
  if (!existsSync(join(tmp.dir, name))) console.error(r.stdout, r.stderr);
  return join(tmp.dir, name);
}

const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let file;
  if (u.pathname.startsWith('/ext/')) file = join(root, 'dist/extension', u.pathname.slice(5));
  else if (u.pathname.startsWith('/preview/')) file = join(root, 'scripts/preview', u.pathname.slice(9) || 'index.html');
  else file = join(root, 'dist/web', decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://localhost:${server.address().port}`;

try {
  if (process.argv[2] === 'icons') {
    mkdirSync(join(root, 'extension/icons'), { recursive: true });
    for (const s of [16, 48, 128]) {
      const page = `data:text/html,${encodeURIComponent(`<html><body style="margin:0;background:transparent">${readFileSync(join(root, 'scripts/icon.svg'), 'utf8').replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`)}`;
      copyFileSync(await shot(page, `icon${s}.png`, s, s, ['--default-background-color=00000000']), join(root, `extension/icons/${s}.png`));
    }
    console.log('icons written');
  } else {
    mkdirSync(join(root, 'docs'), { recursive: true });
    const shots = [
      ['00-extension-cookie-banner.png', '/preview/index.html', 1280, 860],
      ['01-terms-on-device.png', '?mock=auto&nano=available&sample=terms&run=1', 520, 1500],
      ['02-cookie-banner.png', '?mock=auto&nano=available&sample=cookie&run=1', 520, 1150],
      ['03-long-policy-cloud.png', '?mock=auto&nano=available&sample=privacy&run=1', 520, 1250],
      ['04-private-mode-chunked.png', '?mock=auto&nano=available&sample=privacy&privacy=private&run=1', 520, 1250],
      ['05-no-nano-fallback.png', '?mock=auto&nano=unavailable&sample=terms&run=1&theme=dark', 520, 1500],
      ['06-desktop-web.png', '?mock=auto&nano=available&sample=terms&run=1', 1280, 1400],
      ['07-demo-rules-only.png', '?demo=1&sample=cookie&run=1&settings=1', 520, 1150],
      ['08-ask-long-policy-on-device.png', `?mock=auto&nano=available&sample=privacy&run=1&focus=ask&ask=${encodeURIComponent('Do they sell or share my data?')}`, 520, 1150],
    ];
    for (const [name, q, w, h] of shots) {
      copyFileSync(await shot(q.startsWith('/') ? `${origin}${q}` : `${origin}/${q}`, name, w, h), join(root, 'docs', name));
      console.log('docs/' + name);
    }
  }
} finally {
  server.close();
}
