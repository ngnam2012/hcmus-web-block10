import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { parseAst } from 'rollup/parseAst';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const publicDir = path.join(ROOT, 'shell/public');
export const manifestPath = path.join(publicDir, 'manifest.json');
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n'); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
export function appendLog(name, entry) {
  const dir = process.env.SHOPLITE_DATA_DIR || path.join(ROOT, '.data'); fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, name), JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
}
export function artifactPath(name, url) {
  const parsed = new URL(url, 'http://localhost:3000');
  if (!['catalog', 'cart', 'promo', 'reviews'].includes(name)) throw new Error('Unknown remote');
  const base = path.basename(parsed.pathname);
  if (!new RegExp(`^${name}\\.[a-z0-9.-]+\\.js$`).test(base) || parsed.search || parsed.hash) throw new Error('Invalid immutable artifact URL');
  const port = { catalog: '3001', cart: '3002', promo: '3003', reviews: '3004' }[name];
  if (url.startsWith('/')) { if (parsed.pathname !== `/remotes/${name}/${base}`) throw new Error('Invalid artifact path'); }
  else if (parsed.origin !== `http://localhost:${port}` || parsed.pathname !== `/${base}`) throw new Error('Unmanaged artifact origin');
  return path.join(ROOT, 'remotes', name, 'dist', base);
}
function cssIsScoped(css, name) {
  let valid = true;
  const tree = postcss.parse(css);
  tree.walkAtRules(rule => { if (!['media', 'supports', 'container', 'layer', 'keyframes', '-webkit-keyframes'].includes(rule.name)) valid = false; });
  tree.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    selectorParser(selectors => selectors.each(selector => {
      const first = selector.nodes.find(n => n.type !== 'comment');
      if (first?.type !== 'attribute' || first.attribute !== 'data-remote' || first.operator !== '=' || first.value !== name) valid = false;
      let depth = 0;
      for (const node of selector.nodes.slice(1)) {
        if (node.type === 'combinator') {
          if (['+', '~'].includes(node.value.trim()) && depth === 0) valid = false;
          if (['', '>'].includes(node.value.trim())) depth++;
        }
      }
    })).processSync(rule.selector);
  });
  return valid;
}
export function checkManifest(manifest, shell = readJson(path.join(publicDir, 'shell-meta.json'))) {
  const failures = [];
  const fail = (gate, name, reason) => failures.push({ gate, name, reason });
  for (const name of ['catalog', 'cart', 'promo', 'reviews']) {
    const descriptor = manifest[name]; let meta, code, ast;
    try {
      if (!descriptor || typeof descriptor !== 'object') throw new Error('Missing versioned descriptor');
      const file = artifactPath(name, descriptor.url);
      meta = readJson(file.replace(/\.js$/, '.remote-meta.json')); code = fs.readFileSync(file, 'utf8');
      if (meta.name !== name || meta.sha256 !== sha256(code) || !path.basename(file).includes(meta.sha256.slice(0, 8)) || meta.version !== descriptor.version) throw new Error('Artifact/metadata/hash/version mismatch');
      ast = parseAst(code);
      if (!ast.body.some(n => n.type === 'ExportNamedDeclaration' && (n.declaration?.id?.name === 'mount' || n.specifiers?.some(s => s.exported.name === 'mount')))) throw new Error('Missing mount export');
    } catch (error) { fail('G1', name, error.message); continue; }
    if (!shell.supportedContractMajors.includes(meta.contractMajor) || descriptor.contractMajor !== meta.contractMajor) fail('G2', name, 'Unsupported contract major');
    for (const [pkg, range] of Object.entries(meta.sharedDependencies || {})) {
      if (!semver.validRange(range) || !shell.sharedDependencies[pkg] || !semver.satisfies(shell.sharedDependencies[pkg], range)) fail('G3', name, `${pkg}: ${range}`);
    }
    const shared = Object.keys(shell.sharedDependencies);
    if (!Array.isArray(meta.bundledPackages) || meta.bundledPackages.some(pkg => shared.includes(pkg))) fail('G4', name, 'Bundled shared dependency');
    const imports = ast.body.filter(n => n.type === 'ImportDeclaration').map(n => n.source.value);
    if (shared.some(pkg => !imports.includes(pkg))) fail('G4', name, 'Missing external shared import');
    if (imports.some(pkg => !shared.includes(pkg))) fail('G4', name, 'Undeclared external dependency');
    if (imports.some(pkg => !meta.sharedDependencies?.[pkg])) fail('G3', name, 'Missing shared version range');
    const owned = shell.routeOwnership[name];
    if (!Array.isArray(meta.routes) || !owned || meta.routes.length !== owned.length || meta.routes.some(route => !owned.includes(route))) fail('G5', name, 'Route ownership mismatch');
    const styles = ast.body.find(n => n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'VariableDeclaration' && n.declaration.declarations[0]?.id.name === 'remoteStyles')?.declaration.declarations[0].init;
    try {
      if (styles?.type !== 'Literal' || typeof styles.value !== 'string' || sha256(styles.value) !== meta.cssSha256 || !cssIsScoped(styles.value, name)) throw new Error('CSS outside remote boundary or CSS hash mismatch');
    } catch (error) { fail('G6', name, error.message); }
  }
  return failures;
}
export function deployRemote(name, version, command = 'deploy') {
  const before = readJson(manifestPath), releases = readJson(path.join(publicDir, 'manifest-versions.json'));
  const target = releases[name]?.[version], candidate = { ...before, [name]: target };
  const failures = checkManifest(candidate);
  if (failures.length) {
    appendLog('deploy-log.jsonl', { command, remote: name, before: before[name], after: target, result: 'rejected', failures });
    return { ok: false, failures };
  }
  atomicJson(manifestPath, candidate);
  appendLog('deploy-log.jsonl', { command, remote: name, before: before[name], after: target, result: 'success' });
  return { ok: true, descriptor: target };
}
