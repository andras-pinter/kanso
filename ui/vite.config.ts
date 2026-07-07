import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import wasm from 'vite-plugin-wasm';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prebuildEditorIfNeeded } from './scripts/prebuild-editor-dev.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// Dev-only plugin. `vite dev` cannot ship BlockSuite because esbuild's
// dep-optimizer flattens `@blocksuite/data-view`'s circular import graph in
// the wrong order (`viewPresets` is built before `tableViewMeta` is assigned,
// so `viewPresets.tableViewMeta` is undefined at module-init time and the
// editor explodes). Rollup handles the same cycle correctly via live
// bindings, so on dev startup we run a real `vite build` over
// `src/editor/internal.ts` into `node_modules/.cache/kanso-editor-dev/`
// and serve that prebuilt artifact whenever something imports `./internal`
// from inside `src/editor/`.
//
// HMR consequences: changes to App.tsx / EditorDemo.tsx still hot-reload as
// normal (they live outside the prebuilt subtree). Changes inside
// `src/editor/*` require restarting `npm run dev` — the wrapper is small and
// changes rarely, so this is an acceptable trade for a working dev loop.
function prebuildEditor(): Plugin {
  const PREBUILT_ID = '\0kanso:prebuilt-editor';
  let cachedJsPath: string | null = null;
  let cachedCssPath: string | null = null;

  return {
    name: 'kanso:prebuild-editor',
    apply: 'serve',
    enforce: 'pre',
    async configResolved() {
      const start = Date.now();
      const { cached, outFile } = await prebuildEditorIfNeeded();
      cachedJsPath = outFile;
      cachedCssPath = path.join(path.dirname(outFile), 'kanso-ui.css');
      const ms = Date.now() - start;
      console.log(
        `[kanso] editor prebuild ${cached ? 'cached' : 'built'} (${ms}ms) — restart \`npm run dev\` after editing src/editor/*`
      );
    },
    resolveId(source, importer) {
      if (!importer || !cachedJsPath) return null;
      const fromEditorIndex =
        importer.includes(`${path.sep}src${path.sep}editor${path.sep}index.`) ||
        importer.endsWith('/src/editor/index.ts') ||
        importer.endsWith('/src/editor/index.tsx');
      if (!fromEditorIndex) return null;
      if (source === './internal' || source === './internal.ts') {
        return PREBUILT_ID;
      }
      return null;
    },
    load(id) {
      if (id !== PREBUILT_ID || !cachedJsPath || !cachedCssPath) return null;
      // Re-export the prebuilt module via `/@fs/` so vite serves it raw and
      // resolves the externalised `yjs` import against the dev server's copy
      // (single Y.Doc identity, shared with `plaintext.ts`).
      const jsUrl = `/@fs/${cachedJsPath}`;
      const cssUrl = `/@fs/${cachedCssPath}`;
      return `import ${JSON.stringify(cssUrl)};\nexport * from ${JSON.stringify(jsUrl)};\n`;
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    vanillaExtractPlugin(),
    wasm(),
    // Only active in dev (`apply: 'serve'`); prod still goes through the
    // rollup pipeline below.
    prebuildEditor(),
    visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true }),
  ],
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  esbuild: { target: 'es2022' },
  // Skip dep optimization of BlockSuite in dev. The prebuilt editor artifact
  // has every BlockSuite module inlined, but vite's import scanner walks
  // `src/editor/internal.ts` from disk before our plugin redirects it,
  // which would otherwise trigger a slow optimize pass + page reload for
  // ~50 packages we never actually load.
  optimizeDeps:
    command === 'serve'
      ? {
          exclude: [
            '@blocksuite/affine',
            '@blocksuite/store',
            '@blocksuite/sync',
            '@blocksuite/std',
            '@blocksuite/global',
            '@blocksuite/data-view',
            '@blocksuite/icons',
            '@blocksuite/affine-block-database',
            '@blocksuite/affine-block-table',
            '@blocksuite/affine-block-edgeless-text',
            '@blocksuite/affine-block-attachment',
            '@blocksuite/affine-block-bookmark',
            '@blocksuite/affine-block-data-view',
            '@blocksuite/affine-block-embed',
            '@blocksuite/affine-block-frame',
            '@blocksuite/affine-block-latex',
            '@blocksuite/affine-block-list',
            '@blocksuite/affine-block-note',
            '@blocksuite/affine-block-paragraph',
            '@blocksuite/affine-block-root',
            '@blocksuite/affine-block-code',
            '@blocksuite/affine-block-divider',
            '@blocksuite/affine-block-image',
            '@blocksuite/affine-block-callout',
            '@blocksuite/affine-block-surface',
            '@blocksuite/affine-inline-footnote',
            '@blocksuite/affine-inline-latex',
            '@blocksuite/affine-inline-link',
            '@blocksuite/affine-inline-mention',
            '@blocksuite/affine-inline-preset',
            '@blocksuite/affine-inline-reference',
            '@blocksuite/affine-foundation',
            '@blocksuite/affine-widget-drag-handle',
            '@blocksuite/affine-widget-toolbar',
            '@blocksuite/affine-widget-slash-menu',
            '@blocksuite/affine-widget-keyboard-toolbar',
            '@blocksuite/affine-widget-linked-doc',
            '@blocksuite/affine-widget-page-dragging-area',
            '@blocksuite/affine-widget-remote-selection',
            '@blocksuite/affine-widget-scroll-anchoring',
            '@blocksuite/affine-widget-viewport-overlay',
            '@toeverything/infra',
            '@toeverything/theme',
          ],
        }
      : undefined,
  // Allow vite to serve files under node_modules/.cache via /@fs/.
  server: {
    fs: {
      allow: [path.resolve(__dirname), path.resolve(__dirname, 'node_modules/.cache')],
    },
  },
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
}));
