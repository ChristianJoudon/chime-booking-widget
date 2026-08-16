import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Pinned so this checkout never contends with another Chime copy.
    port: 4375,
    strictPort: true,
    open: '/approval.html',
  },
  build: {
    outDir: 'dist-approval',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(process.cwd(), 'approval.html'),
    },
  },
});
