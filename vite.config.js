import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  server: {
    port: 1420,
    strictPort: true,
    host: true,
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
