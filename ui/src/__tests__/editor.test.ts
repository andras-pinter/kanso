import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { extractPlaintext } from '../editor/plaintext';

// We can't run BlockSuite inside Vitest reliably (it needs the full custom-element
// registration chain that the bundler wires up). Instead we hand-craft a Yjs doc
// that mirrors BlockSuite's storage layout, run it through extractPlaintext, and
// assert the FTS5-ready text output.
//
// Layout: ydoc.getMap('blocks') keyed by block id ->
//   sys:id, sys:flavour, sys:children: Y.Array<string>,
//   prop:title / prop:text: Y.Text | string

interface BlockSpec {
  id: string;
  flavour: string;
  title?: string;
  text?: string;
  children?: string[];
}

function addBlock(blocks: Y.Map<unknown>, spec: BlockSpec) {
  const m = new Y.Map<unknown>();
  m.set('sys:id', spec.id);
  m.set('sys:flavour', spec.flavour);
  const children = new Y.Array<string>();
  if (spec.children) children.push(spec.children);
  m.set('sys:children', children);
  if (spec.title !== undefined) {
    const t = new Y.Text();
    t.insert(0, spec.title);
    m.set('prop:title', t);
  }
  if (spec.text !== undefined) {
    const t = new Y.Text();
    t.insert(0, spec.text);
    m.set('prop:text', t);
  }
  blocks.set(spec.id, m);
}

function buildDoc(specs: BlockSpec[]): Y.Doc {
  const doc = new Y.Doc();
  const blocks = doc.getMap('blocks');
  for (const s of specs) addBlock(blocks, s);
  return doc;
}

describe('extractPlaintext', () => {
  it('walks heading + list + code blocks under a page root', () => {
    const doc = buildDoc([
      { id: 'root', flavour: 'affine:page', title: 'Doc Title', children: ['note'] },
      { id: 'note', flavour: 'affine:note', children: ['h1', 'p', 'l1', 'l2', 'code'] },
      { id: 'h1', flavour: 'affine:paragraph', text: 'Heading 1' },
      { id: 'p', flavour: 'affine:paragraph', text: 'A paragraph with bold.' },
      { id: 'l1', flavour: 'affine:list', text: 'First item' },
      { id: 'l2', flavour: 'affine:list', text: 'Second item' },
      { id: 'code', flavour: 'affine:code', text: 'fn main() { println!("hi"); }' },
    ]);

    const text = extractPlaintext(doc);

    expect(text).toBe(
      [
        'Doc Title',
        'Heading 1',
        'A paragraph with bold.',
        'First item',
        'Second item',
        'fn main() { println!("hi"); }',
      ].join('\n')
    );
  });

  it('roundtrips through a Yjs binary update', () => {
    const doc = buildDoc([
      { id: 'root', flavour: 'affine:page', title: 'Serialized', children: ['note'] },
      { id: 'note', flavour: 'affine:note', children: ['p'] },
      { id: 'p', flavour: 'affine:paragraph', text: 'Hello, world.' },
    ]);

    const bytes = Y.encodeStateAsUpdate(doc);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);

    const restored = extractPlaintext(bytes);
    expect(restored).toBe('Serialized\nHello, world.');
  });

  it('skips empty title / text gracefully and handles orphan blocks as roots', () => {
    const doc = buildDoc([
      { id: 'root', flavour: 'affine:page', title: '', children: ['p1'] },
      { id: 'p1', flavour: 'affine:paragraph', text: 'visible' },
      // Orphan block not referenced as anyone's child — should still show up.
      { id: 'orphan', flavour: 'affine:paragraph', text: 'orphan text' },
    ]);

    const text = extractPlaintext(doc);
    expect(text).toContain('visible');
    expect(text).toContain('orphan text');
    expect(text.split('\n')).not.toContain('');
  });

  it('handles raw string title/text values (root block proxy quirk)', () => {
    const doc = new Y.Doc();
    const blocks = doc.getMap('blocks');
    const root = new Y.Map<unknown>();
    root.set('sys:id', 'r');
    root.set('sys:flavour', 'affine:page');
    root.set('prop:title', 'Plain string title');
    root.set('sys:children', new Y.Array());
    blocks.set('r', root);

    expect(extractPlaintext(doc)).toBe('Plain string title');
  });

  // H1 regression: legacy textarea bodies (Wave 5) are auto-seeded into a
  // single paragraph block. Verify the seeded shape round-trips byte-for-byte
  // through extractPlaintext so the FTS index stays accurate after the
  // silent conversion.
  it('round-trips legacy plaintext seeded into a single paragraph block', () => {
    const inputs = [
      'hello world',
      'hello\nworld', // soft break inside one block
      'hello\n\nworld', // blank lines preserved verbatim inside one block
      'Find me with carrots — and 🥕',
    ];
    for (const input of inputs) {
      const doc = buildDoc([
        { id: 'root', flavour: 'affine:page', title: 'Untitled', children: ['note'] },
        { id: 'note', flavour: 'affine:note', children: ['p'] },
        { id: 'p', flavour: 'affine:paragraph', text: input },
      ]);
      // Page title 'Untitled' is part of the FTS plaintext too; the legacy
      // body content is appended on its own line.
      expect(extractPlaintext(doc)).toBe(`Untitled\n${input}`);
    }
  });
});
