// Pure resolver for column reordering.
//
// dnd-kit ids in the column SortableContext are `col:<id>` so a card-drag
// and a column-drag can coexist in the same DndContext without collisions.
//
// We model the move with dnd-kit's standard sortable arithmetic
// (`arrayMove(items, from, to)`), so the resolved order matches what the
// user sees during live reflow — including dropping past the last column.

import { arrayMove } from '@dnd-kit/sortable';
import type { ColumnDto } from './types';

export const COLUMN_DRAG_PREFIX = 'col:';

export const columnDragId = (id: string): string => `${COLUMN_DRAG_PREFIX}${id}`;

export const parseColumnDragId = (id: string): string | null =>
  id.startsWith(COLUMN_DRAG_PREFIX) ? id.slice(COLUMN_DRAG_PREFIX.length) : null;

/**
 * Filter droppable ids by the kind of drag in progress. During a column
 * drag we want only `col:` ids (the column sortables); during a card drag
 * we want only non-`col:` ids (card sortables and column body droppables).
 *
 * `closestCorners` otherwise reports nested cards / body droppables when
 * the cursor is over a column with cards, which `resolveColumnDragEnd`
 * rejects — making column drops onto populated columns silently fail.
 */
export function filterCollidersForActive(activeId: string, ids: readonly string[]): string[] {
  const isColumnDrag = activeId.startsWith(COLUMN_DRAG_PREFIX);
  return ids.filter((id) =>
    isColumnDrag ? id.startsWith(COLUMN_DRAG_PREFIX) : !id.startsWith(COLUMN_DRAG_PREFIX),
  );
}

export interface ColumnDragContext {
  columns: readonly ColumnDto[];
}

export interface ColumnDragResolution {
  columnId: string;
  /** Final list after the move (live columns only). */
  reordered: ColumnDto[];
}

/**
 * Resolve a column-drag drop. Returns the post-move ordering and the
 * moved column id, or null when nothing should change.
 *
 * Only LIVE columns participate — archived columns are not sortable.
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

  const live = columns.filter((c) => c.archived_at === null);
  const fromIdx = live.findIndex((c) => c.id === activeColumnId);
  const overIdx = live.findIndex((c) => c.id === overColumnId);
  if (fromIdx < 0 || overIdx < 0) return null;

  const reordered = arrayMove(live.slice(), fromIdx, overIdx);
  return { columnId: activeColumnId, reordered };
}

/**
 * Build `{ before?, after? }` for `column_move` from the post-move column
 * list and the moved column's id. `before` = lower-position neighbour,
 * `after` = higher-position neighbour, matching backend semantics.
 */
export function computeColumnAnchors(
  reordered: readonly ColumnDto[],
  columnId: string,
): { before?: string; after?: string } {
  const idx = reordered.findIndex((c) => c.id === columnId);
  if (idx < 0) return {};
  const prev = reordered[idx - 1];
  const next = reordered[idx + 1];
  const anchors: { before?: string; after?: string } = {};
  if (prev) anchors.before = prev.id;
  if (next) anchors.after = next.id;
  return anchors;
}

/**
 * Apply a resolution to the full column list (preserving archived columns
 * in their original positions relative to the live ones).
 */
export function applyColumnReorder(
  columns: readonly ColumnDto[],
  resolution: ColumnDragResolution,
): ColumnDto[] {
  const liveOrder = resolution.reordered.map((c) => c.id);
  const liveById = new Map(resolution.reordered.map((c) => [c.id, c]));
  const result: ColumnDto[] = [];
  let liveCursor = 0;
  for (const col of columns) {
    if (col.archived_at !== null) {
      result.push(col);
      continue;
    }
    const id = liveOrder[liveCursor++];
    if (id) {
      const fresh = liveById.get(id);
      if (fresh) result.push(fresh);
    }
  }
  return result;
}
