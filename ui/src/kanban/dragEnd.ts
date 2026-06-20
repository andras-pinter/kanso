// Pure helper extracted from KanbanBoard so react-refresh stays happy
// (component files can only export components).

import type { CardDto } from './types';

export interface DragEndContext {
  cardsByColumn: Record<string, CardDto[]>;
}

export interface DragEndResolution {
  cardId: string;
  fromColumnId: string;
  targetColumnId: string;
  insertIndex: number;
}

/**
 * Given the active/over ids from dnd-kit and the current card layout,
 * produce the move arguments — or null if nothing should change.
 *
 * `overId` is either a card id (drop on another card -> insert before) or
 * a column droppable id of the form `column:<id>` (drop on column body ->
 * append).
 */
export function resolveDragEnd(
  activeId: string,
  overId: string | null,
  { cardsByColumn }: DragEndContext,
): DragEndResolution | null {
  if (!overId) return null;

  let fromColumnId: string | null = null;
  for (const [colId, list] of Object.entries(cardsByColumn)) {
    if (list.some((c) => c.id === activeId)) {
      fromColumnId = colId;
      break;
    }
  }
  if (!fromColumnId) return null;

  let targetColumnId: string | null = null;
  let insertIndex = 0;

  if (overId.startsWith('column:')) {
    targetColumnId = overId.slice('column:'.length);
    insertIndex = (cardsByColumn[targetColumnId] ?? []).length;
  } else {
    for (const [colId, list] of Object.entries(cardsByColumn)) {
      const idx = list.findIndex((c) => c.id === overId);
      if (idx >= 0) {
        targetColumnId = colId;
        insertIndex = idx;
        break;
      }
    }
  }
  if (!targetColumnId) return null;

  if (activeId === overId) return null;

  if (fromColumnId === targetColumnId) {
    const list = cardsByColumn[fromColumnId] ?? [];
    const currentIdx = list.findIndex((c) => c.id === activeId);
    // After removal, indices >= currentIdx shift down by one. Skip when
    // the visible position would be unchanged.
    const effectiveInsert = insertIndex > currentIdx ? insertIndex - 1 : insertIndex;
    if (effectiveInsert === currentIdx) return null;
    return {
      cardId: activeId,
      fromColumnId,
      targetColumnId,
      insertIndex: effectiveInsert,
    };
  }

  return { cardId: activeId, fromColumnId, targetColumnId, insertIndex };
}
