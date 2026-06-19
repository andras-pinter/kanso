# kanso/ui

React 19 + BlockSuite editor wrapper for **kanso**. Bootstraps the editor
chunk used by the eventual Tauri app and exposes a tiny imperative API
(`mountEditor`, `extractPlaintext`).

## Quick start

```bash
nvm use            # node 20.11
npm install
npm run build      # tsc -b && vite build && bundle-size guard
npm run preview    # serve dist/ on http://localhost:4173
npm test           # vitest
npm run lint
```

> **`npm run dev` is broken** for BlockSuite right now. See *Known gaps*.

## Known gaps

### ❌ `vite dev` doesn't work

`vite-plugin-vanilla-extract` evaluates BlockSuite's `.css.ts` files via
`vite-node`, which trips on TypeScript decorators in transitive BlockSuite
imports. The error surfaces deep in the dep graph and there's no quick
config flip that fixes it. **Use `npm run build && npm run preview` while
iterating.**

This is **owned by Wave 2, Session D** — they'll evaluate
`@vanilla-extract/esbuild-plugin`, a pre-built editor bundle, or whatever
combination unblocks `tauri dev`. Don't try to fix it from this branch.

### ⚠️ BlockSuite source isn't typecheck-clean

`@blocksuite/affine` 0.22.x publishes raw `.ts` source via its `exports`
field. Those files contain genuine type errors (`Property 'x' is used before
its initialization`, Zod inference mismatches, etc.) that `skipLibCheck`
cannot suppress — it only ignores `.d.ts`.

Workaround: `tsconfig.app.json` `paths` redirects every `@blocksuite/*`
subpath to `src/blocksuite-stub.ts`, which exports every symbol we use as
`any`. tsc therefore types BlockSuite imports as `any` and never visits the
unbuildable source. Vite/Rollup ignore tsconfig paths, so at build/runtime
the real packages are bundled normally. Trade-off: editor wrapper code
(`src/editor/extensions.ts` + `src/editor/internal.ts`) sees BlockSuite
untyped. The **public surface stays strict** — `EditorHandle` /
`EditorOptions` in `src/editor/types.ts` are hand-typed and contain no `any`.

When a new BlockSuite symbol is needed in the editor wrapper, add it to
`src/blocksuite-stub.ts`. No forks, no patches, no `resolutions`.

### ⚠️ `@blocksuite/integration-test` as a production dep

`@blocksuite/integration-test` is technically a test package, but its
`TestAffineEditorContainer` (~190 lines) is the only working reference for
wiring a full editor together, and `effects/itEffects()` performs the
custom-element side-effect registration that nothing else triggers. We use
both in production. Marked with a `TECH DEBT` comment in `src/editor/internal.ts`.

If we ever outgrow this we'll have to recreate the container ourselves.
Until then: stay on the upstream version, never patch it.

## Why Vite is pinned to `^6.0.3`

Vite 7+ ships Rolldown and a newer plugin pipeline that chokes on
vanilla-extract's `.css.ts` decorator parsing inside transitive BlockSuite
imports. The official BlockSuite playground also stays on Vite 6. The pin
is recorded in `package.json` (`"//": "LOCKED: ..."`); please don't bump it
without first verifying the build still produces a < 2 MB editor chunk.

## Extension curation rationale

We compose the BlockSuite extension list manually instead of calling
`getInternalViewExtensions()` / `getInternalStoreExtensions()`. The default
helpers pull in `@atlaskit/*` (database/data-view), latex blocks,
attachment, bookmark, and a swarm of embeds — together about **0.45 MB
gzipped** of code we don't need for a Kanban app.

Curated total: **~1.68 MB gz** vs. **~2.13 MB gz** with the helpers. See
`src/editor/extensions.ts` for the list and per-package rationale. Note:
`affine:code` has a hard DI dep on `@blocksuite/affine-inline-latex` — the
inline extensions stay even if we never expose a latex block.

## Bundle budget

| Chunk    | Budget    | Current        |
| -------- | --------- | -------------- |
| `editor` | 2 MB gz   | ~1.42 MB gz    |
| `entry`  | (no cap)  | ~60 KB gz      |

`scripts/check-bundle-size.mjs` runs after every `vite build` and fails CI
if any chunk in `dist/assets/` exceeds 2 MB gzipped. The script prints the
top 10 chunks so drift is visible run-to-run. ~31% headroom today.

## Public API

```ts
import { mountEditor, extractPlaintext } from '@/editor';
import type { EditorHandle, EditorOptions } from '@/editor';

const handle: EditorHandle = await mountEditor(host, { initialDoc: bytes });
handle.onChange((bytes) => persist(bytes));
const text = handle.extractPlaintext();
// later:
const plain = extractPlaintext(bytes);   // no editor needed (FTS5 prep)
handle.destroy();
```

`mountEditor` lazily imports `@blocksuite/*` via dynamic `import()`. The
entry chunk contains zero BlockSuite code; the editor chunk only loads
when this function is called.

## Summary of the PoC findings

Full report: PoC `RESULTS.md` (kept in session-state, not committed).

- **🟢 GREEN** — all 8 acceptance criteria passed in Chromium + WebKit + manual Safari.
- Editor chunk 1.68 MB gz lazy, entry 61 KB gz with zero BlockSuite. Yjs binary roundtrips through localStorage cleanly.
- Root title lives at `model.props.title` (not `model.title`); plaintext walker handles both.
