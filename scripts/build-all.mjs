import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, publicDir, readJson, atomicJson, sha256, checkManifest, appendLog } from './release.mjs';
import { buildFixtures } from './build-fixtures.mjs';
import ts from 'typescript';
import semver from 'semver';
import { prepareSharedAssets } from './shared-assets.mjs';

const staticMode = process.argv.includes('--vercel') || Boolean(process.env.VERCEL);
const selected = process.argv.find(a => a.startsWith('--remote='))?.split('=')[1];
const requestedVersion = process.argv.find(a => a.startsWith('--version='))?.split('=')[1];
if (requestedVersion && (!selected || !semver.valid(requestedVersion))) throw new Error('--version requires --remote and a valid semantic version');
const shellOnly = process.argv.includes('--shell-only');
execFileSync(process.execPath, [path.join(ROOT, 'scripts/typecheck.mjs')], { stdio: 'inherit' });
const remotesOnly = process.argv.includes('--remotes-only') || Boolean(selected);
const names = ['catalog', 'cart', 'promo', 'reviews'];
if (selected && !names.includes(selected)) throw new Error('Unknown remote');
const routes = { catalog: ['/products'], cart: ['/cart'], promo: [], reviews: [] };
const shellMeta = { supportedContractMajors: [1], sharedDependencies: { '@shoplite/event-bus': '1.0.0', '@shoplite/format': '1.0.0', '@shop/ds': '1.0.0' }, routeOwnership: routes };
fs.mkdirSync(publicDir, { recursive: true });
const shellMetaPath = path.join(publicDir, 'shell-meta.json');
// Existing metadata is authoritative when checking a shell-only release.
if (!fs.existsSync(shellMetaPath)) atomicJson(shellMetaPath, shellMeta);
const versionsPath = path.join(publicDir, 'manifest-versions.json');
const existing = fs.existsSync(versionsPath) ? readJson(versionsPath) : {};
const releases = existing.catalog?.['1.4.0']?.contractMajor ? existing : {};
const previous = fs.existsSync(path.join(publicDir, 'manifest.json')) ? readJson(path.join(publicDir, 'manifest.json')) : {};
const manifest = previous.catalog?.contractMajor ? previous : {};

function vite(name, env = {}) {
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: path.join(ROOT, name), stdio: 'inherit', env: { ...process.env, ...env } });
}
export function publish(name, version, source, extra = {}) {
  const dist = path.join(ROOT, 'remotes', name, 'dist');
  const analysis = readJson(path.join(dist, 'build-analysis.json'));
  const css = extra.css ?? fs.readFileSync(path.join(dist, 'remote.css'), 'utf8');
  const code = source + `\nexport const releaseVersion = ${JSON.stringify(version)};\n`;
  const hash = sha256(code), file = `${name}.${version}.${hash.slice(0, 8)}.js`;
  const meta = { name, version, contractMajor: 1, sha256: hash, cssSha256: sha256(css), sharedDependencies: Object.fromEntries(Object.keys(shellMeta.sharedDependencies).map(k => [k, '^1.0.0'])), bundledPackages: analysis.bundledPackages, routes: routes[name], ...extra };
  delete meta.css;
  // Never overwrite an existing immutable release with different bytes.
  const target = path.join(dist, file);
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== code) throw new Error('Immutable artifact collision');
  fs.writeFileSync(target, code);
  atomicJson(target.replace(/\.js$/, '.remote-meta.json'), meta);
  const descriptor = { url: staticMode ? `/remotes/${name}/${file}` : `http://localhost:${3001 + names.indexOf(name)}/${file}`, version, contractMajor: meta.contractMajor };
  (releases[name] ||= {})[version] = descriptor;
  return descriptor;
}
if (!shellOnly) {
  for (const name of names.filter(n => !selected || selected === n)) {
    vite(`remotes/${name}`, name === 'cart' ? { VITE_CART_EDITION: 'v1' } : {});
    if (name === 'catalog') {
      const dataSource = fs.readFileSync(path.join(ROOT, 'remotes/catalog/src/data.ts'), 'utf8');
      const js = ts.transpileModule(dataSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
      const data = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
      atomicJson(path.join(ROOT, 'remotes/catalog/dist/products.json'), data.INITIAL_PRODUCTS);
    }
    const code = fs.readFileSync(path.join(ROOT, 'remotes', name, 'dist/entry.js'), 'utf8');
    const baseline = requestedVersion || { catalog: '1.4.0', cart: '1.3.0', promo: '1.0.0', reviews: '1.0.0' }[name];
    const initial = publish(name, baseline, code);
    manifest[name] ||= initial;
    // A full build selects freshly built defaults; a selected build only stages releases.
    if (!selected) manifest[name] = initial;
    if (name === 'catalog' && !requestedVersion) { publish(name, '1.7.0', code); buildFixtures(name, code, publish); }
    if (name === 'cart' && !requestedVersion) {
      buildFixtures(name, code, publish);
      vite('remotes/cart', { VITE_CART_EDITION: 'v2' });
      const v2 = publish(name, '1.3.1', fs.readFileSync(path.join(ROOT, 'remotes/cart/dist/entry.js'), 'utf8'));
      releases.cart.v1 = initial; releases.cart.v2 = v2;
    }
  }
  atomicJson(versionsPath, releases);
}
prepareSharedAssets();
if (staticMode) {
  atomicJson(path.join(publicDir, 'demo/products.json'), readJson(path.join(ROOT, 'remotes/catalog/dist/products.json')));
  for (const name of names) {
    const target = path.join(publicDir, 'remotes', name); fs.mkdirSync(target, { recursive: true });
    for (const file of fs.readdirSync(path.join(ROOT, 'remotes', name, 'dist'))) {
      if (/\.[a-f0-9]{8}\.(js|remote-meta\.json)$/.test(file)) fs.copyFileSync(path.join(ROOT, 'remotes', name, 'dist', file), path.join(target, file));
    }
  }
}
const failures = checkManifest(manifest);
if (failures.length) { appendLog('deploy-log.jsonl', { command: 'build', result: 'rejected', failures }); throw new Error(JSON.stringify(failures)); }
if (!selected && !shellOnly) atomicJson(path.join(publicDir, 'manifest.json'), manifest);
if (!remotesOnly) {
  vite('shell', { SHOPLITE_RUNTIME_MODE: staticMode ? 'browser-demo' : 'server' });
  appendLog('deploy-log.jsonl', { command: 'build shell', result: 'success', active: manifest });
}
console.log(selected ? `Staged ${selected}; use npm run deploy -- ${selected} <version>. Shell unchanged.` : 'Build passed G1–G6.');
