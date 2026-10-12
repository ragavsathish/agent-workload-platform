import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/start': 'http://127.0.0.1:7860',
      '/status': 'http://127.0.0.1:7860',
      '/ws-client': {
        target: 'ws://127.0.0.1:7860',
        ws: true,
      },
    },
  },
});
