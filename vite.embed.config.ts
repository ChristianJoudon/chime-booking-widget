import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Builds the single-file embeddable widget bundle:
//   npm run build:embed
// Output: dist-embed/chime-widget.js (IIFE) + dist-embed/chime-widget.css
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist-embed',
    emptyOutDir: true,
    lib: {
      entry: 'src/embed.tsx',
      name: 'ChimeWidget',
      formats: ['iife'],
      fileName: () => 'chime-widget.js',
      cssFileName: 'chime-widget',
    },
  },
});
