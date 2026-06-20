// Zustand store for the kanban view.
// Holds columns + cards-by-column and exposes API-backed mutations with
// optimistic updates. The server is the source of truth for `position`
// strings — on every mutation we replace the optimistic row with the
// DTO returned by the backend.

import { create } from 'zustand';
import {
  cardArchive,
  cardCreate,
  cardMove,
  cardUpdate,
  cardsList,
  columnsList,
  defaultColumn,
} from '../api/client';
import type { CardDto, CardPatch, ColumnDto } from '../types';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface KanbanState {
  status: Status;
  error: string | null;
  boardId: string | null;
  columns: ColumnDto[];
  cardsByColumn: Record<string, CardDto[]>;
  selectedCardId: string | null;

  load: () => Promise<void>;
  selectCard: (id: string | null) => void;
  addCard: (columnId: string, title: string) => Promise<void>;
  updateCard: (id: string, patch: CardPatch) => Promise<void>;
  archiveCard: (id: string) => Promise<void>;
  moveCard: (
    cardId: string,
    fromColumnId: string,
    targetColumnId: string,
    insertIndex: number,
  ) => Promise<void>;
}

function formatError(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const err = e as { kind?: string; message?: string };
    return `${err.kind ?? 'error'}: ${err.message ?? String(e)}`;
  }
  return String(e);
}

// Build the {before, after} payload from an insertion index relative to
// the post-removal target column. Pass `before` whenever there's a card
// at `insertIndex`; otherwise we're appending to the end.
export function computeAnchors(
  targetCards: readonly CardDto[],
  insertIndex: number,
): { before?: string; after?: string } {
  const target = targetCards[insertIndex];
  if (target) return { before: target.id };
  return {};
}

export const useKanbanStore = create<KanbanState>((set, get) => ({
  status: 'idle',
  error: null,
  boardId: null,
  columns: [],
  cardsByColumn: {},
  selectedCardId: null,

  selectCard: (id) => set({ selectedCardId: id }),

  load: async () => {
    set({ status: 'loading', error: null });
    try {
      const seed = await defaultColumn();
      const columns = await columnsList(seed.board_id, false);
      const lists = await Promise.all(columns.map((c) => cardsList(c.id, false)));
      const cardsByColumn: Record<string, CardDto[]> = {};
      columns.forEach((c, i) => {
        cardsByColumn[c.id] = lists[i] ?? [];
      });
      set({
        status: 'ready',
        boardId: seed.board_id,
        columns,
        cardsByColumn,
        error: null,
      });
    } catch (e) {
      set({ status: 'error', error: formatError(e) });
    }
  },

  addCard: async (columnId, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      const created = await cardCreate(columnId, trimmed);
      set((s) => {
        const existing = s.cardsByColumn[columnId] ?? [];
        return {
          cardsByColumn: { ...s.cardsByColumn, [columnId]: [...existing, created] },
        };
      });
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  updateCard: async (id, patch) => {
    // Optimistic: apply patch fields immediately. Server response replaces.
    const prev = findCard(get().cardsByColumn, id);
    if (!prev) return;
    const optimistic: CardDto = {
      ...prev,
      title: patch.title ?? prev.title,
      body_text: patch.body_text === undefined ? prev.body_text : patch.body_text,
      due_at: patch.due_at === undefined ? prev.due_at : patch.due_at,
    };
    set((s) => replaceCard(s, optimistic));
    try {
      const fresh = await cardUpdate(id, patch);
      set((s) => replaceCard(s, fresh));
    } catch (e) {
      set((s) => replaceCard(s, prev));
      set({ error: formatError(e) });
    }
  },

  archiveCard: async (id) => {
    const prev = findCard(get().cardsByColumn, id);
    if (!prev) return;
    set((s) => removeCard(s, id));
    if (get().selectedCardId === id) set({ selectedCardId: null });
    try {
      await cardArchive(id);
    } catch (e) {
      // restore — rare path, easiest correct way is reload.
      set({ error: formatError(e) });
      await get().load();
    }
  },

  moveCard: async (cardId, fromColumnId, targetColumnId, insertIndex) => {
    const state = get();
    const fromList = state.cardsByColumn[fromColumnId] ?? [];
    const card = fromList.find((c) => c.id === cardId);
    if (!card) return;

    // Snapshot for rollback
    const snapshotFrom = fromList.slice();
    const snapshotTo =
      fromColumnId === targetColumnId ? null : (state.cardsByColumn[targetColumnId] ?? []).slice();

    // Apply optimistic reorder
    const fromAfterRemove = fromList.filter((c) => c.id !== cardId);
    const toBeforeInsert =
      fromColumnId === targetColumnId
        ? fromAfterRemove
        : (state.cardsByColumn[targetColumnId] ?? []).slice();
    const clampedIndex = Math.max(0, Math.min(insertIndex, toBeforeInsert.length));
    const optimisticCard: CardDto = { ...card, column_id: targetColumnId };
    const toAfterInsert = [
      ...toBeforeInsert.slice(0, clampedIndex),
      optimisticCard,
      ...toBeforeInsert.slice(clampedIndex),
    ];

    const nextCardsByColumn = { ...state.cardsByColumn };
    if (fromColumnId === targetColumnId) {
      nextCardsByColumn[targetColumnId] = toAfterInsert;
    } else {
      nextCardsByColumn[fromColumnId] = fromAfterRemove;
      nextCardsByColumn[targetColumnId] = toAfterInsert;
    }
    set({ cardsByColumn: nextCardsByColumn });

    // Anchor uses the target list *as if* the card weren't there.
    const anchors = computeAnchors(toBeforeInsert, clampedIndex);

    try {
      const fresh = await cardMove(cardId, { targetColumnId, ...anchors });
      set((s) => replaceCard(s, fresh));
    } catch (e) {
      set((s) => {
        const restored = { ...s.cardsByColumn };
        restored[fromColumnId] = snapshotFrom;
        if (snapshotTo) restored[targetColumnId] = snapshotTo;
        return { cardsByColumn: restored, error: formatError(e) };
      });
    }
  },
}));

function findCard(byColumn: Record<string, CardDto[]>, id: string): CardDto | undefined {
  for (const list of Object.values(byColumn)) {
    const hit = list.find((c) => c.id === id);
    if (hit) return hit;
  }
  return undefined;
}

function replaceCard(s: KanbanState, fresh: CardDto): Partial<KanbanState> {
  const next: Record<string, CardDto[]> = {};
  let found = false;
  for (const [colId, list] of Object.entries(s.cardsByColumn)) {
    if (colId === fresh.column_id) {
      const existingIdx = list.findIndex((c) => c.id === fresh.id);
      if (existingIdx >= 0) {
        const copy = list.slice();
        copy[existingIdx] = fresh;
        next[colId] = copy;
        found = true;
      } else {
        next[colId] = [...list.filter((c) => c.id !== fresh.id), fresh];
        found = true;
      }
    } else {
      next[colId] = list.filter((c) => c.id !== fresh.id);
    }
  }
  if (!found && s.cardsByColumn[fresh.column_id] === undefined) {
    next[fresh.column_id] = [fresh];
  }
  return { cardsByColumn: next };
}

function removeCard(s: KanbanState, id: string): Partial<KanbanState> {
  const next: Record<string, CardDto[]> = {};
  for (const [colId, list] of Object.entries(s.cardsByColumn)) {
    next[colId] = list.filter((c) => c.id !== id);
  }
  return { cardsByColumn: next };
}
