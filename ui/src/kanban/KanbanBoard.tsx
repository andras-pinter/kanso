// Top-level kanban board. Owns the dnd-kit DndContext + drag-end logic
// that translates a drop event into a `card_move` call.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { isTauri } from './api/client';
import ColumnList from './ColumnList';
import CardDetailDrawer from './CardDetailDrawer';
import { CardOverlay } from './Card';
import { useKanbanStore } from './hooks/useKanbanStore';
import { resolveDragEnd } from './dragEnd';
import type { CardDto } from './types';
import './kanban.css';

export default function KanbanBoard() {
  const status = useKanbanStore((s) => s.status);
  const error = useKanbanStore((s) => s.error);
  const load = useKanbanStore((s) => s.load);
  const cardsByColumn = useKanbanStore((s) => s.cardsByColumn);
  const moveCard = useKanbanStore((s) => s.moveCard);
  const selectedCardId = useKanbanStore((s) => s.selectedCardId);

  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void load();
  }, [load]);

  const sensors = useSensors(
    // 4 px activation lets click handlers on cards fire without triggering
    // a phantom drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const draggingCard = useMemo<CardDto | null>(() => {
    if (!draggingId) return null;
    for (const list of Object.values(cardsByColumn)) {
      const hit = list.find((c) => c.id === draggingId);
      if (hit) return hit;
    }
    return null;
  }, [draggingId, cardsByColumn]);

  const selectedCard = useMemo<CardDto | null>(() => {
    if (!selectedCardId) return null;
    for (const list of Object.values(cardsByColumn)) {
      const hit = list.find((c) => c.id === selectedCardId);
      if (hit) return hit;
    }
    return null;
  }, [selectedCardId, cardsByColumn]);

  const onDragStart = useCallback((e: DragStartEvent) => {
    setDraggingId(String(e.active.id));
  }, []);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDraggingId(null);
      const activeId = String(e.active.id);
      const overId = e.over ? String(e.over.id) : null;
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
    [moveCard],
  );

  const onDragCancel = useCallback(() => setDraggingId(null), []);

  if (!isTauri()) {
    return (
      <div className="kanso-board">
        <p className="kanso-board-state">Kanban board is only available inside the Tauri shell.</p>
      </div>
    );
  }

  return (
    <div className="kanso-board">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
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
        {status === 'ready' && <ColumnList />}
        <DragOverlay>{draggingCard ? <CardOverlay card={draggingCard} /> : null}</DragOverlay>
      </DndContext>
      {selectedCard && <CardDetailDrawer key={selectedCard.id} card={selectedCard} />}
      {error && status === 'ready' && (
        <div className="kanso-error" role="status">
          {error}
        </div>
      )}
    </div>
  );
}
