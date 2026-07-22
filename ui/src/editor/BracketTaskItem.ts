import { InputRule } from '@tiptap/core';
import TaskItem from '@tiptap/extension-task-item';

/**
 * Turn `[] ` or `[ ] ` (with optional `x`) at the start of an empty line into
 * a task item. TipTap normally requires `- [ ] `; this drops the leading dash.
 *
 * Trigger fires when the space is typed, so the caret lands cleanly after
 * conversion.
 */
export const BracketTaskItem = TaskItem.extend({
  addInputRules() {
    return [
      new InputRule({
        find: /^\[([ xX]?)\]\s$/,
        handler: ({ state, range, match, chain }) => {
          const checked = match[1]?.toLowerCase() === 'x';
          const $from = state.doc.resolve(range.from);
          const blockRange = $from.blockRange();
          if (!blockRange) return;
          chain()
            .deleteRange({ from: range.from, to: range.to })
            .wrapInList(this.type.name === 'taskItem' ? 'taskList' : this.type.name)
            .updateAttributes('taskItem', { checked })
            .run();
        },
      }),
    ];
  },
});
