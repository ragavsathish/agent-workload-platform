import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/knowledge/',
  plugins: [react()],
  server: {
    proxy: {
      '/oxigraph': {
        target: 'http://127.0.0.1:7878',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/oxigraph/u, ''),
      },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
});
