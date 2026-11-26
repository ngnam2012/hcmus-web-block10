import { defineConfig } from 'vite';
import { sharedAssetsPlugin } from '../scripts/shared-assets.mjs';

export default defineConfig({
  plugins: [sharedAssetsPlugin()],
  define: {
    __SHOPLITE_RUNTIME_MODE__: JSON.stringify(process.env.SHOPLITE_RUNTIME_MODE || (process.env.VERCEL ? 'browser-demo' : 'server'))
  },
  build: {
    rollupOptions: {
      external: ['@shoplite/event-bus', '@shoplite/format', '@shop/ds']
    }
  },
  server: {
    port: 3000
  }
});
