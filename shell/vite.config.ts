import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['@shoplite/event-bus', '@shoplite/format']
    }
  },
  server: {
    port: 3000
  }
});
