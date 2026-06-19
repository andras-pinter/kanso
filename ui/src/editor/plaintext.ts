import * as Y from 'yjs';

// BlockSuite stores each block as a YMap under a top-level "blocks" YMap on the
// space doc. Each block YMap carries:
//   sys:id        — string
//   sys:flavour   — e.g. 'affine:paragraph'
//   sys:children  — YArray<string> of child block ids
//   prop:title    — YText | string (root block only)
//   prop:text     — YText | string (paragraph / list / code / etc.)
// We walk the forest from every block that isn't referenced as a child, which
// covers both `affine:page` roots and any orphaned blocks.

function stringify(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string') return val.length > 0 ? val : null;
  if (val instanceof Y.Text || val instanceof Y.XmlText) {
    const s = val.toString();
    return s.length > 0 ? s : null;
  }
  return null;
}

function walk(blocks: Y.Map<unknown>, id: string, out: string[]): void {
  const block = blocks.get(id);
  if (!(block instanceof Y.Map)) return;

  const title = stringify(block.get('prop:title'));
  if (title) out.push(title);
  const text = stringify(block.get('prop:text'));
  if (text) out.push(text);

  const children = block.get('sys:children');
  if (children instanceof Y.Array) {
    for (const childId of children.toArray()) {
      if (typeof childId === 'string') walk(blocks, childId, out);
    }
  }
}

function findRoots(blocks: Y.Map<unknown>): string[] {
  const all: string[] = [];
  const seenAsChild = new Set<string>();
  blocks.forEach((block, id) => {
    if (!(block instanceof Y.Map)) return;
    all.push(id);
    const children = block.get('sys:children');
    if (children instanceof Y.Array) {
      for (const cid of children.toArray()) {
        if (typeof cid === 'string') seenAsChild.add(cid);
      }
    }
  });
  return all.filter((id) => !seenAsChild.has(id));
}

function extractFromYDoc(ydoc: Y.Doc): string {
  const blocks = ydoc.getMap('blocks') as Y.Map<unknown>;
  const out: string[] = [];
  for (const rootId of findRoots(blocks)) walk(blocks, rootId, out);
  return out.join('\n');
}

/**
 * Decode a Yjs update and extract plaintext from the BlockSuite document.
 * Does not require a mounted editor — safe to call from FTS5 indexing paths.
 */
export function extractPlaintext(doc: Uint8Array): string;
export function extractPlaintext(doc: Y.Doc): string;
export function extractPlaintext(doc: Uint8Array | Y.Doc): string {
  if (doc instanceof Y.Doc) return extractFromYDoc(doc);
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, doc);
  return extractFromYDoc(ydoc);
}
