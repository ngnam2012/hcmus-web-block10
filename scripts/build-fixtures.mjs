import { parseAst } from 'rollup/parseAst';

// Reproducible faulty versions are staged, never selected by a normal build.
export function buildFixtures(name, code, publish) {
  const ast = parseAst(code);
  const exports = ast.body.find(n => n.type === 'ExportNamedDeclaration' && n.specifiers?.some(s => s.exported.name === 'mount'));
  const local = exports.specifiers.find(s => s.exported.name === 'mount').local.name;
  const specifier = exports.specifiers.find(s => s.exported.name === 'mount');
  const base = code.slice(0, specifier.exported.start) + '__baseMount' + code.slice(specifier.exported.end);
  const styles = ast.body.find(n => n.type === 'ExportNamedDeclaration' && n.declaration?.declarations?.[0]?.id.name === 'remoteStyles').declaration.declarations[0].init;
  if (name === 'catalog') {
    publish(name, '1.9.0-invalid', base);
    publish(name, '1.9.0-handle', base + '\nexport function mount(container) { container.innerHTML="<p data-partial>Invalid handle</p>"; return {}; }');
    publish(name, '1.9.0-async', base + `\nexport function mount(container, ctx) {
      window.__cleanupTrace ||= []; window.__cleanupTrace.push('mount');
      const handle = ${local}(container, ctx);
      return { async unmount() {
        window.__cleanupTrace.push('cleanup-start');
        await new Promise(resolve => setTimeout(resolve, 300));
        await handle.unmount(); window.__cleanupTrace.push('cleanup-end');
      } };
    }`);
    publish(name, '1.5.0', base + '\nexport function mount(container) { container.innerHTML="<p data-partial>Partial catalog</p>"; throw new Error("catalog mount fixture"); }');
    const css = '.btn { font-size: 2rem; background: #c00 } :root { --ds-color-primary: #c00 }';
    publish(name, '1.6.0', code.slice(0, styles.start) + JSON.stringify(css) + code.slice(styles.end), { css });
    publish(name, '1.6.1', code);
  } else {
    publish(name, '2.0.0', base + '\nexport function mount(container, ctx) { ctx.router.push("/cart"); return {unmount(){}}; }', { contractMajor: 2 });
    publish(name, '1.4.0', 'customElements.define("ds-button", class extends HTMLElement {});\n' + code, { bundledPackages: ['@shop/ds'] });
    publish(name, '1.4.1', code);
    publish(name, '1.5.0', base + `\nimport { eventBus as fixtureBus } from '@shoplite/event-bus';
    export function mount(container, ctx) {
      const handle = ${local}(container, ctx);
      window.__cartDebug ||= {handlerCalls:0};
      window.__cartDebug.addOne = () => ctx.cart.add({productId:'T-01',variantId:'standard'});
      fixtureBus.on('cart:operation-confirmed', () => { window.__cartDebug.handlerCalls++; });
      return handle;
    }`);
    publish(name, '1.5.1', base + `\nexport function mount(container, ctx) {
      const handle = ${local}(container, ctx);
      window.__cartDebug ||= {handlerCalls:0};
      window.__cartDebug.addOne = () => ctx.cart.add({productId:'T-01',variantId:'standard'});
      const off = ctx.eventBus.on('cart:operation-confirmed', () => { window.__cartDebug.handlerCalls++; });
      return { async unmount() { off(); await handle.unmount(); } };
    }`);
  }
}
