import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    // Pinned so this checkout never contends with another Chime copy on
    // Vite's default 5173.
    port: 5373,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8887',
        changeOrigin: true,
      },
    },
  },
});
