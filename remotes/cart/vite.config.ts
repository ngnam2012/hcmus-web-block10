import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { remoteBuildPlugin, sharedPackages } from '../../scripts/remote-build-plugin.mjs';
export default defineConfig({
  plugins: [vue(), remoteBuildPlugin('cart')],
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), __VUE_OPTIONS_API__: true, __VUE_PROD_DEVTOOLS__: false, __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false },
  build: {
    emptyOutDir: false,
    lib: { entry: 'src/entry.ts', formats: ['es'], fileName: () => 'entry.js' },
    rollupOptions: { external: sharedPackages }
  },
  server: { port: 3002, cors: true }, preview: { port: 3002, cors: true }
});
