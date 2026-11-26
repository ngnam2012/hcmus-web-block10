import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { browser } from './browser-support.mjs';
import { testServer, request, until, pause } from './test-support.mjs';
import { ROOT, publicDir, manifestPath, readJson, atomicJson } from './release.mjs';

const server = await testServer();
let chrome;
const results = [], releases = readJson(path.join(publicDir, 'manifest-versions.json'));
const selected = process.argv.find(a => a.startsWith('--case='))?.slice(7);
const mounted = (c, slot) => c.wait(`!!document.querySelector('#slot-${slot} [data-release="${slot}"]')`);
const fallback = (c, slot, code) => c.wait(`document.querySelector('#slot-${slot} [data-error-code]')?.dataset.errorCode===${JSON.stringify(code)}`);
const manual = (name, version) => atomicJson(manifestPath, { ...readJson(manifestPath), [name]: releases[name][version] });
const deploy = async (name, version) => { const r = await request('/__mfe_admin/deploy', { name, version }); assert.equal(r.status, 200, JSON.stringify(r.data)); };
async function test(name, fn) {
  if (selected && !name.startsWith(selected + ':')) return;
  await request('/__reset', {});
  const started = Date.now();
  try {
    const evidence = await fn();
    const logs = (await request('/__log')).data;
    results.push({ name, passed: true, durationMs: Date.now() - started, evidence, ...logs });
    console.log(`✓ ${name} (${Date.now() - started}ms)`);
  } catch (error) { results.push({ name, passed: false, error: error.stack, logs: (await request('/__log')).data }); throw error; }
}
try {
  chrome = await browser();
  await test('H0: login, query, API add, cart, back and one request per entry', async () => {
    const c = await chrome.open('/products?category=tea&page=2', false);
    await c.wait(`!document.querySelector('#login-notice').hidden`);
    await c.eval(`(()=>{const s=document.querySelector('#user-switcher');s.value='Nguyễn Minh Anh';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await mounted(c, 'catalog'); await c.wait(`!!document.querySelector('.catalog-add-btn')`);
    assert.match(await c.eval(`document.querySelector('.catalog-cat-btn.is-active').textContent`), /Trà/);
    assert.equal(await c.eval(`document.querySelector('[aria-current="page"]').textContent`), 'Trang 2');
    assert.match(await c.eval(`document.querySelector('.catalog-sku').textContent`), /T-01/);
    assert.equal(await c.eval(`document.querySelectorAll('.cart-root').length`), 0);
    await c.click('.catalog-add-btn'); await c.wait(`document.querySelector('#header-cart-count').textContent==='1'`);
    await c.route('/cart'); await mounted(c, 'cart');
    assert.match(await c.eval(`document.querySelector('#slot-cart').textContent`), /Trà ô long/);
    await c.eval('history.back()'); await mounted(c, 'catalog'); await c.wait(`!!document.querySelector('[aria-current="page"]')`);
    assert.equal(await c.eval('location.pathname+location.search'), '/products?category=tea&page=2');
    assert.equal(await c.eval(`document.querySelector('[aria-current="page"]').textContent`), 'Trang 2');
    assert.equal(c.events.filter(e => e.method === 'Runtime.exceptionThrown').length, 0);
    assert.equal(c.events.filter(e => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error').length, 0);
    const requests = c.events.filter(e => e.method === 'Network.requestWillBeSent').map(e => e.params.request.url);
    for (const d of Object.values(readJson(manifestPath))) assert.equal(requests.filter(url => url === d.url).length, 1, d.url);
    return { url: await c.eval('location.href'), badge: 1, entryRequests: Object.values(readJson(manifestPath)).map(d => ({ url: d.url, count: requests.filter(url => url === d.url).length })) };
  });
  await test('F1: 404 containment, client log and retry refetches manifest/entry', async () => {
    const url = readJson(manifestPath).catalog.url; await request('/__faults', { url, status: 404 });
    const started = Date.now(), c = await chrome.open(); await fallback(c, 'catalog', 'LOAD_FAILED');
    const elapsed = Date.now() - started; assert(elapsed < 3500);
    await mounted(c, 'promo');
    const initialLog = await until(async () => { const logs = (await request('/__log')).data.clients.filter(x => x.code === 'LOAD_FAILED'); return logs.length && logs; });
    assert.equal(initialLog.length, 1);
    const screenshot = await c.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(ROOT, '.audit/revision-F1.png'), Buffer.from(screenshot.data, 'base64'));
    await c.route('/cart'); await mounted(c, 'cart');
    await c.route('/products'); await fallback(c, 'catalog', 'LOAD_FAILED');
    await request('/__faults', { url, clear: true });
    const before = c.events.length; await c.click('#slot-catalog [data-retry]'); await mounted(c, 'catalog');
    const urls = c.events.slice(before).filter(e => e.method === 'Network.requestWillBeSent').map(e => e.params.request.url);
    assert(urls.some(u => u.includes('/manifest.json'))); assert(urls.some(u => u.startsWith(url) && u.includes('attempt=')));
    return { fallbackMs: elapsed, initialClientErrors: initialLog.length, retryRequests: urls };
  });
  await test('F2: timeout at 3s, cart at 4s, late catalog ignored after 10s', async () => {
    const url = readJson(manifestPath).catalog.url; await request('/__faults', { url, delayMs: 10000 });
    const started = Date.now(), c = await chrome.open(); await fallback(c, 'catalog', 'TIMEOUT');
    const elapsed = Date.now() - started; assert(elapsed >= 2900 && elapsed < 3700);
    await pause(Math.max(0, 4000 - (Date.now() - started))); await c.route('/cart'); await mounted(c, 'cart');
    await until(async () => (await request('/__log')).data.clients.some(x => x.code === 'LATE_IGNORED'), 11000);
    assert.equal(await c.eval(`document.querySelector('#slot-catalog').children.length`), 0);
    assert.equal(await c.eval(`document.querySelectorAll('style[data-mfe="catalog"]').length`), 0);
    assert(await c.eval(`!!document.querySelector('.cart-root')`));
    return { timeoutMs: elapsed, observedAfterMs: Date.now() - started, catalogChildren: 0 };
  });
  await test('F3: partial mount DOM removed and MOUNT_ERROR logged', async () => {
    await deploy('catalog', '1.5.0'); const c = await chrome.open(); await fallback(c, 'catalog', 'MOUNT_ERROR');
    assert.equal(await c.eval(`document.querySelector('#slot-catalog').children.length`), 1);
    assert.equal(await c.eval(`document.querySelectorAll('[data-partial]').length`), 0);
    assert.equal(await c.eval(`document.querySelectorAll('style[data-mfe="catalog"]').length`), 0);
    await mounted(c, 'promo');
    return { html: await c.eval(`document.querySelector('#slot-catalog').innerHTML`) };
  });
  await test('F4: G2 blocks deploy, loader blocks major 2 before import', async () => {
    const before = fs.readFileSync(manifestPath, 'utf8');
    const rejected = await request('/__mfe_admin/deploy', { name: 'cart', version: '2.0.0' });
    assert.equal(rejected.status, 409); assert(rejected.data.failures.some(x => x.gate === 'G2')); assert.equal(fs.readFileSync(manifestPath, 'utf8'), before);
    manual('cart', '2.0.0'); const c = await chrome.open('/cart'); await fallback(c, 'cart', 'INCOMPATIBLE');
    assert.equal(c.events.filter(e => e.method === 'Network.requestWillBeSent' && e.params.request.url === releases.cart['2.0.0'].url).length, 0);
    await c.route('/products'); await mounted(c, 'catalog');
    return { entryRequests: 0, rejection: rejected.data };
  });
  await test('F5: duplicate DS rejected; manual bypass contained; fixed DS loaded once', async () => {
    const rejected = await request('/__mfe_admin/deploy', { name: 'cart', version: '1.4.0' });
    assert.equal(rejected.status, 409); assert(rejected.data.failures.some(x => x.gate === 'G4'));
    manual('cart', '1.4.0'); const bad = await chrome.open('/cart'); await fallback(bad, 'cart', 'LOAD_FAILED');
    const errors = bad.events.filter(e => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error').flatMap(e => e.params.args.map(a => a.description || a.value));
    assert(errors.some(e => String(e).includes('NotSupportedError')));
    await bad.route('/products'); await mounted(bad, 'catalog');
    assert.equal(await bad.eval(`customElements.get('ds-button') && document.querySelector('ds-button').dataset.dsVersion`), '1.0.0');
    await deploy('cart', '1.4.1'); const fixed = await chrome.open('/cart'); await mounted(fixed, 'cart');
    const dsRequests = fixed.events.filter(e => e.method === 'Network.requestWillBeSent' && e.params.request.url.endsWith('/shared/ds.v1.js')).length;
    assert.equal(dsRequests, 1); assert.equal(fixed.events.filter(e => e.method === 'Runtime.exceptionThrown').length, 0);
    return { consoleErrors: errors, fixedDSRequests: dsRequests };
  });
  await test('F6: global CSS changes header; scoped fix preserves all three measurements', async () => {
    const rejected = await request('/__mfe_admin/deploy', { name: 'catalog', version: '1.6.0' }); assert.equal(rejected.status, 409); assert(rejected.data.failures.some(x => x.gate === 'G6'));
    const measurements = {};
    for (const version of ['1.6.0', '1.6.1']) {
      manual('catalog', version); const c = await chrome.open('/cart'); await mounted(c, 'cart');
      const measure = () => c.eval(`(()=>{const s=getComputedStyle(document.querySelector('#header-cart-summary'));return {fontSize:s.fontSize,background:s.backgroundColor,primary:getComputedStyle(document.documentElement).getPropertyValue('--ds-color-primary')}})()`);
      const before = await measure(); await c.route('/products'); await mounted(c, 'catalog'); const during = await measure();
      await c.route('/cart'); await mounted(c, 'cart'); const after = await measure();
      assert.equal(await c.eval(`document.querySelectorAll('style[data-mfe="catalog"]').length`), 0);
      if (version === '1.6.0') assert.notDeepEqual(during, before); else assert.deepEqual(during, before);
      assert.deepEqual(after, before); measurements[version] = { before, during, after, stylesAfterUnmount: 0 };
    }
    return measurements;
  });
  await test('F7: leaky/fixed listeners, history, logout and u1/u2 isolation', async () => {
    const calls = {};
    for (const version of ['1.5.0', '1.5.1']) {
      await request('/__reset', {});
      await deploy('cart', version); const c = await chrome.open('/cart'); await mounted(c, 'cart');
      for (let i = 0; i < 5; i++) { await c.route('/products'); await mounted(c, 'catalog'); await c.route('/cart'); await mounted(c, 'cart'); }
      await c.eval(`window.__cartDebug.handlerCalls=0; window.__cartDebug.addOne()`);
      calls[version] = await c.eval('window.__cartDebug.handlerCalls');
      if (version === '1.5.0') assert(calls[version] > 1); else assert.equal(calls[version], 1);
      assert.equal(await c.eval(`document.querySelector('#header-cart-count').textContent`), '1');
    }
    await request('/__reset', {});
    const c = await chrome.open('/products?category=tea&page=2'); await mounted(c, 'catalog'); await c.wait(`!!document.querySelector('.catalog-add-btn')`);
    await c.click('.catalog-add-btn'); await c.wait(`document.querySelector('#header-cart-count').textContent==='1'`);
    await c.route('/cart'); await mounted(c, 'cart'); await c.eval('history.back()'); await mounted(c, 'catalog');
    assert.equal(await c.eval('location.pathname+location.search'), '/products?category=tea&page=2');
    await c.eval('history.forward()'); await mounted(c, 'cart'); assert.equal(await c.eval('location.pathname'), '/cart');
    await c.click('#logout-btn'); await c.wait(`!document.querySelector('#login-notice').hidden && document.querySelector('#slot-cart').children.length===0`);
    assert.equal(await c.eval(`document.querySelector('#header-cart-count').textContent`), '0');
    assert.equal(await c.eval(`document.body.textContent.includes('Trà ô long')`), false);
    assert.equal(await c.eval(`globalThis.__SHOPLITE_EVENT_BUS_SINGLETON_V1__.getHistory().some(e=>JSON.stringify(e).includes('Trà ô long'))`), false);
    await c.eval(`(()=>{const s=document.querySelector('#user-switcher');s.value='Trần Quốc Tuấn';s.dispatchEvent(new Event('change',{bubbles:true}))})()`); await mounted(c, 'cart');
    assert.equal(await c.eval(`document.querySelector('#header-cart-count').textContent`), '0');
    assert.equal(await c.eval(`document.querySelectorAll('.cart-item-name').length`), 0);
    await c.eval(`(()=>{const s=document.querySelector('#user-switcher');s.value='Nguyễn Minh Anh';s.dispatchEvent(new Event('change',{bubbles:true}))})()`); await mounted(c, 'cart');
    assert.equal(await c.eval(`document.querySelector('#header-cart-count').textContent`), '1');
    return { handlerCalls: calls, logoutRemovedUserDOM: true, u2Count: 0, restoredU1Count: 1 };
  });
  await test('F8: catalog deploy/rollback across three tabs preserves shell and cart', async () => {
    const a = await chrome.open(); await mounted(a, 'catalog');
    await deploy('catalog', '1.7.0'); const b = await chrome.open(); await mounted(b, 'catalog');
    assert.equal(await a.eval(`document.querySelector('[data-release="catalog"]').textContent`), 'catalog 1.4.0');
    await a.call('Page.reload'); await mounted(a, 'catalog'); assert.equal(await a.eval(`document.querySelector('[data-release="catalog"]').textContent`), 'catalog 1.7.0');
    await deploy('catalog', '1.4.0'); const c = await chrome.open(); await mounted(c, 'catalog');
    const tabs = [];
    for (const page of [a, b, c]) {
      const catalog = await page.eval(`document.querySelector('[data-release="catalog"]').textContent`);
      await page.route('/cart'); await mounted(page, 'cart');
      tabs.push(await page.eval(`({catalog:${JSON.stringify(catalog)},cart:document.querySelector('[data-release="cart"]').textContent,shell:document.querySelector('script[type="module"][src]').getAttribute('src')})`));
    }
    assert.equal(new Set(tabs.map(t => t.shell)).size, 1); assert(tabs.every(t => t.cart === 'cart 1.3.0'));
    assert.equal(tabs[1].catalog, 'catalog 1.7.0'); assert.equal(tabs[2].catalog, 'catalog 1.4.0');
    const lines = fs.readFileSync(path.join(server.runtime, 'deploy-log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter(l => l.result === 'success' && l.remote === 'catalog').slice(-2);
    assert.equal(lines.length, 2); return { tabs, tabABeforeReload: 'catalog 1.4.0', tabAAfterReload: 'catalog 1.7.0', deployLog: lines };
  });
  await test('Regression: API add while cart unavailable, retry receives newly deployed cart and gift fee reaches header', async () => {
    const c = await chrome.open('/products?category=tea&page=2'); await mounted(c, 'catalog'); await c.wait(`!!document.querySelector('.catalog-add-btn')`);
    await c.route('/cart'); await mounted(c, 'cart');
    await c.click('[data-chaos-op="crash"][data-slot="cart"]'); await fallback(c, 'cart', 'MOUNT_ERROR');
    await c.route('/products'); await mounted(c, 'catalog'); await c.wait(`!!document.querySelector('.catalog-add-btn')`);
    await c.click('.catalog-add-btn'); await c.wait(`document.querySelector('#header-cart-count').textContent==='1'`);
    await c.route('/cart'); await mounted(c, 'cart'); await c.click('[data-chaos-op="crash"][data-slot="cart"]'); await fallback(c, 'cart', 'MOUNT_ERROR');
    await request('/__mfe_admin/deploy-cart', { edition: 'v2' });
    const start = c.events.length; await c.click('#slot-cart [data-retry]'); await mounted(c, 'cart'); await c.wait(`!!document.querySelector('.cart-v2-banner')`);
    assert(c.events.slice(start).some(e => e.method === 'Network.requestWillBeSent' && e.params.request.url.includes('/manifest.json')));
    const before = await c.eval(`document.querySelector('#header-cart-total').textContent`);
    await c.click('.cart-gift-option input'); await c.wait(`document.querySelector('#header-cart-total').textContent===document.querySelector('.cart-total-price').textContent`);
    assert.notEqual(await c.eval(`document.querySelector('#header-cart-total').textContent`), before);
    return { count: await c.eval(`document.querySelector('#header-cart-count').textContent`), header: await c.eval(`document.querySelector('#header-cart-total').textContent`), cart: await c.eval(`document.querySelector('.cart-total-price').textContent`) };
  });
  await test('Lifecycle: invalid exports/handle and async cleanup across routes', async () => {
    for (const version of ['1.9.0-invalid', '1.9.0-handle']) {
      manual('catalog', version); const c = await chrome.open(); await fallback(c, 'catalog', 'INVALID_MODULE');
      assert.equal(await c.eval(`document.querySelectorAll('[data-partial]').length`), 0);
      assert.equal(await c.eval(`document.querySelectorAll('style[data-mfe="catalog"]').length`), 0);
    }
    manual('catalog', '1.9.0-async'); const c = await chrome.open(); await mounted(c, 'catalog');
    await c.route('/cart'); await c.wait(`window.__cleanupTrace.includes('cleanup-start')`);
    assert.equal(await c.eval(`document.querySelectorAll('.cart-root').length`), 0);
    await mounted(c, 'cart'); assert.deepEqual(await c.eval('window.__cleanupTrace'), ['mount', 'cleanup-start', 'cleanup-end']);
    await c.route('/products'); await mounted(c, 'catalog');
    const initialMounts = await c.eval(`window.__cleanupTrace.filter(s=>s==='mount').length`);
    await c.click('[data-chaos-op="race"][data-slot="catalog"]');
    await c.wait(`window.__cleanupTrace.filter(s=>s==='mount').length===${initialMounts + 1}`);
    assert(await c.eval(`document.querySelector('#event-log-stream').textContent.includes('discarded:catalog')`));
    return { trace: await c.eval('window.__cleanupTrace'), invalidModulesContained: 2 };
  });
  await test('Flow: checkout demo, stock after route change, purchased review, theme and Shadow DOM', async () => {
    const c = await chrome.open('/products?category=tea&page=2'); await mounted(c, 'catalog'); await mounted(c, 'reviews'); await c.wait(`!!document.querySelector('.catalog-add-btn')`);
    const externalStyle = () => c.eval(`(()=>{const s=getComputedStyle(document.querySelector('#theme-toggle-btn'));return [s.fontSize,s.backgroundColor]})()`);
    const before = await externalStyle();
    await c.eval(`document.querySelector('sl-review-hub').shadowRoot.querySelector('[data-action="toggle-css-chaos"]').click()`);
    assert.deepEqual(await externalStyle(), before);
    await c.click('#theme-toggle-btn'); assert.equal(await c.eval('document.documentElement.dataset.theme'), 'dark');
    await c.click('.catalog-review-link'); await c.click('.catalog-add-btn'); await c.wait(`document.querySelector('#header-cart-count').textContent==='1'`);
    await c.route('/cart'); await mounted(c, 'cart');
    await c.eval(`(()=>{const plus=document.querySelector('.cart-qty-btn:last-child');plus.click();plus.click()})()`);
    await c.wait(`document.querySelector('#header-cart-count').textContent==='3'`);
    await c.eval(`(()=>{const minus=document.querySelector('.cart-qty-btn:first-child');minus.click();minus.click()})()`);
    await c.wait(`document.querySelector('#header-cart-count').textContent==='1'`);
    await c.click('.cart-btn-primary'); await c.click('.cart-submit-order'); await c.wait(`!!document.querySelector('.cart-receipt')`);
    assert.equal(await c.eval(`document.querySelector('#header-cart-count').textContent`), '0');
    const api = await c.eval(`fetch('/api/cart/v1').then(r=>r.json())`); assert(api.purchasedIds.includes('T-01')); assert.equal(api.stock['T-01'], 19);
    await c.eval('history.back()'); await mounted(c, 'catalog'); await mounted(c, 'reviews'); await c.wait(`document.querySelector('.catalog-stock-tag')?.textContent.includes('19')`);
    await c.wait(`document.querySelector('sl-review-hub').shadowRoot.querySelector('.rev-buyer-status')?.classList.contains('is-verified')`);
    await c.eval(`(()=>{const r=document.querySelector('sl-review-hub').shadowRoot;const input=r.querySelector('textarea');input.value='Trà ngon, kiểm tra luồng đặt hàng và đánh giá.';input.dispatchEvent(new Event('input',{bubbles:true}));r.querySelector('[data-action="submit-review"]').click()})()`);
    await c.wait(`document.querySelector('sl-review-hub').shadowRoot.textContent.includes('Trà ngon, kiểm tra luồng đặt hàng và đánh giá.')`);
    await c.wait(`document.querySelector('.catalog-review-link').textContent.includes('1 đánh giá')`);
    assert.equal(c.events.filter(e => e.method === 'Runtime.exceptionThrown').length, 0);
    return { purchasedIds: api.purchasedIds, stockAfterCheckout: api.stock['T-01'], verifiedReview: true, externalStyleUnchanged: true, theme: 'dark' };
  });
} finally {
  fs.writeFileSync(path.join(ROOT, '.audit/revision-browser-results.json'), JSON.stringify(results, null, 2));
  try { await chrome?.close(); } finally { await server.close(); }
}
