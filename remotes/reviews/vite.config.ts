import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    lib: {
      entry: 'src/entry.ts',
      formats: ['es'],
      fileName: () => 'entry.js'
    },
    rollupOptions: {
      external: ['@shoplite/event-bus', '@shoplite/format']
    }
  },
  server: { port: 3004, cors: true },
  preview: { port: 3004, cors: true }
});
