import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  // Admin credentials live in config/admin/, NOT in the repository root.
  //
  // Vite loads root .env* files for every config in the project, including
  // vite.embed.config.ts. An admin session token in a root .env.local would
  // therefore be inlined into the customer-facing booking widget bundle that
  // gets copied onto public websites. Scoping envDir keeps administrator
  // configuration out of every widget build.
  envDir: path.resolve(__dirname, 'config/admin'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 4174,
    open: '/admin.html',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8788',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist-admin',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'admin.html'),
    },
  },
});
