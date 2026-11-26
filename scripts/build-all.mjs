import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

// Tự động bật chế độ 1-Vercel khi có cờ --vercel hoặc biến môi trường VERCEL=1
const isVercelSingle = process.argv.includes('--vercel') || Boolean(process.env.VERCEL);
const remotesOnly = process.argv.includes('--remotes-only');

function runViteBuild(cwd, extraEnv = {}) {
  console.log(`\n▶ [${path.relative(ROOT, cwd) || 'root'}] vite build`);
  execSync(`"${process.execPath}" "${VITE_BIN}" build`, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv }
  });
}

function hashFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copySharedModulesToShellPublic() {
  const srcDir = path.join(ROOT, 'shared');
  const destDir = path.join(ROOT, 'shell', 'public', 'shared');
  ensureDir(destDir);
  for (const file of ['event-bus.v1.js', 'format.v1.js']) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  }
  console.log('✓ Đã đồng bộ thư viện dùng chung (@shoplite/event-bus & @shoplite/format) vào shell/public/shared/');
}

function syncRemoteToShellPublic(name, distDir) {
  const targetDir = path.join(ROOT, 'shell', 'public', 'remotes', name);
  fs.rmSync(targetDir, { recursive: true, force: true });
  ensureDir(targetDir);
  for (const file of fs.readdirSync(distDir)) {
    const srcFile = path.join(distDir, file);
    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, path.join(targetDir, file));
    }
  }
}

function buildStandardRemote(name, port) {
  const remoteDir = path.join(ROOT, 'remotes', name);
  const distDir = path.join(remoteDir, 'dist');
  fs.rmSync(distDir, { recursive: true, force: true });

  runViteBuild(remoteDir);

  const entryPath = path.join(distDir, 'entry.js');
  const hash = hashFile(entryPath);
  const immutableName = `${name}.${hash}.js`;
  fs.copyFileSync(entryPath, path.join(distDir, immutableName));

  if (isVercelSingle) {
    syncRemoteToShellPublic(name, distDir);
    console.log(`✓ [${name}] Artifact bất biến (Vercel CDN): /remotes/${name}/${immutableName}`);
    return `/remotes/${name}/${immutableName}`;
  }

  console.log(`✓ [${name}] Artifact bất biến: ${immutableName} (port :${port})`);
  return `http://localhost:${port}/${immutableName}`;
}

function buildCartMultiEdition(port) {
  const remoteDir = path.join(ROOT, 'remotes', 'cart');
  const distDir = path.join(remoteDir, 'dist');
  fs.rmSync(distDir, { recursive: true, force: true });
  ensureDir(distDir);

  // Bản v2.0 (Flash Release — thêm Gói quà VIP & VietQR preview)
  runViteBuild(remoteDir, { VITE_CART_EDITION: 'v2' });
  const entryPath = path.join(distDir, 'entry.js');
  const hashV2 = hashFile(entryPath);
  const fileV2 = `cart.v2.${hashV2}.js`;
  fs.copyFileSync(entryPath, path.join(distDir, fileV2));

  // Bản v1.0 (Bản ổn định mặc định lúc khởi tạo)
  runViteBuild(remoteDir, { VITE_CART_EDITION: 'v1' });
  const hashV1 = hashFile(entryPath);
  const fileV1 = `cart.v1.${hashV1}.js`;
  fs.copyFileSync(entryPath, path.join(distDir, fileV1));

  console.log(`✓ [cart] Đã đóng gói 2 phiên bản bất biến để kiểm chứng Deploy & Rollback:`);
  console.log(`   • v1 (mặc định): ${fileV1}`);
  console.log(`   • v2 (nâng cấp): ${fileV2}`);

  if (isVercelSingle) {
    syncRemoteToShellPublic('cart', distDir);
    return {
      v1Url: `/remotes/cart/${fileV1}`,
      v2Url: `/remotes/cart/${fileV2}`
    };
  }

  return {
    v1Url: `http://localhost:${port}/${fileV1}`,
    v2Url: `http://localhost:${port}/${fileV2}`
  };
}

if (!isVercelSingle) {
  // Khi build chế độ Local 5 cổng thì dọn thư mục shell/public/remotes để tránh dư thừa
  fs.rmSync(path.join(ROOT, 'shell', 'public', 'remotes'), { recursive: true, force: true });
}

copySharedModulesToShellPublic();

const catalogUrl = buildStandardRemote('catalog', 3001);
const cartVersions = buildCartMultiEdition(3002);
const promoUrl = buildStandardRemote('promo', 3003);
const reviewsUrl = buildStandardRemote('reviews', 3004);

const manifest = {
  catalog: catalogUrl,
  cart: cartVersions.v1Url,
  promo: promoUrl,
  reviews: reviewsUrl
};

const versionsMeta = {
  cart: {
    v1: cartVersions.v1Url,
    v2: cartVersions.v2Url
  }
};

const shellPublicDir = path.join(ROOT, 'shell', 'public');
ensureDir(shellPublicDir);
fs.writeFileSync(path.join(shellPublicDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(
  path.join(shellPublicDir, 'manifest-versions.json'),
  JSON.stringify(versionsMeta, null, 2) + '\n'
);

if (!remotesOnly) {
  runViteBuild(path.join(ROOT, 'shell'));
}

console.log(
  `\n🎉 Hoàn tất đóng gói hệ thống Micro Frontend ShopLite (${
    isVercelSingle ? 'Chế độ 1-Vercel Static CDN' : 'Chế độ 5-Port Local Servers'
  })!`
);
console.log(JSON.stringify(manifest, null, 2));
