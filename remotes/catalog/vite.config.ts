import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { remoteBuildPlugin, sharedPackages } from '../../scripts/remote-build-plugin.mjs';
export default defineConfig({
  plugins: [react(), remoteBuildPlugin('catalog')],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    emptyOutDir: false,
    lib: { entry: 'src/entry.tsx', formats: ['es'], fileName: () => 'entry.js' },
    rollupOptions: { external: sharedPackages }
  },
  server: { port: 3001, cors: true }, preview: { port: 3001, cors: true }
});
