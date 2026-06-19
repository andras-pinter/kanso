import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import wasm from 'vite-plugin-wasm';
import { visualizer } from 'rollup-plugin-visualizer';

const EDITOR_DEPS = [
  '@blocksuite',
  'lit',
  '@lit',
  '@preact/signals-core',
  '@floating-ui',
  '@toeverything',
  '@lottiefiles',
  'zod',
  'rxjs',
  'nanoid',
  '@blocksuite/icons',
];

export default defineConfig({
  plugins: [
    react(),
    vanillaExtractPlugin(),
    wasm(),
    visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true }),
  ],
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  esbuild: { target: 'es2022' },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Warn when any single chunk crosses 2 MB raw — the editor chunk is the
    // big one and `scripts/check-bundle-size.mjs` enforces a 2 MB gzipped ceiling.
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Route all heavy BlockSuite-graph deps into one lazy "editor" chunk.
          // yjs/lib0 deliberately omitted so the plaintext extractor can be
          // statically imported from the entry without dragging BlockSuite in.
          if (EDITOR_DEPS.some((d) => id.includes(`node_modules/${d}/`))) {
            return 'editor';
          }
        },
      },
    },
  },
});
