// Builds dist/extension (load unpacked in Chrome) and dist/web (Firebase Hosting).
// Firebase config comes from firebase.config.json (git-ignored). Without it the
// build still works and the app runs in demo mode.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const cfgPath = join(root, 'firebase.config.json');

let config = null;
if (existsSync(cfgPath)) {
  const c = JSON.parse(readFileSync(cfgPath, 'utf8'));
  if (c.apiKey && c.projectId && c.appId) config = c;
}
console.log(config ? `Firebase project: ${config.projectId}` : 'No firebase.config.json: building in demo mode.');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'extension'), { recursive: true });
mkdirSync(join(dist, 'web'), { recursive: true });

const common = {
  bundle: true,
  format: 'esm',
  target: 'chrome139',
  minify: true,
  sourcemap: true,
  legalComments: 'linked',
  logLevel: 'warning',
};

// The extension never uses reCAPTCHA (remote scripts are not allowed in MV3);
// it always uses the App Check debug provider, so strip the site key.
const extConfig = config ? { ...config, recaptchaSiteKey: '' } : null;

await build({
  ...common,
  entryPoints: [join(root, 'src/entry-extension.js')],
  outfile: join(dist, 'extension/sidepanel.js'),
  define: { __PT_CONFIG__: JSON.stringify(extConfig) },
});
await build({
  ...common,
  entryPoints: [join(root, 'src/entry-web.js')],
  outfile: join(dist, 'web/app.js'),
  define: { __PT_CONFIG__: JSON.stringify(config) },
});

for (const f of ['manifest.json', 'sidepanel.html', 'background.js', 'icons']) {
  cpSync(join(root, 'extension', f), join(dist, 'extension', f), { recursive: true });
}
cpSync(join(root, 'src/ui/styles.css'), join(dist, 'extension/styles.css'));
cpSync(join(root, 'src/ui/styles.css'), join(dist, 'web/styles.css'));
cpSync(join(root, 'extension/icons/128.png'), join(dist, 'web/icon.png'));

const repo = process.env.REPO_URL || JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).repository?.url || 'https://github.com/';
const html = readFileSync(join(root, 'web/index.html'), 'utf8').replace('href="https://github.com/"', `href="${repo}"`);
writeFileSync(join(dist, 'web/index.html'), html);
console.log('Built dist/extension and dist/web');
