// Public API of the editor wrapper. `mountEditor` lazily imports BlockSuite so
// importing this module alone does NOT pull `@blocksuite/*` into the chunk.
// `extractPlaintext` only needs yjs and is safe to call synchronously.

import type { EditorHandle, EditorOptions } from './types';

export type { EditorHandle, EditorOptions } from './types';
export { extractPlaintext } from './plaintext';

export async function mountEditor(
  container: HTMLElement,
  opts: EditorOptions = {}
): Promise<EditorHandle> {
  const mod = await import('./internal');
  return mod.mountEditor(container, opts);
}
