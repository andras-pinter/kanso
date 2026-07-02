// Pure helper extracted from KanbanBoard so react-refresh stays happy
// (component files can only export components).

import type { CardDto } from './types';

export interface DragEndContext {
  cardsByColumn: Record<string, CardDto[]>;
  /**
   * Per-column list of cards currently visible in the SortableContext (live
   * + passing the active tag filter). Omit when no filter is applied — the
   * resolver falls back to `cardsByColumn`.
   *
   * When present, drop targets are resolved in *filtered* space and then
   * translated to an absolute index in `cardsByColumn` so hidden cards keep
   * their relative order.
   */
  visibleCardsByColumn?: Record<string, CardDto[]>;
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
 * append after the last *visible* card).
 *
 * When `visibleCardsByColumn` is provided (i.e. a tag filter is active),
 * insertion points are computed in filtered space and translated back to
 * an absolute index so hidden cards preserve their ordering relative to
 * every other unmoved card.
 */
export function resolveDragEnd(
  activeId: string,
  overId: string | null,
  { cardsByColumn, visibleCardsByColumn }: DragEndContext,
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
    const fullTarget = cardsByColumn[targetColumnId] ?? [];
    const visibleTarget = visibleCardsByColumn?.[targetColumnId];
    if (!visibleTarget || visibleTarget.length === 0) {
      // No filter, or filter with no visible cards in the target — append
      // to the end of the full list (backwards-compatible behaviour).
      insertIndex = fullTarget.length;
    } else {
      // Append immediately after the last visible card so any hidden
      // cards past it stay past it in absolute space.
      const lastVisibleId = visibleTarget[visibleTarget.length - 1].id;
      const absIdx = fullTarget.findIndex((c) => c.id === lastVisibleId);
      insertIndex = absIdx >= 0 ? absIdx + 1 : fullTarget.length;
    }
  } else {
    // Over is a card id. It's always a visible card (hidden ones aren't in
    // any SortableContext), so its absolute index in the full list is the
    // correct "insert before this anchor" point.
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

/**
 * Mirror of `Column.tsx`'s per-column filter: live cards passing the AND
 * of every selected tag. Returns the input map unchanged when no filter
 * is active.
 */
export function computeVisibleCardsByColumn(
  cardsByColumn: Record<string, CardDto[]>,
  selectedTagIds: readonly string[],
  cardTagMap: Record<string, string[]>,
): Record<string, CardDto[]> {
  if (selectedTagIds.length === 0) return cardsByColumn;
  const out: Record<string, CardDto[]> = {};
  for (const [colId, list] of Object.entries(cardsByColumn)) {
    out[colId] = list.filter((c) => {
      const tags = cardTagMap[c.id] ?? [];
      return selectedTagIds.every((tid) => tags.includes(tid));
    });
  }
  return out;
}
