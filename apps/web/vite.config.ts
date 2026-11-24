import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/** DukaanDesk web — no PWA plugin (desktop Electron is the shell). */
// Dev only: where the API runs (another copy may hold the default port).
const API = process.env.DD_API_URL ?? 'http://127.0.0.1:3847';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/health': API,
      '/license': API,
      '/auth': API,
      '/catalog': API,
      '/stock': API,
      '/suppliers': API,
      '/purchases': API,
      '/purchase-orders': API,
      '/packs': API,
      '/repack': API,
      '/product-types': API,
      '/pricing': API,
      '/sales': API,
      '/parties': API,
      '/tax': API,
      '/backup': API,
      '/analytics': API,
      '/settings': API,
      '/expenses': API,
      '/cashier': API,
      '/owner': API,
      '/returns': API,
      '/activity': API,
      '/opening-stock': API,
      '/tills': API,
    },
  },
});
