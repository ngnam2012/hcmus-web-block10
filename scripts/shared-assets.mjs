import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modules = { '@shoplite/event-bus': 'event-bus.v1.js', '@shoplite/format': 'format.v1.js', '@shop/ds': 'ds.v1.js' };

export function prepareSharedAssets() {
  const target = path.join(root, 'shell/public/shared');
  fs.mkdirSync(target, { recursive: true });
  return Object.fromEntries(Object.entries(modules).map(([specifier, filename]) => {
    const bytes = fs.readFileSync(path.join(root, 'shared', filename));
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    const immutableName = filename.replace(/\.js$/, `.${hash}.js`);
    fs.writeFileSync(path.join(target, immutableName), bytes);
    // Named aliases support local development; production import maps use hashes.
    fs.writeFileSync(path.join(target, filename), bytes);
    return [specifier, `/shared/${immutableName}`];
  }));
}

export function sharedAssetsPlugin() {
  let imports;
  return {
    name: 'shoplite-versioned-shared-assets',
    apply: 'build',
    buildStart() { imports = prepareSharedAssets(); },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace(/(<script\s+type="importmap">)[\s\S]*?(<\/script>)/, (_match, start, end) => `${start}\n${JSON.stringify({ imports }, null, 2)}\n${end}`);
      }
    }
  };
}
