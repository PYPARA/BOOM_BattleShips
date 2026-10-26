import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2023',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), viewer: resolve(import.meta.dirname, 'viewer.html') },
    },
  },
});
