import { defineConfig } from 'vite';
import { remoteBuildPlugin, sharedPackages } from '../../scripts/remote-build-plugin.mjs';

export default defineConfig({
  plugins: [remoteBuildPlugin('reviews')],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/entry.ts',
      formats: ['es'],
      fileName: () => 'entry.js'
    },
    rollupOptions: {
      external: sharedPackages
    }
  },
  server: { port: 3004, cors: true },
  preview: { port: 3004, cors: true }
});
