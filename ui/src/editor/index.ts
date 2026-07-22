// Public API of the editor wrapper. `mountEditor` lazy-imports TipTap so
// pulling in this module alone does NOT bundle @tiptap/* into the main chunk.

import type { EditorHandle, EditorOptions } from './types';

export type { EditorHandle, EditorOptions } from './types';

export async function mountEditor(
  container: HTMLElement,
  opts: EditorOptions = {},
): Promise<EditorHandle> {
  const mod = await import('./internal');
  return mod.mountEditor(container, opts);
}
