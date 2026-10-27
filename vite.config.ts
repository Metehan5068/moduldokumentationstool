import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Das Frontend liegt in src/web und wird nach dist/web gebaut.
// Im Dev-Modus läuft Vite auf :5173 und leitet /api an Fastify (:3000) weiter.
export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
});
