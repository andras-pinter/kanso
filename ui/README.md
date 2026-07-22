# kanso/ui

React 19 + TipTap card body editor for **kanso**. The editor is loaded
lazily into its own chunk and exposes a minimal imperative API
(`mountEditor` returning an `EditorHandle` with `getMarkdown()` /
`setMarkdown()` / `onChange()`).

## Kanban view

`src/kanban/` renders the seeded board ("Incoming" / "Todo" / "In
Progress" / "Done") via the Tauri commands in `src/kanban/api/client.ts`.
Features:

- Inline `+ Add card` per column (Enter submits, Esc cancels).
- Drag a card within or across columns; the reorder is optimistic and
  the backend's fractional position string replaces the row on success.
- Clicking a card opens the drawer with editable title, tags, due date,
  and a rich markdown body powered by TipTap.
- Hard delete from the card drawer (no archive; done means gone).

```bash
nvm use            # node 20.11
npm install
npm run dev        # vite dev server on http://localhost:5173
npm run build      # tsc -b && vite build && bundle-size guard
npm run preview    # serve dist/ on http://localhost:4173
npm test           # vitest
npm run lint
```

`npm run dev` starts in ~300 ms — the editor is a normal TipTap tree,
so there is no prebuild step or dep-optimizer workaround. HMR covers
everything, including files under `src/editor/*`.

## Editor

TipTap 3 with StarterKit (minus codeBlock), a lowlight-backed
`CodeBlockLowlight` with Tab-indent, `Placeholder`, `TaskList`, a
`BracketTaskItem` input rule (`[]` / `[ ]` / `[x]` at the start of a
line becomes a task item), a slash menu, and `tiptap-markdown` for
markdown round-tripping.

## Bundle budget

`scripts/check-bundle-size.mjs` runs after every `vite build` and fails
CI if any chunk in `dist/assets/` exceeds **512 KB gzipped**. The TipTap
editor chunk lands comfortably under that; the script prints the top 10
chunks so drift is visible run-to-run.

## Vite pin

`vite` stays on `^6.0.3` in `package.json`. Bumping past that is a
follow-up so any regression is bisectable.

## Public API

```ts
import { mountEditor } from '@/editor';
import type { EditorHandle, EditorOptions } from '@/editor';

const handle: EditorHandle = await mountEditor(host, {
  initialMarkdown: '# Notes',
});
handle.onChange(() => persist(handle.getMarkdown()));
// later:
handle.destroy();
```

`mountEditor` lazy-imports `./internal`, which in turn pulls in
`@tiptap/*` + `lowlight` + `highlight.js`. The entry chunk contains zero
editor code; the editor chunk only loads when this function is called.
