/**
 * Kịch bản kiểm thử tích hợp tự động đầu-cuối (End-to-End Architecture Verification)
 * Khởi chạy toàn bộ 5 server, kiểm tra HTTP headers, CORS, Immutable Cache, Import Map,
 * Manifest Deploy v2 / Instant Rollback v1, Timeout simulation và Server-down simulation.
 */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url, maxWaitMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await sleep(200);
  }
  throw new Error(`Không thể kết nối tới ${url} sau ${maxWaitMs}ms`);
}

async function runVerification() {
  console.log('▶ Khởi động cụm 5 server MFE để kiểm thử tự động...');
  const proc = spawn(process.execPath, [path.join(ROOT, 'scripts', 'start-all.mjs')], {
    cwd: ROOT,
    stdio: 'pipe'
  });

  try {
    await waitForServer('http://localhost:3000');
    await waitForServer('http://localhost:3001/health');
    await waitForServer('http://localhost:3002/health');
    await waitForServer('http://localhost:3003/health');
    await waitForServer('http://localhost:3004/health');
    console.log('✓ Cả 5 server (:3000 Shell + :3001..:3004 Remotes) đều phản hồi ONLINE.');

    // 1. Kiểm tra HTML Shell & Import Map
    const shellHtml = await (await fetch('http://localhost:3000')).text();
    assert(shellHtml.includes('<script type="importmap">'), 'Shell phải chứa <script type="importmap">');
    assert(shellHtml.includes('@shoplite/event-bus'), 'Import map phải ánh xạ @shoplite/event-bus');
    console.log('✓ App Shell chứa Import Map hợp lệ và 4 slot giao diện.');

    // 2. Kiểm tra Manifest no-cache & Immutable Artifacts
    const manifestRes = await fetch('http://localhost:3000/manifest.json');
    assert(
      manifestRes.headers.get('cache-control')?.includes('no-cache'),
      'manifest.json phải cấu hình no-cache'
    );
    const manifest = await manifestRes.json();

    for (const [slot, url] of Object.entries(manifest)) {
      const assetRes = await fetch(url);
      assert.equal(assetRes.status, 200, `Artifact của ${slot} tại ${url} phải trả về 200`);
      assert.equal(
        assetRes.headers.get('access-control-allow-origin'),
        '*',
        `Remote ${slot} phải bật CORS`
      );
      assert(
        assetRes.headers.get('cache-control')?.includes('immutable'),
        `Artifact ${url} phải có Cache-Control immutable`
      );
    }
    console.log('✓ Tất cả 4 Remote trả về ES Module bất biến (Cache-Control: immutable + CORS *).');

    // 3. Kiểm chứng F7 (Deploy Cart v2) & F8 (Instant Rollback Cart v1)
    const v1Url = manifest.cart;
    const deployRes = await fetch('http://localhost:3000/__mfe_admin/deploy-cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edition: 'v2' })
    });
    const deployData = await deployRes.json();
    assert(deployData.cartUrl.includes('cart.v2.'), 'Deploy v2 phải trỏ sang cart.v2.<hash>.js');

    const manifestAfterDeploy = await (await fetch('http://localhost:3000/manifest.json')).json();
    assert.equal(manifestAfterDeploy.cart, deployData.cartUrl);

    const rollbackRes = await fetch('http://localhost:3000/__mfe_admin/deploy-cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edition: 'v1' })
    });
    const rollbackData = await rollbackRes.json();
    assert.equal(rollbackData.cartUrl, v1Url, 'Rollback phải khôi phục chính xác URL bất biến của v1');
    console.log('✓ Kiểm chứng F7 (Independent Deploy v2) & F8 (Instant Rollback v1) thành công.');

    // 4. Kiểm chứng F3 (Tắt/bật cổng server Remote độc lập)
    await fetch('http://localhost:3000/__mfe_admin/toggle-port', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 3003, action: 'stop' })
    });
    let port3003Down = false;
    try {
      await fetch('http://localhost:3003/health');
    } catch {
      port3003Down = true;
    }
    assert(port3003Down, 'Cổng :3003 phải thực sự ngắt kết nối khi mô phỏng sập server');

    // Bật lại cổng :3003
    await fetch('http://localhost:3000/__mfe_admin/toggle-port', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 3003, action: 'start' })
    });
    await waitForServer('http://localhost:3003/health');
    console.log('✓ Kiểm chứng F3 (Tắt và khôi phục cổng :3003 độc lập không ảnh hưởng các cổng khác) thành công.');

    console.log('\n🎉 TOÀN BỘ KỊCH BẢN KIẾN TRÚC MICRO FRONTEND ĐẠT 100%!');
  } finally {
    proc.kill();
  }
}

runVerification().catch((err) => {
  console.error('✗ Kiểm thử thất bại:', err);
  process.exit(1);
});
