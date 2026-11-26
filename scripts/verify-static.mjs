import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { browser } from './browser-support.mjs';
import { ROOT, publicDir, manifestPath, readJson, sha256 } from './release.mjs';
import { until } from './test-support.mjs';

const files = [manifestPath, path.join(publicDir, 'manifest-versions.json')];
const saved = files.map(file => fs.readFileSync(file));
const requests = [], results = [];
let server, chrome;
const dist = path.join(ROOT, 'shell/dist');
const mounted = (page, slot) => page.wait(`!!document.querySelector('[data-release="${slot}"]')`);
const selectUser = async (page, name) => {
  await page.eval(`(()=>{const select=document.querySelector('#user-switcher');select.value=${JSON.stringify(name)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await page.wait(`document.querySelector('#user-switcher').disabled===false && document.querySelector('#user-switcher').value===${JSON.stringify(name)}`);
};
const count = (page, qty) => page.wait(`document.querySelector('#header-cart-count').textContent==='${qty}'`);
async function test(name, work) {
  const evidence = await work(); results.push({ name, passed: true, evidence }); console.log('✓ ' + name);
}
try {
  for (const name of ['vercel.json', 'shell/vercel.json']) {
    const config = readJson(path.join(ROOT, name));
    const rewrite = new RegExp('^' + config.rewrites[0].source + '$');
    for (const url of ['/api/session', '/__log/client', '/demo/products.json', '/shared/event-bus.v1.hash.js', '/remotes/cart/entry.js', '/assets/index.js', '/manifest.json', '/manifest-versions.json', '/shell-meta.json']) assert(!rewrite.test(url), `${name} must not rewrite ${url} to HTML`);
    assert(rewrite.test('/products')); assert(rewrite.test('/cart'));
    assert(config.headers.find(h => h.source === '/shared/(.*)').headers.some(h => h.key === 'Cache-Control' && h.value.includes('no-store')));
  }
  execFileSync(process.execPath, ['scripts/build-all.mjs', '--vercel'], { cwd: ROOT, stdio: 'inherit' });
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const imports = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  for (const url of Object.values(imports)) {
    assert.match(url, /\.[a-f0-9]{8}\.js$/);
    const bytes = fs.readFileSync(path.join(dist, url));
    assert(url.includes(sha256(bytes).slice(0, 8)));
  }
  const manifestBytes = fs.readFileSync(path.join(dist, 'manifest.json'));
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost'); requests.push(url.pathname);
    if (url.pathname === '/legacy') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<script type="module">import {eventBus} from "/shared/event-bus.v1.js";document.body.dataset.legacy=typeof eventBus.clearSession;</script>'); return;
    }
    if (url.pathname === '/shared/event-bus.v1.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=86400' });
      res.end('export const eventBus={clearHistory(){}};'); return;
    }
    let target = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (target !== dist && !target.startsWith(dist + path.sep)) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      if (!path.extname(url.pathname) && !/^\/(api|__|shared|remotes|assets)(\/|$)/.test(url.pathname)) target = path.join(dist, 'index.html');
      else { res.writeHead(404); res.end('Not found'); return; }
    }
    const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(target)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': /\.[a-f0-9]{8}\.js$/.test(target) ? 'public, max-age=31536000, immutable' : 'no-store' });
    fs.createReadStream(target).pipe(res);
  });
  await new Promise((resolve, reject) => { server.on('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://localhost:${server.address().port}`;
  chrome = await browser({ origin, cacheDisabled: false });
  const page = await chrome.open('/legacy', false);
  await test('Vercel static: stale EventBus in browser cache cannot replace hashed runtime', async () => {
    await page.wait(`document.body.dataset.legacy==='undefined'`);
    await page.call('Page.navigate', { url: origin + '/' });
    await mounted(page, 'catalog');
    assert.equal(await page.eval('location.pathname'), '/products');
    await page.call('Page.navigate', { url: origin + '/products?category=tea&page=2' });
    await mounted(page, 'catalog'); await mounted(page, 'reviews'); await page.wait(`!!document.querySelector('.catalog-add-btn')`);
    assert.equal(await page.eval(`typeof globalThis.__SHOPLITE_EVENT_BUS_SINGLETON_V1__.clearSession`), 'function');
    assert.equal(await page.eval(`document.querySelector('#browser-demo-notice').hidden`), false);
    assert.equal(await page.eval(`document.querySelector('#user-switcher').value`), 'Nguyễn Minh Anh');
    assert(requests.includes(imports['@shoplite/event-bus']));
    assert.equal(requests.filter(url => url === '/shared/event-bus.v1.js').length, 1);
    assert.match(await page.eval(`document.querySelector('.catalog-sku').textContent`), /T-01/);
    return { imports, legacyBusHasClearSession: false, currentBusHasClearSession: true };
  });
  await test('Vercel static: account carts persist independently through reload and logout', async () => {
    await page.click('.catalog-add-btn'); await count(page, 1);
    await page.route('/cart'); await mounted(page, 'cart');
    await page.call('Page.reload'); await mounted(page, 'cart'); await count(page, 1);
    await selectUser(page, 'Trần Quốc Tuấn'); await mounted(page, 'cart'); await count(page, 0);
    await page.call('Page.navigate', { url: origin + '/products?category=tea&page=2' });
    await mounted(page, 'catalog'); await page.wait(`!!document.querySelector('.catalog-add-btn')`);
    await page.click('.catalog-add-btn'); await count(page, 1); await page.click('.catalog-add-btn'); await count(page, 2);
    await page.route('/cart'); await mounted(page, 'cart');
    await selectUser(page, 'Nguyễn Minh Anh'); await mounted(page, 'cart'); await count(page, 1);
    await page.click('#logout-btn'); await page.wait(`document.querySelector('#slot-cart').children.length===0 && !document.querySelector('#login-notice').hidden`);
    await count(page, 0); assert.equal(await page.eval(`document.body.textContent.includes('Trà ô long')`), false);
    await page.call('Page.reload'); await page.wait(`!document.querySelector('#login-notice').hidden`);
    assert.equal(await page.eval(`document.querySelector('#user-switcher').value`), '');
    await selectUser(page, 'Trần Quốc Tuấn'); await mounted(page, 'cart'); await count(page, 2);
    await selectUser(page, 'Nguyễn Minh Anh'); await mounted(page, 'cart'); await count(page, 1);
    return { u1Quantity: 1, u2Quantity: 2, reloadPreservedCart: true, logoutClearedDOM: true };
  });
  await test('Vercel static: Cart v2 preview, gift fee and checkout remain usable without APIs', async () => {
    await page.click('#btn-deploy-v2'); await page.wait(`!!document.querySelector('.cart-v2-banner')`);
    assert.match(await page.eval(`document.querySelector('#manifest-status-msg').textContent`), /tab demo này/);
    assert.deepEqual(fs.readFileSync(path.join(dist, 'manifest.json')), manifestBytes);
    const other = await chrome.open('/cart', false); await mounted(other, 'cart');
    assert.equal(await other.eval(`document.querySelector('.cart-v2-banner')===null`), true);
    await page.click('.cart-gift-option input');
    await page.wait(`document.querySelector('#header-cart-total').textContent===document.querySelector('.cart-total-price').textContent`);
    await page.eval(`(()=>{const plus=document.querySelector('.cart-qty-btn:last-child');plus.click();plus.click()})()`); await count(page, 3);
    await page.eval(`(()=>{const minus=document.querySelector('.cart-qty-btn:first-child');minus.click();minus.click()})()`); await count(page, 1);
    await page.click('.cart-btn-primary'); await page.click('.cart-submit-order'); await page.wait(`!!document.querySelector('.cart-receipt')`); await count(page, 0);
    const carts = await page.eval(`['u1','u2'].map(id=>JSON.parse(localStorage.getItem('shoplite.demo.cart.v1:'+id)))`);
    assert(carts[0].purchasedIds.includes('T-01')); assert.deepEqual(carts[1].purchasedIds, []); assert.equal(carts[1].items[0].qty, 2);
    assert.equal(await page.eval(`JSON.parse(localStorage.getItem('shoplite.demo.stock.v1'))['T-01']`), 19);
    await page.route('/products'); await mounted(page, 'catalog'); await mounted(page, 'reviews');
    await page.eval(`(()=>{const select=document.querySelector('sl-review-hub').shadowRoot.querySelector('[data-action="select-product"]');select.value='T-01';select.dispatchEvent(new Event('change'))})()`);
    await page.wait(`document.querySelector('sl-review-hub').shadowRoot.querySelector('.rev-buyer-status').classList.contains('is-verified')`);
    return { previewIsTabLocal: true, manifestUnchanged: true, u1Purchased: carts[0].purchasedIds, u2Purchased: carts[1].purchasedIds };
  });
  await test('Vercel static: timeout and late result isolation work on a plain file server', async () => {
    await page.click('[data-chaos-op="timeout"][data-slot="catalog"]');
    await page.wait(`document.querySelector('#slot-catalog [data-error-code]')?.dataset.errorCode==='TIMEOUT'`);
    await page.route('/cart'); await mounted(page, 'cart');
    await until(() => page.eval(`JSON.parse(sessionStorage.getItem('shoplite.demo.client-log.v1')).some(e=>e.code==='LATE_IGNORED')`), 6000);
    assert.equal(await page.eval(`document.querySelector('#slot-catalog').children.length`), 0);
    await page.route('/products'); await mounted(page, 'catalog');
    await page.click('[data-chaos-op="toggle-port"][data-slot="promo"]');
    await page.wait(`document.querySelector('#slot-promo [data-error-code]')?.dataset.errorCode==='LOAD_FAILED'`);
    await page.click('[data-chaos-op="toggle-port"][data-slot="promo"]'); await mounted(page, 'promo');
    assert.equal(requests.filter(url => /^\/(api|__)/.test(url)).length, 0);
    assert.equal(page.events.filter(event => event.method === 'Runtime.exceptionThrown').length, 0);
    return { requestsToMissingBackend: 0, lateDOMDiscarded: true, promoRecovered: true };
  });
} catch (error) { results.push({ passed: false, error: error.stack }); throw error; }
finally {
  fs.mkdirSync(path.join(ROOT, '.audit'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, '.audit/revision-static-results.json'), JSON.stringify({ results, requests }, null, 2));
  try { await chrome?.close(); } finally {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    files.forEach((file, i) => fs.writeFileSync(file, saved[i]));
    execFileSync(process.execPath, ['scripts/build-all.mjs', '--shell-only'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, VERCEL: '' } });
  }
}
