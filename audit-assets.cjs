const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const problems = [];
let checks = 0;
const ok = () => { checks++; };
const bad = (m) => { checks++; problems.push(m); };
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}
const files = [...walk(root)].map(f => path.relative(root, f)).filter(f => !f.includes('.git/'));
const has = (rel) => fs.existsSync(path.join(root, rel));

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
for (const size of Object.keys(manifest.icons || {})) has(manifest.icons[size]) ? ok() : bad(`manifest icon missing: ${manifest.icons[size]}`);
if (manifest.action?.default_popup) has(manifest.action.default_popup) ? ok() : bad(`action popup missing: ${manifest.action.default_popup}`);
for (const size of Object.keys(manifest.action?.default_icon || {})) has(manifest.action.default_icon[size]) ? ok() : bad(`action icon missing`);
if (manifest.options_ui?.page) has(manifest.options_ui.page) ? ok() : bad(`options page missing`);
if (manifest.background?.service_worker) has(manifest.background.service_worker) ? ok() : bad(`service worker missing`);

for (const f of files.filter(f => f.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(root, f), 'utf8');
  for (const r of [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1]).filter(u => !/^(https?:|#|data:|chrome|javascript:)/.test(u))) {
    has(path.normalize(path.join(path.dirname(f), r))) ? ok() : bad(`${f} references missing asset: ${r}`);
  }
}
for (const f of files.filter(f => f.endsWith('.js') && !f.includes('lucide'))) {
  const js = stripComments(fs.readFileSync(path.join(root, f), 'utf8'));
  for (const imp of [...js.matchAll(/import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map(m => m[1])) {
    has(path.normalize(path.join(path.dirname(f), imp))) ? ok() : bad(`${f} imports missing module: ${imp}`);
  }
  for (const m of js.matchAll(/getURL\(\s*['"]([^'"]+)['"]/g)) has(m[1]) ? ok() : bad(`${f} getURL target missing: ${m[1]}`);
  for (const m of js.matchAll(/files:\s*\[\s*['"]([^'"]+)['"]/g)) has(m[1]) ? ok() : bad(`${f} injects missing file: ${m[1]}`);
  if (/\bfetch\(|XMLHttpRequest|new WebSocket/.test(js)) bad(`${f} uses remote fetch/XHR/WebSocket`);
}

const themeJs = fs.readFileSync(path.join(root, 'js/theme.js'), 'utf8');
// 'default' and 'dark' are pre-catalogue themes kept as runtime fallbacks
// (theme.js loads themes/<id>.css dynamically for stored legacy selections).
const LEGACY_THEMES = new Set(['default', 'dark']);
const catalogued = new Set([...themeJs.matchAll(/\{\s*id:\s*'([^']+)'/g)].map(m => m[1]));
for (const t of files.filter(f => f.startsWith('themes/') && f.endsWith('.css')).map(f => path.basename(f, '.css'))) {
  (catalogued.has(t) || LEGACY_THEMES.has(t)) ? ok() : bad(`themes/${t}.css not catalogued in theme.js`);
}

for (const f of files.filter(f => f.endsWith('.css'))) {
  const css = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const u = m[1];
    if (/^(https?:|data:|#)/.test(u)) continue;
    has(path.normalize(path.join(path.dirname(f), u))) ? ok() : bad(`${f} css url() missing: ${u}`);
  }
}

console.log(`AUDIT ${root}: ${checks} checks, ${problems.length} problems`);
for (const p of problems) console.log('  PROBLEM: ' + p);
if (!problems.length) console.log('  CLEAN');
