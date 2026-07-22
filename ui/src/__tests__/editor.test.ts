import { describe, expect, it } from 'vitest';
import { mountEditor } from '../editor';

// TipTap needs a real DOM; happy-dom (configured in vitest.config) provides
// enough of it to mount and inspect the ProseMirror view.
describe('editor', () => {
  it('mounts with markdown and round-trips it via getMarkdown()', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const handle = await mountEditor(host, {
      initialMarkdown: '# Heading\n\nA paragraph.',
    });

    try {
      const md = handle.getMarkdown();
      expect(md).toContain('# Heading');
      expect(md).toContain('A paragraph.');
    } finally {
      handle.destroy();
      host.remove();
    }
  });

  it('starts empty when no initialMarkdown is provided', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const handle = await mountEditor(host);
    try {
      expect(handle.getMarkdown().trim()).toBe('');
    } finally {
      handle.destroy();
      host.remove();
    }
  });

  it('setMarkdown updates content silently (does not fire onChange)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const handle = await mountEditor(host);
    let calls = 0;
    const unsubscribe = handle.onChange(() => {
      calls += 1;
    });
    try {
      handle.setMarkdown('changed');
      expect(handle.getMarkdown()).toContain('changed');
      expect(calls).toBe(0);
    } finally {
      unsubscribe();
      handle.destroy();
      host.remove();
    }
  });
});
