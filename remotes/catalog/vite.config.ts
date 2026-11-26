import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function injectCssIntoJsPlugin(remoteId: string) {
  return {
    name: 'shoplite-inject-css',
    enforce: 'post' as const,
    generateBundle(_options: unknown, bundle: Record<string, any>) {
      const cssChunks: string[] = [];
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (fileName.endsWith('.css') && asset.type === 'asset') {
          cssChunks.push(String(asset.source));
          delete bundle[fileName];
        }
      }
      if (cssChunks.length === 0) return;
      const combinedCss = cssChunks.join('\n');
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.isEntry) {
          const injector = `(function(){if(typeof document!=='undefined'){let s=document.querySelector('style[data-mfe="${remoteId}"]');if(!s){s=document.createElement('style');s.setAttribute('data-mfe','${remoteId}');document.head.appendChild(s);}s.textContent=${JSON.stringify(combinedCss)};}})();\n`;
          chunk.code = injector + chunk.code;
        }
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), injectCssIntoJsPlugin('catalog')],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    lib: {
      entry: 'src/entry.tsx',
      formats: ['es'],
      fileName: () => 'entry.js'
    },
    rollupOptions: {
      external: ['@shoplite/event-bus', '@shoplite/format']
    }
  },
  server: { port: 3001, cors: true },
  preview: { port: 3001, cors: true }
});
