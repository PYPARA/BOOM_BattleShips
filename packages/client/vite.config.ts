import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2023', chunkSizeWarningLimit: 1500 },
});
