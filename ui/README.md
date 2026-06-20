# kanso/ui

React 19 + BlockSuite editor wrapper for **kanso**. Bootstraps the editor
chunk used by the eventual Tauri app and exposes a tiny imperative API
(`mountEditor`, `extractPlaintext`).

## Phase 1 UI

The Phase 1 surface is a single-board Kanban view rendered from
`src/kanban/`. It loads the seeded board ("To Do" / "In Progress" / "Done")
via the `default_column` / `columns_list` / `cards_list` Tauri commands and
supports:

- Inline `+ Add card` per column (Enter submits, Esc cancels, blur with
  content submits).
- Drag a card up / down within a column or across columns. Drops snap to
  the position of the card you hover, or append when you drop on empty
  column space. The reorder is applied optimistically; the backend's
  fractional position string replaces the optimistic row on success.
- Clicking a card opens a right-side drawer with editable title + plain
  `<textarea>` body. Field edits save on blur. The rich editor lands in
  Phase 2 — the existing `EditorDemo` lazy-load wiring is preserved
  behind the `DEBUG_EDITOR` flag in `App.tsx`.
- Archiving a card from the drawer (soft delete) — archived cards stay
  hidden in Phase 1.

Column reordering, board switching, and the rich-text editor in the
drawer are out of scope for Phase 1.

```bash
nvm use            # node 20.11
npm install
npm run dev        # vite dev server on http://localhost:5173 (see below)
npm run build      # tsc -b && vite build && bundle-size guard
npm run preview    # serve dist/ on http://localhost:4173
npm test           # vitest
npm run lint
```

## Dev loop (`npm run dev`)

Vite dev starts in ~300ms after a one-time **~12 s editor prebuild** on the
first run (cached under `node_modules/.cache/kanso-editor-dev/`). After that
the editor opens via the normal lazy import and renders in Chrome and
Safari.

- HMR is on for everything **outside** `src/editor/*` — the wrapper
  (`App.tsx`, `EditorDemo.tsx`, plain styles, etc.) hot-reloads as usual.
- Editing files **inside** `src/editor/*` requires restarting the dev
  server. The prebuild script is invalidated automatically when those files
  (or `package-lock.json`) change.
- Force a rebuild: `node scripts/prebuild-editor-dev.mjs --force`.

### Why the prebuild is needed

BlockSuite ships raw TypeScript via its `exports` field, and
`@blocksuite/data-view` has a circular import (`core` ↔ `view-presets` via
`pc/table-view-ui-logic`). Esbuild's dep-optimizer (what `vite dev` uses to
pre-bundle deps) flattens that cycle into a single chunk that emits
`viewPresets = { tableViewMeta }` before `var tableViewMeta = …`, so
`viewPresets.tableViewMeta` is `undefined` at module-init and the editor
explodes inside `affine-block-database`. Rollup (what `vite build` uses)
handles the same cycle correctly via live bindings.

Workaround: on dev startup we run a real rollup build of
`src/editor/internal.ts` into `node_modules/.cache/kanso-editor-dev/`, and a
small Vite plugin redirects `./internal` imports inside `src/editor/index.ts`
to that prebuilt artifact. See `scripts/prebuild-editor-dev.mjs` and the
`prebuildEditor()` plugin in `vite.config.ts`. The prod build is unaffected
(plugin is `apply: 'serve'`).

## Known gaps

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
| `entry`  | (no cap)  | ~78 KB gz      |

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
