// Top-level kanban board. Hosts the dnd-kit DndContext that handles
// card drags. Columns are fixed order — no column drag.

import { Keyboard, Plus, Search, Tag } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { isTauri } from './api/client';
import ColumnList from './ColumnList';
import BoardFilterBar from './BoardFilterBar';
import BoardMetaStrip from './BoardMetaStrip';
import CardDetailModal from './CardDetailModal';
import ErrorBoundary from '../ErrorBoundary';
import { CardOverlay } from './Card';
import { useKanbanStore } from './hooks/useKanbanStore';
import { useCmdF, useCmdK, useCmdN } from './hooks/useCmdK';
import ManageTagsDrawer from './ManageTagsDrawer';
import SearchPalette from './SearchPalette';
import QuickAddModal from '../quick-add/QuickAddModal';
import { useQuickAddOpenEvent } from '../quick-add/useQuickAddOpenEvent';
import { computeVisibleCardsByColumn, resolveDragEnd } from './dragEnd';
import type { CardListDto } from './types';
import { PromptDialog } from '../Dialog';
import ShortcutsOverlay from '../ShortcutsOverlay';
import { useShortcutsHotkey } from '../useShortcutsHotkey';
import './kanban.css';

export default function KanbanBoard() {
  const status = useKanbanStore((s) => s.status);
  const error = useKanbanStore((s) => s.error);
  const load = useKanbanStore((s) => s.load);
  const loadTags = useKanbanStore((s) => s.loadTags);
  const cardsByColumn = useKanbanStore((s) => s.cardsByColumn);
  const moveCard = useKanbanStore((s) => s.moveCard);
  const selectedCardId = useKanbanStore((s) => s.selectedCardId);
  const currentBoardId = useKanbanStore((s) => s.currentBoardId);
  const boardCreate = useKanbanStore((s) => s.boardCreate);

  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [manageTagsOpen, setManageTagsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [boardPromptOpen, setBoardPromptOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useCmdK(useCallback(() => setPaletteOpen(true), []));
  useCmdF(useCallback(() => setPaletteOpen(true), []));
  useCmdN(useCallback(() => setQuickAddOpen(true), []));
  useShortcutsHotkey(useCallback(() => setShortcutsOpen((v) => !v), []));
  useQuickAddOpenEvent(useCallback(() => setQuickAddOpen(true), []));

  useEffect(() => {
    if (!isTauri()) return;
    void load();
    void loadTags();
  }, [load, loadTags]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: {
        start: ['Space'],
        cancel: ['Escape'],
        end: ['Space'],
      },
    }),
  );

  const draggingCard = useMemo<CardListDto | null>(() => {
    if (!draggingCardId) return null;
    for (const list of Object.values(cardsByColumn)) {
      const hit = list.find((c) => c.id === draggingCardId);
      if (hit) return hit;
    }
    return null;
  }, [draggingCardId, cardsByColumn]);

  const selectedCard = useMemo<CardListDto | null>(() => {
    if (!selectedCardId) return null;
    for (const list of Object.values(cardsByColumn)) {
      const hit = list.find((c) => c.id === selectedCardId);
      if (hit) return hit;
    }
    return null;
  }, [selectedCardId, cardsByColumn]);

  const onDragStart = useCallback((e: DragStartEvent) => {
    setDraggingCardId(String(e.active.id));
  }, []);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDraggingCardId(null);
      const activeId = String(e.active.id);
      const overId = e.over ? String(e.over.id) : null;
      const state = useKanbanStore.getState();
      const resolution = resolveDragEnd(activeId, overId, {
        cardsByColumn: state.cardsByColumn,
        visibleCardsByColumn: computeVisibleCardsByColumn(
          state.cardsByColumn,
          state.selectedTagIds,
          state.cardTagMap,
        ),
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
        <button
          type="button"
          className="kanso-btn kanso-btn--icon"
          onClick={() => setManageTagsOpen(true)}
          title="Manage tags"
        >
          <Tag size={14} aria-hidden="true" />
          <span>Manage tags</span>
        </button>
        <button
          type="button"
          className="kanso-btn kanso-btn--icon"
          onClick={() => setPaletteOpen(true)}
          title="Search (⌘F)"
        >
          <Search size={14} aria-hidden="true" />
          <span>Search</span>
          <kbd className="kanso-kbd">⌘F</kbd>
        </button>
        <button
          type="button"
          className="kanso-btn kanso-btn--icon"
          onClick={() => setQuickAddOpen(true)}
          title="Quick add (⌘N)"
        >
          <Plus size={14} aria-hidden="true" />
          <span>Quick add</span>
          <kbd className="kanso-kbd">⌘N</kbd>
        </button>
        <button
          type="button"
          className="kanso-btn kanso-btn--icon"
          onClick={() => setShortcutsOpen(true)}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          <Keyboard size={14} aria-hidden="true" />
          <kbd className="kanso-kbd">?</kbd>
        </button>
      </div>
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
        {status === 'ready' && currentBoardId === null && (
          <div className="kanso-empty">
            <h2>No boards yet</h2>
            <p>Create a board to start organizing your cards.</p>
            <button
              type="button"
              className="kanso-btn kanso-btn--primary kanso-btn--icon"
              onClick={() => setBoardPromptOpen(true)}
            >
              <Plus size={14} aria-hidden="true" />
              <span>Create board</span>
            </button>
          </div>
        )}
        {status === 'ready' && currentBoardId !== null && (
          <>
            <BoardMetaStrip />
            <BoardFilterBar />
            <ColumnList />
          </>
        )}
        <DragOverlay>{draggingCard ? <CardOverlay card={draggingCard} /> : null}</DragOverlay>
      </DndContext>
      {selectedCard && (
        <ErrorBoundary onReset={() => useKanbanStore.getState().selectCard(null)}>
          <CardDetailModal key={selectedCard.id} card={selectedCard} />
        </ErrorBoundary>
      )}
      {manageTagsOpen && <ManageTagsDrawer onClose={() => setManageTagsOpen(false)} />}
      {paletteOpen && <SearchPalette onClose={() => setPaletteOpen(false)} />}
      {quickAddOpen && <QuickAddModal onClose={() => setQuickAddOpen(false)} />}
      <PromptDialog
        open={boardPromptOpen}
        title="Create board"
        label="Board name"
        initialValue="My board"
        submitLabel="Create"
        onSubmit={(name) => {
          setBoardPromptOpen(false);
          void boardCreate(name);
        }}
        onCancel={() => setBoardPromptOpen(false)}
      />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {error && status === 'ready' && (
        <div className="kanso-error" role="status">
          {error}
        </div>
      )}
    </div>
  );
}
