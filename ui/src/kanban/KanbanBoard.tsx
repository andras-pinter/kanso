// Top-level kanban board. Hosts the dnd-kit DndContext that handles BOTH
// card and column drags — they're disambiguated by the active id prefix
// (`col:` for columns).

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { isTauri } from './api/client';
import ColumnList from './ColumnList';
import CardDetailDrawer from './CardDetailDrawer';
import { CardOverlay } from './Card';
import { useKanbanStore } from './hooks/useKanbanStore';
import { useCmdK } from './hooks/useCmdK';
import ManageTagsDrawer from './ManageTagsDrawer';
import SearchPalette from './SearchPalette';
import { resolveDragEnd } from './dragEnd';
import { COLUMN_DRAG_PREFIX, filterCollidersForActive, parseColumnDragId, resolveColumnDragEnd } from './columnDragEnd';
import type { CardDto } from './types';
import './kanban.css';

export default function KanbanBoard() {
  const status = useKanbanStore((s) => s.status);
  const error = useKanbanStore((s) => s.error);
  const load = useKanbanStore((s) => s.load);
  const loadTags = useKanbanStore((s) => s.loadTags);
  const cardsByColumn = useKanbanStore((s) => s.cardsByColumn);
  const moveCard = useKanbanStore((s) => s.moveCard);
  const reorderColumn = useKanbanStore((s) => s.reorderColumn);
  const selectedCardId = useKanbanStore((s) => s.selectedCardId);
  const currentBoardId = useKanbanStore((s) => s.currentBoardId);
  const boardCreate = useKanbanStore((s) => s.boardCreate);
  const showArchived = useKanbanStore((s) => s.showArchived);
  const setShowArchived = useKanbanStore((s) => s.setShowArchived);

  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [manageTagsOpen, setManageTagsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useCmdK(useCallback(() => setPaletteOpen(true), []));

  useEffect(() => {
    if (!isTauri()) return;
    void load();
    void loadTags();
  }, [load, loadTags]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // Custom collision detection: during a column drag we only want to consider
  // other column sortables — card / body droppables shadow the column they
  // belong to and `closestCorners` would otherwise return a non-`col:` id,
  // which `resolveColumnDragEnd` rejects.
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const activeId = String(args.active.id);
    const allowed = new Set(
      filterCollidersForActive(
        activeId,
        args.droppableContainers.map((c) => String(c.id)),
      ),
    );
    const filtered = args.droppableContainers.filter((c) => allowed.has(String(c.id)));
    return closestCorners({ ...args, droppableContainers: filtered });
  }, []);

  const draggingCard = useMemo<CardDto | null>(() => {
    if (!draggingCardId) return null;
    for (const list of Object.values(cardsByColumn)) {
      const hit = list.find((c) => c.id === draggingCardId);
      if (hit) return hit;
    }
    return null;
  }, [draggingCardId, cardsByColumn]);

  const selectedCard = useMemo<CardDto | null>(() => {
    if (!selectedCardId) return null;
    for (const list of Object.values(cardsByColumn)) {
      const hit = list.find((c) => c.id === selectedCardId);
      if (hit) return hit;
    }
    return null;
  }, [selectedCardId, cardsByColumn]);

  const onDragStart = useCallback((e: DragStartEvent) => {
    const id = String(e.active.id);
    // Column drags don't need an overlay (dnd-kit's transform handles it);
    // only track card drags for the floating preview.
    if (!id.startsWith(COLUMN_DRAG_PREFIX)) setDraggingCardId(id);
  }, []);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDraggingCardId(null);
      const activeId = String(e.active.id);
      const overId = e.over ? String(e.over.id) : null;
      if (parseColumnDragId(activeId)) {
        const resolution = resolveColumnDragEnd(activeId, overId, {
          columns: useKanbanStore.getState().columns,
        });
        if (resolution) void reorderColumn(resolution);
        return;
      }
      const resolution = resolveDragEnd(activeId, overId, {
        cardsByColumn: useKanbanStore.getState().cardsByColumn,
      });
      if (!resolution) return;
      void moveCard(
        resolution.cardId,
        resolution.fromColumnId,
        resolution.targetColumnId,
        resolution.insertIndex,
      );
    },
    [moveCard, reorderColumn],
  );

  const onDragCancel = useCallback(() => setDraggingCardId(null), []);

  if (!isTauri()) {
    return (
      <div className="kanso-board">
        <p className="kanso-board-state">Kanban board is only available inside the Tauri shell.</p>
      </div>
    );
  }

  return (
    <div className="kanso-board">
      <div className="kanso-board-toolbar">
        <label className="kanso-toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => void setShowArchived(e.target.checked)}
          />
          <span>Show archived</span>
        </label>
        <button
          type="button"
          className="kanso-btn"
          onClick={() => setManageTagsOpen(true)}
          title="Manage tags"
        >
          🏷 Manage tags
        </button>
        <button
          type="button"
          className="kanso-btn"
          onClick={() => setPaletteOpen(true)}
          title="Search (⌘K)"
        >
          🔍 Search
        </button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {status === 'loading' && <p className="kanso-board-state">Loading…</p>}
        {status === 'error' && (
          <p className="kanso-board-state" role="alert">
            Failed to load: {error}
          </p>
        )}
        {status === 'ready' && currentBoardId === null && (
          <div className="kanso-empty">
            <h2>No boards yet</h2>
            <p>Create a board to start organizing your cards.</p>
            <button
              type="button"
              className="kanso-btn kanso-btn--primary"
              onClick={() => {
                const name = window.prompt('Board name', 'My board');
                if (name) void boardCreate(name);
              }}
            >
              + Create board
            </button>
          </div>
        )}
        {status === 'ready' && currentBoardId !== null && <ColumnList />}
        <DragOverlay>{draggingCard ? <CardOverlay card={draggingCard} /> : null}</DragOverlay>
      </DndContext>
      {selectedCard && <CardDetailDrawer key={selectedCard.id} card={selectedCard} />}
      {manageTagsOpen && <ManageTagsDrawer onClose={() => setManageTagsOpen(false)} />}
      {paletteOpen && <SearchPalette onClose={() => setPaletteOpen(false)} />}
      {error && status === 'ready' && (
        <div className="kanso-error" role="status">
          {error}
        </div>
      )}
    </div>
  );
}
