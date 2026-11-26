import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
export const sharedPackages = ['@shoplite/event-bus', '@shoplite/format', '@shop/ds'];
export function remoteBuildPlugin(name) {
  return {
    name: 'shoplite-remote-metadata', enforce: 'post',
    generateBundle(_options, bundle) {
      let css = '';
      for (const [file, asset] of Object.entries(bundle)) {
        if (asset.type === 'asset' && file.endsWith('.css')) { css += String(asset.source) + '\n'; delete bundle[file]; }
      }
      const tree = postcss.parse(css);
      tree.walkRules(rule => {
        if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
        rule.selector = selectorParser(selectors => selectors.each(selector => {
          selector.prepend(selectorParser.combinator({ value: ' ' }));
          selector.prepend(selectorParser.attribute({ attribute: 'data-remote', operator: '=', value: name, quoteMark: '"' }));
        })).processSync(rule.selector);
      });
      css = tree.toString();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.isEntry) continue;
        // Import has no CSS side effects: the loader owns installation and cleanup.
        chunk.code = `export const remoteStyles = ${JSON.stringify(css)};\n` + chunk.code;
        const modules = Object.keys(chunk.modules);
        const packages = [...new Set(modules.flatMap(id => {
          const match = id.replaceAll('\\', '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
          return match ? [match[1]] : [];
        }))];
        this.emitFile({ type: 'asset', fileName: 'build-analysis.json', source: JSON.stringify({ bundledPackages: packages, modules, imports: chunk.imports }, null, 2) });
        this.emitFile({ type: 'asset', fileName: 'remote.css', source: css });
      }
    }
  };
}
