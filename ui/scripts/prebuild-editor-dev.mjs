// Pre-build the BlockSuite editor subtree for dev mode.
//
// Why this exists: BlockSuite ships raw TypeScript via its `exports` field and
// `@blocksuite/data-view` has a circular import (`core/types.ts` imports from
// `view-presets`, which imports back through `pc/table-view-ui-logic` →
// `core`). Esbuild's dep-optimizer flattens that cycle into a single chunk
// emitting `viewPresets = { tableViewMeta }` BEFORE `var tableViewMeta = ...`,
// so `viewPresets.tableViewMeta` is `undefined` at module-init time and the
// editor explodes when `@blocksuite/affine-block-database/views/index.ts`
// runs `databaseBlockViews.map(v => [v.type, v])`.
//
// `vite build` (rollup) handles the same cycle correctly via live bindings.
// We can't fix esbuild and we can't fork BlockSuite, so on `vite dev` startup
// we run a real rollup build of the editor entry into a cache dir and serve
// that prebuilt artifact instead of letting vite-node touch it. The wrapper
// (App.tsx, EditorDemo.tsx) still HMRs normally; only changes inside
// src/editor/* require restarting the dev server.

import { build } from 'vite';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import wasm from 'vite-plugin-wasm';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(UI_ROOT, 'src/editor/internal.ts');
const CACHE_DIR = path.join(UI_ROOT, 'node_modules/.cache/kanso-editor-dev');
const STAMP_FILE = path.join(CACHE_DIR, '.stamp');

// Hash inputs that meaningfully change the prebuild output. Source files
// inside src/editor/* invalidate the cache; node_modules churn does not.
async function computeInputHash() {
  const editorDir = path.join(UI_ROOT, 'src/editor');
  const files = (await readdir(editorDir)).filter((f) => /\.(ts|tsx)$/.test(f));
  files.sort();
  const hash = createHash('sha256');
  for (const f of files) {
    const full = path.join(editorDir, f);
    const s = await stat(full);
    hash.update(`${f}:${s.size}:${s.mtimeMs}|`);
  }
  // Lockfile pins BlockSuite versions; bumping triggers a rebuild.
  try {
    const lock = await stat(path.join(UI_ROOT, 'package-lock.json'));
    hash.update(`lock:${lock.size}:${lock.mtimeMs}`);
  } catch {
    // no lockfile - ignore
  }
  return hash.digest('hex');
}

async function isCacheFresh(currentHash) {
  if (!existsSync(STAMP_FILE)) return false;
  try {
    const stamped = await readFile(STAMP_FILE, 'utf8');
    return stamped.trim() === currentHash;
  } catch {
    return false;
  }
}

export async function prebuildEditorIfNeeded({ force = false } = {}) {
  const hash = await computeInputHash();
  if (!force && (await isCacheFresh(hash))) {
    return { cached: true, outFile: path.join(CACHE_DIR, 'editor.js') };
  }

  await mkdir(CACHE_DIR, { recursive: true });

  await build({
    root: UI_ROOT,
    configFile: false,
    mode: 'development',
    logLevel: 'warn',
    plugins: [vanillaExtractPlugin(), wasm()],
    resolve: { extensions: ['.ts', '.tsx', '.js'] },
    esbuild: { target: 'es2022' },
    build: {
      target: 'es2022',
      outDir: CACHE_DIR,
      emptyOutDir: true,
      sourcemap: 'inline',
      minify: false,
      lib: {
        entry: ENTRY,
        formats: ['es'],
        fileName: () => 'editor.js',
      },
      rollupOptions: {
        // Keep yjs external so the wrapper and the prebuild share one Y.Doc
        // identity; BlockSuite cares about that.
        external: ['yjs'],
        output: {
          inlineDynamicImports: true,
          globals: { yjs: 'Y' },
        },
      },
    },
  });

  await writeFile(STAMP_FILE, hash);
  return { cached: false, outFile: path.join(CACHE_DIR, 'editor.js') };
}

// CLI entry: `node scripts/prebuild-editor-dev.mjs [--force]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const force = process.argv.includes('--force');
  const start = Date.now();
  const { cached, outFile } = await prebuildEditorIfNeeded({ force });
  const ms = Date.now() - start;
  console.log(`[prebuild-editor-dev] ${cached ? 'cached' : 'built'} ${outFile} in ${ms}ms`);
}
