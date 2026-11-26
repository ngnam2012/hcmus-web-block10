import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['shell', 'remotes/catalog', 'remotes/cart', 'remotes/reviews']) {
  const tool = name === 'remotes/cart' ? 'vue-tsc/bin/vue-tsc.js' : 'typescript/bin/tsc';
  execFileSync(process.execPath, [path.join(root, 'node_modules', tool), '--noEmit', '-p', path.join(root, name, 'tsconfig.json')], { stdio: 'inherit' });
}
