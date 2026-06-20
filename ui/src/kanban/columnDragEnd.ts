// Pure resolver for column reordering. Mirrors `dragEnd.ts` 1:1.
//
// dnd-kit ids in the column SortableContext are `col:<id>` so a card-drag
// and a column-drag can coexist in the same DndContext without collisions.

import type { ColumnDto } from './types';

export const COLUMN_DRAG_PREFIX = 'col:';

export const columnDragId = (id: string): string => `${COLUMN_DRAG_PREFIX}${id}`;

export const parseColumnDragId = (id: string): string | null =>
  id.startsWith(COLUMN_DRAG_PREFIX) ? id.slice(COLUMN_DRAG_PREFIX.length) : null;

export interface ColumnDragContext {
  columns: readonly ColumnDto[];
}

export interface ColumnDragResolution {
  columnId: string;
  /** Post-removal insertion index. */
  insertIndex: number;
}

/**
 * Resolve a column-drag drop into `{ columnId, insertIndex }` where
 * `insertIndex` is the slot in the column list *after* removing the moved
 * column. Returns null if nothing should change.
 */
export function resolveColumnDragEnd(
  activeId: string,
  overId: string | null,
  { columns }: ColumnDragContext,
): ColumnDragResolution | null {
  if (!overId) return null;

  const activeColumnId = parseColumnDragId(activeId);
  const overColumnId = parseColumnDragId(overId);
  if (!activeColumnId || !overColumnId) return null;
  if (activeColumnId === overColumnId) return null;

  const fromIdx = columns.findIndex((c) => c.id === activeColumnId);
  const overIdx = columns.findIndex((c) => c.id === overColumnId);
  if (fromIdx < 0 || overIdx < 0) return null;

  // After removal, indices >= fromIdx shift down by one. If we'd land on
  // the same visible slot the move is a no-op.
  const effectiveInsert = overIdx > fromIdx ? overIdx - 1 : overIdx;
  if (effectiveInsert === fromIdx) return null;

  return { columnId: activeColumnId, insertIndex: effectiveInsert };
}

/**
 * Build `{ before?, after? }` for `column_move` from the post-removal column
 * list and the desired insertion index. Same convention as `computeAnchors`
 * for cards: `before` is set when there's a column at that slot (the new
 * column should land in front of it); empty when appending to the end.
 */
export function computeColumnAnchors(
  withoutMoved: readonly ColumnDto[],
  insertIndex: number,
): { before?: string; after?: string } {
  const target = withoutMoved[insertIndex];
  if (target) return { before: target.id };
  return {};
}

/**
 * Apply a resolution to a column list optimistically.
 */
export function applyColumnReorder(
  columns: readonly ColumnDto[],
  resolution: ColumnDragResolution,
): ColumnDto[] {
  const without = columns.filter((c) => c.id !== resolution.columnId);
  const moving = columns.find((c) => c.id === resolution.columnId);
  if (!moving) return columns.slice();
  const clamped = Math.max(0, Math.min(resolution.insertIndex, without.length));
  return [...without.slice(0, clamped), moving, ...without.slice(clamped)];
}
