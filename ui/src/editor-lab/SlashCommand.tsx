import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import { createRoot, type Root } from 'react-dom/client';
import { createRef } from 'react';
import SlashMenu, { type SlashMenuHandle } from './SlashMenu';
import { filterSlashItems, SLASH_ITEMS, type SlashItem } from './slashItems';

/**
 * TipTap slash-command extension. Triggers on `/`, forwards filtered items
 * to a floating React menu, and executes the selected command.
 *
 * The menu is rendered into a portal div appended to <body>; the Suggestion
 * plugin drives its lifecycle (mount on start, update on filter, unmount on
 * exit) so ProseMirror stays the source of truth.
 */
export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        allowSpaces: false,
        items: ({ query }: { query: string }) => filterSlashItems(query),
        command: ({ editor, range, props }) => {
          (props as SlashItem).command({ editor, range });
        },
        render: () => {
          let container: HTMLDivElement | null = null;
          let root: Root | null = null;
          const handleRef = createRef<SlashMenuHandle>();

          const draw = (props: SuggestionProps<SlashItem>) => {
            if (!root || !container) return;
            root.render(
              <SlashMenu
                ref={handleRef}
                editor={props.editor}
                range={props.range}
                items={props.items.length ? props.items : SLASH_ITEMS.slice(0, 0)}
                clientRect={props.clientRect ?? null}
              />,
            );
          };

          return {
            onStart(props: SuggestionProps<SlashItem>) {
              container = document.createElement('div');
              document.body.appendChild(container);
              root = createRoot(container);
              draw(props);
            },
            onUpdate(props: SuggestionProps<SlashItem>) {
              draw(props);
            },
            onKeyDown(props: SuggestionKeyDownProps): boolean {
              if (props.event.key === 'Escape') return true;
              return handleRef.current?.onKeyDown(props.event) ?? false;
            },
            onExit() {
              root?.unmount();
              container?.remove();
              root = null;
              container = null;
            },
          };
        },
      } satisfies Partial<SuggestionOptions<SlashItem>>,
    };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
