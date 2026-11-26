import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Phần 4 — Compatibility Gate (Cổng kiểm tra tương thích CI/CD trước khi phát hành Remote)
 * Xác thực:
 * 1. Tồn tại bundle entry.js và artifact bất biến trong manifest.json
 * 2. Ngân sách dung lượng (Bundle Size Budget <= 250 KB mỗi Remote)
 * 3. Đảm bảo thư viện trong Import Map (@shoplite/format) được đánh dấu external, không đóng gói trùng lặp
 * 4. Kiểm tra cấu trúc export chuẩn Contract: hàm mount()
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BUDGET_KB = 250;
const REMOTES = [
  { name: 'catalog', framework: 'React 18', expectsSharedFormat: true },
  { name: 'cart', framework: 'Vue 3', expectsSharedFormat: true },
  { name: 'promo', framework: 'Svelte 4', expectsSharedFormat: true },
  { name: 'reviews', framework: 'Web Components', expectsSharedFormat: true }
];

let hasError = false;
console.log('======================================================================');
console.log(' 🛡️  SHOPLITE MFE — COMPATIBILITY GATE (KIỂM ĐỊNH CONTRACT & BUNDLE)');
console.log('======================================================================');

const manifestPath = path.join(ROOT, 'shell', 'public', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('✗ Thiếu shell/public/manifest.json. Hãy chạy "npm run build" trước.');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

for (const remote of REMOTES) {
  const entryPath = path.join(ROOT, 'remotes', remote.name, 'dist', 'entry.js');
  if (!fs.existsSync(entryPath)) {
    console.error(`✗ [${remote.name}] Không tìm thấy ${entryPath}`);
    hasError = true;
    continue;
  }

  const stat = fs.statSync(entryPath);
  const sizeKb = Number((stat.size / 1024).toFixed(2));
  const code = fs.readFileSync(entryPath, 'utf8');

  const withinBudget = sizeKb <= BUDGET_KB;
  const hasMountExport =
    /\bexport\s*\{[^}]*\bmount\b/.test(code) || /\bexport\s+function\s+mount\b/.test(code);
  const keepsImportMapExternal = remote.expectsSharedFormat
    ? code.includes('@shoplite/format')
    : true;
  const manifestUrl = manifest[remote.name] || '';
  const immutableFile = manifestUrl.split('/').pop();
  const immutableExists = immutableFile
    ? fs.existsSync(path.join(ROOT, 'remotes', remote.name, 'dist', immutableFile))
    : false;

  if (!withinBudget || !hasMountExport || !keepsImportMapExternal || !immutableExists) {
    hasError = true;
  }

  console.log(
    `${withinBudget && hasMountExport && keepsImportMapExternal && immutableExists ? '✓' : '✗'} [${remote.name.padEnd(7)} | ${remote.framework.padEnd(14)}] ` +
      `Size: ${String(sizeKb).padStart(6)} KB / ${BUDGET_KB} KB | ` +
      `export mount(): ${hasMountExport ? 'OK' : 'FAIL'} | ` +
      `ImportMap external: ${keepsImportMapExternal ? 'OK' : 'FAIL'} | ` +
      `Immutable: ${immutableFile || 'MISSING'}`
  );
}

console.log('======================================================================');
if (hasError) {
  console.error('✗ Compatibility Gate THẤT BẠI: Có Remote vi phạm tiêu chuẩn phát hành!');
  process.exit(1);
} else {
  console.log('✓ Compatibility Gate ĐẠT CHUẨN 100%: Tất cả 4 Remote sẵn sàng phát hành độc lập!');
}
