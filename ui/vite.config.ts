import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';

const TIPTAP_DEPS = [
  '@tiptap',
  'prosemirror-',
  'tiptap-markdown',
  'markdown-it',
  'lowlight',
  'highlight.js',
];

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true }),
  ],
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  esbuild: { target: 'es2022' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Route TipTap + syntax highlighting into one lazy "editor" chunk,
          // matched by `mountEditor`'s dynamic import of `./editor/internal`.
          if (TIPTAP_DEPS.some((d) => id.includes(`node_modules/${d}`))) {
            return 'editor';
          }
        },
      },
    },
  },
});
