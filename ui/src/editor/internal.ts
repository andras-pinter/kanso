import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Markdown } from 'tiptap-markdown';

import { BracketTaskItem } from './BracketTaskItem';
import { SlashCommand } from './SlashCommand';
import { lowlight } from './lowlight';
import type { EditorHandle, EditorOptions } from './types';
import './tiptap.css';
import 'highlight.js/styles/github.css';

const INDENT = '    ';

/** Tab inside a code block inserts 4 spaces; Shift-Tab strips up to 4 leading
 * spaces. Outside code blocks, Tab keeps StarterKit's default (list indent). */
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

interface MarkdownStorage {
  markdown?: { getMarkdown: () => string };
}

const readMarkdown = (editor: Editor): string =>
  (editor.storage as MarkdownStorage).markdown?.getMarkdown() ?? '';

export function mountEditor(container: HTMLElement, opts: EditorOptions = {}): EditorHandle {
  const mount = document.createElement('div');
  mount.className = 'kanso-tiptap';
  container.appendChild(mount);

  const editor = new Editor({
    element: mount,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockWithTab.configure({ lowlight, defaultLanguage: null }),
      Markdown.configure({ transformCopiedText: true, transformPastedText: true }),
      Placeholder.configure({ placeholder: opts.placeholder ?? "Type '/' for commands…" }),
      TaskList,
      BracketTaskItem.configure({ nested: true }),
      SlashCommand,
    ],
    content: opts.initialMarkdown ?? '',
  });

  const listeners = new Set<() => void>();
  const notify = () => {
    listeners.forEach((cb) => cb());
  };
  editor.on('update', notify);

  return {
    destroy() {
      editor.off('update', notify);
      listeners.clear();
      editor.destroy();
      mount.remove();
    },
    getMarkdown() {
      return readMarkdown(editor);
    },
    setMarkdown(md: string) {
      editor.commands.setContent(md, { emitUpdate: false });
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
