import { useEffect, useMemo, useRef, useState } from 'react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Markdown } from 'tiptap-markdown';

const INDENT = '    ';

/** Tab in a code block inserts 4 spaces; Shift-Tab removes up to 4 leading
 * spaces from the current line. Outside code blocks Tab keeps its default
 * behavior (list indentation). */
const CodeBlockWithTab = CodeBlockLowlight.extend({
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (!this.editor.isActive('codeBlock')) return false;
        const { state, view } = this.editor;
        view.dispatch(state.tr.insertText(INDENT).scrollIntoView());
        return true;
      },
      'Shift-Tab': () => {
        if (!this.editor.isActive('codeBlock')) return false;
        const { state, view } = this.editor;
        const { $from } = state.selection;
        const lineStart = $from.start();
        const before = state.doc.textBetween(lineStart, $from.pos, '\n');
        const nl = before.lastIndexOf('\n');
        const lineFrom = lineStart + nl + 1;
        const lineText = state.doc.textBetween(lineFrom, $from.pos, '\n');
        const strip = /^ {1,4}/.exec(lineText)?.[0].length ?? 0;
        if (!strip) return true;
        view.dispatch(state.tr.delete(lineFrom, lineFrom + strip).scrollIntoView());
        return true;
      },
    };
  },
});
import { BracketTaskItem } from './BracketTaskItem';
import { SlashCommand } from './SlashCommand';
import { SEED_MARKDOWN } from './seed';
import { lowlight } from './lowlight';
import './tiptap.css';
import 'highlight.js/styles/github.css';

interface Toolbar {
  editor: Editor;
}

function ToolbarButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 8px',
        background: active ? 'var(--kanso-accent, #2563eb)' : 'transparent',
        color: active ? 'white' : 'inherit',
        border: '1px solid var(--kanso-border, #ddd)',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 12,
      }}
    >
      {label}
    </button>
  );
}

function Toolbar({ editor }: Toolbar) {
  const [, force] = useState(0);
  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    editor.on('selectionUpdate', rerender);
    editor.on('transaction', rerender);
    return () => {
      editor.off('selectionUpdate', rerender);
      editor.off('transaction', rerender);
    };
  }, [editor]);

  const chain = () => editor.chain().focus();

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingBottom: 8 }}>
      <ToolbarButton label="B" active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()} />
      <ToolbarButton label="I" active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()} />
      <ToolbarButton label="S" active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()} />
      <ToolbarButton label="</>" active={editor.isActive('code')} onClick={() => chain().toggleCode().run()} />
      <span style={{ width: 8 }} />
      <ToolbarButton label="H1" active={editor.isActive('heading', { level: 1 })} onClick={() => chain().toggleHeading({ level: 1 }).run()} />
      <ToolbarButton label="H2" active={editor.isActive('heading', { level: 2 })} onClick={() => chain().toggleHeading({ level: 2 }).run()} />
      <ToolbarButton label="H3" active={editor.isActive('heading', { level: 3 })} onClick={() => chain().toggleHeading({ level: 3 }).run()} />
      <span style={{ width: 8 }} />
      <ToolbarButton label="• List" active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()} />
      <ToolbarButton label="1. List" active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()} />
      <ToolbarButton label="☐ Task" active={editor.isActive('taskList')} onClick={() => chain().toggleTaskList().run()} />
      <ToolbarButton label="❝ Quote" active={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()} />
      <ToolbarButton label="{ } Code" active={editor.isActive('codeBlock')} onClick={() => chain().toggleCodeBlock().run()} />
      <ToolbarButton label="―" active={false} onClick={() => chain().setHorizontalRule().run()} />
      <span style={{ width: 8 }} />
      <ToolbarButton label="↶" active={false} onClick={() => chain().undo().run()} />
      <ToolbarButton label="↷" active={false} onClick={() => chain().redo().run()} />
    </div>
  );
}

export default function Playground() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [markdown, setMarkdown] = useState<string>(SEED_MARKDOWN);
  const [dumped, setDumped] = useState<string | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const el = hostRef.current;
    const mount = document.createElement('div');
    mount.className = 'kanso-tiptap';
    mount.style.cssText = 'min-height:280px;padding:8px;outline:none;';
    el.appendChild(mount);

    const instance = new Editor({
      element: mount,
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        CodeBlockWithTab.configure({ lowlight, defaultLanguage: null }),
        Markdown.configure({ transformCopiedText: true, transformPastedText: true }),
        Placeholder.configure({ placeholder: "Type '/' for commands…" }),
        TaskList,
        BracketTaskItem.configure({ nested: true }),
        SlashCommand,
      ],
      content: SEED_MARKDOWN,
      onUpdate: ({ editor: ed }) => {
        const md =
          (ed.storage as { markdown?: { getMarkdown: () => string } }).markdown?.getMarkdown() ?? '';
        setMarkdown(md);
      },
    });
    setEditor(instance);

    return () => {
      instance.destroy();
      setEditor(null);
      mount.remove();
    };
  }, []);

  const help = useMemo(
    () => [
      { keys: '/', text: 'Slash menu (headings, lists, quote, code, divider, task list)' },
      { keys: '[] ', text: 'Convert to task item (also [ ] and [x])' },
      { keys: '# / ## / ###', text: 'Headings' },
      { keys: '- / *', text: 'Bullet list' },
      { keys: '1.', text: 'Ordered list' },
      { keys: '> ', text: 'Blockquote' },
      { keys: '```', text: 'Code block' },
      { keys: '**bold** / *italic* / ~~strike~~ / `code`', text: 'Inline marks' },
    ],
    [],
  );

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <header>
        <h2 style={{ margin: '0 0 4px' }}>TipTap showcase</h2>
        <small style={{ opacity: 0.7 }}>
          Slash menu, `[]` → task item, markdown round-trip. This is the lab — real card editor untouched.
        </small>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {editor && <Toolbar editor={editor} />}
          <div
            ref={hostRef}
            style={{
              border: '1px solid var(--kanso-border, #ddd)',
              borderRadius: 4,
              flex: 1,
              overflow: 'auto',
              background: 'var(--kanso-bg, transparent)',
            }}
          />
          <div style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
            <button
              type="button"
              onClick={() => {
                if (!editor) return;
                const md =
                  (editor.storage as { markdown?: { getMarkdown: () => string } }).markdown?.getMarkdown() ?? '';
                setDumped(md);
              }}
            >
              Dump markdown
            </button>
            <button
              type="button"
              onClick={() => {
                if (!editor) return;
                editor.commands.setContent(SEED_MARKDOWN);
              }}
            >
              Reset to seed
            </button>
          </div>
        </div>
        <aside
          style={{
            border: '1px solid var(--kanso-border, #ddd)',
            borderRadius: 4,
            padding: 12,
            overflow: 'auto',
            fontSize: 13,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Shortcuts</h3>
          <ul style={{ paddingLeft: 16, margin: 0 }}>
            {help.map((h) => (
              <li key={h.keys} style={{ marginBottom: 6 }}>
                <code style={{ background: 'var(--kanso-bg-subtle, #f0f0f0)', padding: '1px 4px', borderRadius: 3 }}>
                  {h.keys}
                </code>{' '}
                {h.text}
              </li>
            ))}
          </ul>
          <h3>Live markdown ({markdown.length} chars)</h3>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: 'var(--kanso-bg-subtle, #f7f7f7)',
              padding: 8,
              borderRadius: 4,
              fontSize: 11,
              maxHeight: 240,
              overflow: 'auto',
            }}
          >
            {markdown}
          </pre>
          {dumped !== null && (
            <>
              <h3>Dumped</h3>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  background: 'var(--kanso-bg-subtle, #f7f7f7)',
                  padding: 8,
                  borderRadius: 4,
                  fontSize: 11,
                  maxHeight: 240,
                  overflow: 'auto',
                }}
              >
                {dumped}
              </pre>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
