import type { Editor, Range } from '@tiptap/core';

export interface SlashItem {
  title: string;
  hint?: string;
  keywords: string[];
  command: (args: { editor: Editor; range: Range }) => void;
}

/** Static command list. Ordered for the menu's default position. */
export const SLASH_ITEMS: SlashItem[] = [
  {
    title: 'Heading 1',
    hint: 'Big section title',
    keywords: ['h1', 'heading', 'title'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    hint: 'Medium section title',
    keywords: ['h2', 'heading'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    hint: 'Small section title',
    keywords: ['h3', 'heading'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    title: 'Bullet list',
    hint: 'Unordered list',
    keywords: ['bullet', 'ul', 'list'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Numbered list',
    hint: 'Ordered list',
    keywords: ['ordered', 'ol', 'number'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'Task list',
    hint: 'Checkbox list',
    keywords: ['todo', 'task', 'check'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: 'Quote',
    hint: 'Blockquote',
    keywords: ['quote', 'blockquote'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: 'Code block',
    hint: 'Fenced code',
    keywords: ['code', 'pre', 'fenced'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: 'Divider',
    hint: 'Horizontal rule',
    keywords: ['divider', 'hr', 'rule', 'separator'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true;
    return item.keywords.some((k) => k.includes(q));
  });
}
