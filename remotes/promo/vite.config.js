import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { remoteBuildPlugin, sharedPackages } from '../../scripts/remote-build-plugin.mjs';
export default defineConfig({
  plugins: [svelte(), remoteBuildPlugin('promo')],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    emptyOutDir: false,
    lib: { entry: 'src/entry.js', formats: ['es'], fileName: () => 'entry.js' },
    rollupOptions: { external: sharedPackages }
  },
  server: { port: 3003, cors: true }, preview: { port: 3003, cors: true }
});
