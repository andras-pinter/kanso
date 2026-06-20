// Zustand store for the kanban view.
// Holds the active board's columns + cards-by-column and exposes API-backed
// mutations with optimistic updates. The server is the source of truth for
// `position` strings — on every mutation we replace the optimistic row with
// the DTO returned by the backend.

import { create } from 'zustand';
import {
  boardArchive,
  boardCreate,
  boardDelete,
  boardUnarchive,
  boardUpdate,
  boardsList,
  cardArchive,
  cardCreate,
  cardMove,
  cardUnarchive,
  cardUpdate,
  cardsList,
  columnArchive,
  columnCreate,
  columnMove,
  columnUnarchive,
  columnUpdate,
  columnsList,
  defaultColumn,
} from '../api/client';
import {
  applyColumnReorder,
  computeColumnAnchors,
  type ColumnDragResolution,
} from '../columnDragEnd';
import type {
  BoardDto,
  CardDto,
  CardPatch,
  ColumnDto,
} from '../types';

type Status = 'idle' | 'loading' | 'ready' | 'error';

const STORAGE_KEY = 'kanso.currentBoardId';

interface KanbanState {
  status: Status;
  error: string | null;
  boards: BoardDto[];
  currentBoardId: string | null;
  showArchived: boolean;
  columns: ColumnDto[];
  cardsByColumn: Record<string, CardDto[]>;
  selectedCardId: string | null;

  load: () => Promise<void>;
  switchBoard: (id: string) => Promise<void>;
  setShowArchived: (v: boolean) => Promise<void>;

  boardCreate: (name: string) => Promise<BoardDto | null>;
  boardRename: (id: string, name: string) => Promise<void>;
  boardSetColor: (id: string, color: string | null) => Promise<void>;
  boardArchive: (id: string) => Promise<void>;
  boardUnarchive: (id: string) => Promise<void>;
  boardDelete: (id: string) => Promise<void>;

  addColumn: (name: string) => Promise<void>;
  renameColumn: (id: string, name: string) => Promise<void>;
  setColumnColor: (id: string, color: string | null) => Promise<void>;
  archiveColumn: (id: string) => Promise<void>;
  unarchiveColumn: (id: string) => Promise<void>;
  reorderColumn: (resolution: ColumnDragResolution) => Promise<void>;

  selectCard: (id: string | null) => void;
  addCard: (columnId: string, title: string) => Promise<void>;
  updateCard: (id: string, patch: CardPatch) => Promise<void>;
  archiveCard: (id: string) => Promise<void>;
  unarchiveCard: (id: string) => Promise<void>;
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

function readPersistedBoardId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistBoardId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage may be unavailable (private mode / disabled storage).
    // Persistence is best-effort.
  }
}

const liveBoards = (boards: readonly BoardDto[]): BoardDto[] =>
  boards.filter((b) => b.archived_at === null);

async function fetchBoardContents(
  boardId: string,
  includeArchived: boolean,
): Promise<{ columns: ColumnDto[]; cardsByColumn: Record<string, CardDto[]> }> {
  const columns = await columnsList(boardId, includeArchived);
  const lists = await Promise.all(columns.map((c) => cardsList(c.id, includeArchived)));
  const cardsByColumn: Record<string, CardDto[]> = {};
  columns.forEach((c, i) => {
    cardsByColumn[c.id] = lists[i] ?? [];
  });
  return { columns, cardsByColumn };
}

export const useKanbanStore = create<KanbanState>((set, get) => ({
  status: 'idle',
  error: null,
  boards: [],
  currentBoardId: null,
  showArchived: false,
  columns: [],
  cardsByColumn: {},
  selectedCardId: null,

  selectCard: (id) => set({ selectedCardId: id }),

  load: async () => {
    set({ status: 'loading', error: null });
    try {
      // Seed first so a brand-new install has at least one board + column.
      await defaultColumn();
      const includeArchived = get().showArchived;
      const allBoards = await boardsList(true);
      const live = liveBoards(allBoards);
      const persisted = readPersistedBoardId();
      const target =
        (persisted && live.find((b) => b.id === persisted)) ?? live[0] ?? null;

      if (!target) {
        set({
          status: 'ready',
          boards: allBoards,
          currentBoardId: null,
          columns: [],
          cardsByColumn: {},
          error: null,
        });
        return;
      }

      const { columns, cardsByColumn } = await fetchBoardContents(target.id, includeArchived);
      persistBoardId(target.id);
      set({
        status: 'ready',
        boards: allBoards,
        currentBoardId: target.id,
        columns,
        cardsByColumn,
        error: null,
      });
    } catch (e) {
      set({ status: 'error', error: formatError(e) });
    }
  },

  switchBoard: async (id) => {
    if (get().currentBoardId === id) return;
    try {
      const { columns, cardsByColumn } = await fetchBoardContents(id, get().showArchived);
      persistBoardId(id);
      set({ currentBoardId: id, columns, cardsByColumn, selectedCardId: null, error: null });
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  setShowArchived: async (v) => {
    set({ showArchived: v });
    const id = get().currentBoardId;
    if (!id) return;
    try {
      const { columns, cardsByColumn } = await fetchBoardContents(id, v);
      set({ columns, cardsByColumn });
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  boardCreate: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    try {
      const created = await boardCreate(trimmed);
      set((s) => ({ boards: [...s.boards, created] }));
      await get().switchBoard(created.id);
      return created;
    } catch (e) {
      set({ error: formatError(e) });
      return null;
    }
  },

  boardRename: async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const prev = get().boards.find((b) => b.id === id);
    if (!prev || prev.name === trimmed) return;
    set((s) => ({
      boards: s.boards.map((b) => (b.id === id ? { ...b, name: trimmed } : b)),
    }));
    try {
      const fresh = await boardUpdate(id, { name: trimmed });
      set((s) => ({ boards: s.boards.map((b) => (b.id === id ? fresh : b)) }));
    } catch (e) {
      set((s) => ({
        boards: s.boards.map((b) => (b.id === id ? prev : b)),
        error: formatError(e),
      }));
    }
  },

  boardSetColor: async (id, color) => {
    const prev = get().boards.find((b) => b.id === id);
    if (!prev) return;
    set((s) => ({ boards: s.boards.map((b) => (b.id === id ? { ...b, color } : b)) }));
    try {
      const fresh = await boardUpdate(id, { color });
      set((s) => ({ boards: s.boards.map((b) => (b.id === id ? fresh : b)) }));
    } catch (e) {
      set((s) => ({
        boards: s.boards.map((b) => (b.id === id ? prev : b)),
        error: formatError(e),
      }));
    }
  },

  boardArchive: async (id) => {
    try {
      await boardArchive(id);
      const all = await boardsList(true);
      const live = liveBoards(all);
      const wasCurrent = get().currentBoardId === id;
      if (wasCurrent) {
        const next = live[0] ?? null;
        if (next) {
          const { columns, cardsByColumn } = await fetchBoardContents(
            next.id,
            get().showArchived,
          );
          persistBoardId(next.id);
          set({
            boards: all,
            currentBoardId: next.id,
            columns,
            cardsByColumn,
            selectedCardId: null,
            error: null,
          });
        } else {
          persistBoardId(null);
          set({
            boards: all,
            currentBoardId: null,
            columns: [],
            cardsByColumn: {},
            selectedCardId: null,
            error: null,
          });
        }
      } else {
        set({ boards: all });
      }
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  boardUnarchive: async (id) => {
    try {
      await boardUnarchive(id);
      const all = await boardsList(true);
      set({ boards: all });
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  boardDelete: async (id) => {
    try {
      await boardDelete(id);
      const all = await boardsList(true);
      const live = liveBoards(all);
      if (get().currentBoardId === id) {
        const next = live[0] ?? null;
        if (next) {
          const { columns, cardsByColumn } = await fetchBoardContents(
            next.id,
            get().showArchived,
          );
          persistBoardId(next.id);
          set({
            boards: all,
            currentBoardId: next.id,
            columns,
            cardsByColumn,
            selectedCardId: null,
          });
        } else {
          persistBoardId(null);
          set({
            boards: all,
            currentBoardId: null,
            columns: [],
            cardsByColumn: {},
            selectedCardId: null,
          });
        }
      } else {
        set({ boards: all });
      }
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  addColumn: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const boardId = get().currentBoardId;
    if (!boardId) return;
    try {
      const created = await columnCreate(boardId, trimmed);
      set((s) => ({
        columns: [...s.columns, created],
        cardsByColumn: { ...s.cardsByColumn, [created.id]: [] },
      }));
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  renameColumn: async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const prev = get().columns.find((c) => c.id === id);
    if (!prev || prev.name === trimmed) return;
    set((s) => ({ columns: s.columns.map((c) => (c.id === id ? { ...c, name: trimmed } : c)) }));
    try {
      const fresh = await columnUpdate(id, { name: trimmed });
      set((s) => ({ columns: s.columns.map((c) => (c.id === id ? fresh : c)) }));
    } catch (e) {
      set((s) => ({
        columns: s.columns.map((c) => (c.id === id ? prev : c)),
        error: formatError(e),
      }));
    }
  },

  setColumnColor: async (id, color) => {
    const prev = get().columns.find((c) => c.id === id);
    if (!prev) return;
    set((s) => ({ columns: s.columns.map((c) => (c.id === id ? { ...c, color } : c)) }));
    try {
      const fresh = await columnUpdate(id, { color });
      set((s) => ({ columns: s.columns.map((c) => (c.id === id ? fresh : c)) }));
    } catch (e) {
      set((s) => ({
        columns: s.columns.map((c) => (c.id === id ? prev : c)),
        error: formatError(e),
      }));
    }
  },

  archiveColumn: async (id) => {
    const prev = get().columns.find((c) => c.id === id);
    if (!prev) return;
    try {
      await columnArchive(id);
      const boardId = get().currentBoardId;
      if (!boardId) return;
      const { columns, cardsByColumn } = await fetchBoardContents(boardId, get().showArchived);
      set({ columns, cardsByColumn });
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  unarchiveColumn: async (id) => {
    try {
      await columnUnarchive(id);
      const boardId = get().currentBoardId;
      if (!boardId) return;
      const { columns, cardsByColumn } = await fetchBoardContents(boardId, get().showArchived);
      set({ columns, cardsByColumn });
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  reorderColumn: async (resolution) => {
    const snapshot = get().columns.slice();
    const optimistic = applyColumnReorder(snapshot, resolution);
    set({ columns: optimistic });
    const withoutMoved = snapshot.filter((c) => c.id !== resolution.columnId);
    const anchors = computeColumnAnchors(withoutMoved, resolution.insertIndex);
    try {
      const fresh = await columnMove(resolution.columnId, anchors);
      set((s) => ({
        columns: s.columns.map((c) => (c.id === fresh.id ? fresh : c)),
      }));
    } catch (e) {
      set({ columns: snapshot, error: formatError(e) });
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
      // Refresh active column so archived rows reappear if showArchived is on.
      if (get().showArchived) {
        const fresh = await cardsList(prev.column_id, true);
        set((s) => ({
          cardsByColumn: { ...s.cardsByColumn, [prev.column_id]: fresh },
        }));
      }
    } catch (e) {
      set({ error: formatError(e) });
      await get().load();
    }
  },

  unarchiveCard: async (id) => {
    try {
      await cardUnarchive(id);
      const boardId = get().currentBoardId;
      if (!boardId) return;
      const { columns, cardsByColumn } = await fetchBoardContents(boardId, get().showArchived);
      set({ columns, cardsByColumn });
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  moveCard: async (cardId, fromColumnId, targetColumnId, insertIndex) => {
    const state = get();
    const fromList = state.cardsByColumn[fromColumnId] ?? [];
    const card = fromList.find((c) => c.id === cardId);
    if (!card) return;

    const snapshotFrom = fromList.slice();
    const snapshotTo =
      fromColumnId === targetColumnId ? null : (state.cardsByColumn[targetColumnId] ?? []).slice();

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
