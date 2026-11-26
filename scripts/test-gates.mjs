import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkManifest, readJson, manifestPath, publicDir, artifactPath } from './release.mjs';
const results = [];
const manifest = readJson(manifestPath), releases = readJson(path.join(publicDir, 'manifest-versions.json'));
const check = (name, fn) => { fn(); results.push({ name, passed: true }); console.log('✓ ' + name); };
check('G1–G6 baseline', () => assert.deepEqual(checkManifest(manifest), []));
const artifact = artifactPath('cart', manifest.cart.url), bytes = fs.readFileSync(artifact);
try {
  fs.appendFileSync(artifact, '\n// changed bytes\n');
  check('G1 rejects tampered bytes', () => assert(checkManifest(manifest).some(x => x.gate === 'G1')));
} finally { fs.writeFileSync(artifact, bytes); }
for (const [name, version, gate] of [['cart', '2.0.0', 'G2'], ['cart', '1.4.0', 'G4'], ['catalog', '1.6.0', 'G6']]) {
  check(`${gate} rejects ${name} ${version}`, () => assert(checkManifest({ ...manifest, [name]: releases[name][version] }).some(x => x.gate === gate)));
}
const metadata = artifact.replace(/\.js$/, '.remote-meta.json'), original = fs.readFileSync(metadata);
for (const [gate, alter] of [['G3', m => m.sharedDependencies['@shop/ds'] = '^2.0.0'], ['G5', m => m.routes = ['/products']]]) {
  try {
    const meta = JSON.parse(original); alter(meta); fs.writeFileSync(metadata, JSON.stringify(meta));
    check(`${gate} rejects invalid metadata`, () => assert(checkManifest(manifest).some(x => x.gate === gate)));
  } finally { fs.writeFileSync(metadata, original); }
}
check('G2 rejects incompatible replacement shell', () => {
  const shell = readJson(path.join(publicDir, 'shell-meta.json')); shell.supportedContractMajors = [2];
  assert.equal(checkManifest(manifest, shell).filter(x => x.gate === 'G2').length, 4);
});
for (const [name, version] of [['cart', '1.4.1'], ['cart', '1.5.1'], ['catalog', '1.6.1']]) check(`fixed ${name} ${version} passes`, () => assert.deepEqual(checkManifest({ ...manifest, [name]: releases[name][version] }), []));
fs.mkdirSync(path.join(publicDir, '../../.audit'), { recursive: true });
fs.writeFileSync(path.join(publicDir, '../../.audit/revision-gate-results.json'), JSON.stringify(results, null, 2));
