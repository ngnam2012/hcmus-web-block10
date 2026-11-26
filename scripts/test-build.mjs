import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, publicDir, manifestPath, readJson, sha256, artifactPath, deployRemote, checkManifest } from './release.mjs';
const versionsPath = path.join(publicDir, 'manifest-versions.json');
const saved = [manifestPath, versionsPath].map(file => fs.readFileSync(file));
const before = readJson(manifestPath), oldFile = artifactPath('catalog', before.catalog.url), oldBytes = fs.readFileSync(oldFile);
const html = fs.readFileSync(path.join(ROOT, 'shell/dist/index.html'), 'utf8');
const asset = html.match(/src="([^"]+\.js)"/)[1];
const shellHash = sha256(fs.readFileSync(path.join(ROOT, 'shell/dist', asset)));
process.env.SHOPLITE_DATA_DIR = path.join(ROOT, '.audit/build-test-runtime');
try {
  execFileSync(process.execPath, ['scripts/build-all.mjs', '--remote=catalog', '--version=1.8.0'], { cwd: ROOT, stdio: 'inherit' });
  assert.deepEqual(fs.readFileSync(manifestPath), saved[0]);
  assert.equal(sha256(fs.readFileSync(path.join(ROOT, 'shell/dist', asset))), shellHash);
  assert.deepEqual(fs.readFileSync(oldFile), oldBytes);
  assert(deployRemote('catalog', '1.8.0', 'test selected build deploy').ok);
  assert(deployRemote('catalog', '1.4.0', 'test selected build rollback').ok);
  assert.deepEqual(checkManifest(readJson(manifestPath)), []);
  const evidence = { passed: true, selectedRemote: 'catalog', stagedVersion: '1.8.0', shellHash, shellUnchanged: true, manifestUnchangedWhileStaging: true, previousArtifactRetained: true, deployAndRollbackPassed: true };
  fs.writeFileSync(path.join(ROOT, '.audit/revision-build-results.json'), JSON.stringify(evidence, null, 2));
  console.log('✓ Selected remote build preserves Shell/manifest and retains rollback artifact.');
} finally { [manifestPath, versionsPath].forEach((file, i) => fs.writeFileSync(file, saved[i])); }
