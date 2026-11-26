import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { testServer, request } from './test-support.mjs';
import { ROOT, publicDir, readJson, atomicJson, manifestPath } from './release.mjs';
const server = await testServer(), results = [];
async function test(name, fn) { const evidence = await fn(); results.push({ name, passed: true, evidence }); console.log('✓ ' + name); }
try {
  await request('/__reset', {});
  await test('HTTP: import map, CORS, immutable cache, no-store manifest, missing JS 404', async () => {
    const html = await (await fetch('http://localhost:3000')).text();
    assert(html.includes('"@shop/ds"')); assert(html.includes('<script type="importmap">'));
    const response = await fetch('http://localhost:3000/manifest.json'); assert(response.headers.get('cache-control').includes('no-store'));
    const manifest = await response.json();
    for (const descriptor of Object.values(manifest)) {
      const remote = await fetch(descriptor.url); assert.equal(remote.status, 200); assert.equal(remote.headers.get('access-control-allow-origin'), '*'); assert(remote.headers.get('cache-control').includes('immutable'));
    }
    assert.equal((await fetch('http://localhost:3000/remotes/missing.js')).status, 404);
    assert.equal((await request('/api/not-found')).status, 404);
    assert.equal((await request('/api/cart/v1')).status, 401);
  });
  await test('Session ownership: u1/u2 carts and purchases, revoked token, logout', async () => {
    const u1 = (await request('/api/session', { userId: 'u1' })).data.accessToken;
    assert.equal((await request('/api/cart/v1', { op: 'add', productId: 'T-01', variantId: 'standard' }, 'POST', u1)).status, 200);
    const increments = await Promise.all([1, 2].map(() => request('/api/cart/v1', { op: 'adjust', sku: 'T-01__standard', delta: 1 }, 'POST', u1)));
    assert(increments.every(r => r.status === 200));
    assert.equal((await request('/api/cart/v1', undefined, 'GET', u1)).data.items[0].qty, 3);
    const u2 = (await request('/api/session', { userId: 'u2' })).data.accessToken;
    assert.deepEqual((await request('/api/cart/v1?userId=u1', undefined, 'GET', u2)).data.items, []);
    await request('/api/cart/v1', { op: 'checkout' }, 'POST', u1);
    assert.deepEqual((await request('/api/cart/v1', undefined, 'GET', u1)).data.purchasedIds, ['T-01']);
    assert.deepEqual((await request('/api/cart/v1', undefined, 'GET', u2)).data.purchasedIds, []);
    await request('/api/session', undefined, 'DELETE', u1);
    assert.equal((await request('/api/cart/v1', undefined, 'GET', u1)).status, 401);
  });
  await test('Deploy API rejects missing artifact and incompatible releases without changing manifest', async () => {
    const before = fs.readFileSync(manifestPath, 'utf8');
    const versionFile = path.join(publicDir, 'manifest-versions.json'), bytes = fs.readFileSync(versionFile);
    try {
      const versions = JSON.parse(bytes); versions.cart.missing = { ...versions.cart.v2, url: 'http://localhost:3002/cart.missing.00000000.js' }; atomicJson(versionFile, versions);
      for (const version of ['missing', '2.0.0', '1.4.0']) {
        const response = await request('/__mfe_admin/deploy', { name: 'cart', version }); assert.equal(response.status, 409); assert.equal(fs.readFileSync(manifestPath, 'utf8'), before);
      }
    } finally { fs.writeFileSync(versionFile, bytes); }
    const log = fs.readFileSync(path.join(server.runtime, 'deploy-log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(log.filter(x => x.result === 'rejected').length, 3); return log;
  });
  await test('Deploy/rollback preserves shell bytes and retained artifacts', async () => {
    const htmlBefore = fs.readFileSync(path.join(ROOT, 'shell/dist/index.html'));
    assert.equal((await request('/__mfe_admin/deploy-cart', { edition: 'v2' })).status, 200);
    assert.equal(readJson(manifestPath).cart.version, '1.3.1');
    assert.equal((await request('/__mfe_admin/deploy-cart', { edition: 'v1' })).status, 200);
    assert.equal(readJson(manifestPath).cart.version, '1.3.0'); assert.deepEqual(fs.readFileSync(path.join(ROOT, 'shell/dist/index.html')), htmlBefore);
  });
  await test('Independent remote stop/recovery', async () => {
    await request('/__mfe_admin/toggle-port', { port: 3003, action: 'stop' });
    await assert.rejects(fetch('http://localhost:3003/health'));
    assert.equal((await fetch('http://localhost:3001/health')).status, 200);
    await request('/__mfe_admin/toggle-port', { port: 3003, action: 'start' });
    assert.equal((await fetch('http://localhost:3003/health')).status, 200);
  });
} catch (error) { results.push({ passed: false, error: error.stack }); throw error; }
finally { fs.writeFileSync(path.join(ROOT, '.audit/revision-http-results.json'), JSON.stringify(results, null, 2)); await server.close(); }
