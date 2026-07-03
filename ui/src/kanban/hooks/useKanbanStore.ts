// Zustand store for the kanban view.
// Holds the active board's columns + cards-by-column and exposes API-backed
// mutations with optimistic updates. The server is the source of truth for
// `position` strings — on every mutation we replace the optimistic row with
// the DTO returned by the backend.

import { create } from 'zustand';
import {
  boardCardTagsList,
  boardCreate,
  boardDelete,
  boardUpdate,
  boardsList,
  cardCreate,
  cardDelete,
  cardMove,
  cardTagAdd,
  cardTagRemove,
  cardUpdate,
  cardsList,
  columnsList,
  defaultColumn,
  tagCreate,
  tagDelete,
  tagUpdate,
  tagsList,
} from '../api/client';
import type {
  BoardDto,
  CardDto,
  CardPatch,
  ColumnDto,
  TagDto,
  TagPatch,
} from '../types';

type Status = 'idle' | 'loading' | 'ready' | 'error';

const STORAGE_KEY = 'kanso.currentBoardId';

// Monotonic token for board-content fetches. Each call to switchBoard,
// boardDelete, or any other full reload claims a fresh token; only the
// latest token may write its result back, so a slow in-flight fetch can
// never overwrite the user's newer board selection.
let loadVersion = 0;

// Per-card monotonic sequence for single-card mutations (updateCard,
// deleteCard). Each mutation bumps the counter and captures its own
// sequence; only the latest in-flight mutation for a card is allowed to
// write its result (or rollback) back to the store. Otherwise a slow
// "title=A" response can clobber a newer "title=B" that already landed.
const cardMutationSeq = new Map<string, number>();

const nextCardMutation = (id: string): number => {
  const next = (cardMutationSeq.get(id) ?? 0) + 1;
  cardMutationSeq.set(id, next);
  return next;
};

const isLatestCardMutation = (id: string, seq: number): boolean =>
  cardMutationSeq.get(id) === seq;

interface KanbanState {
  status: Status;
  error: string | null;
  boards: BoardDto[];
  currentBoardId: string | null;
  columns: ColumnDto[];
  cardsByColumn: Record<string, CardDto[]>;
  selectedCardId: string | null;
  tags: TagDto[];
  tagsLoaded: boolean;
  // cardId -> tagIds. Refreshed via reloadTagMap whenever links change.
  cardTagMap: Record<string, string[]>;
  // Tag ids currently selected as a board filter (AND semantics). Not
  // persisted across app restarts.
  selectedTagIds: string[];

  load: () => Promise<void>;
  switchBoard: (id: string) => Promise<boolean>;

  boardCreate: (name: string) => Promise<BoardDto | null>;
  boardRename: (id: string, name: string) => Promise<void>;
  boardSetColor: (id: string, color: string | null) => Promise<void>;
  boardDelete: (id: string) => Promise<void>;

  selectCard: (id: string | null) => void;
  // Switches to the card's board (if different) then opens its drawer.
  // No-op if the board isn't reachable. Used by the Cmd+K palette.
  openCardOnBoard: (cardId: string, boardId: string) => Promise<void>;
  addCard: (columnId: string, title: string) => Promise<void>;
  updateCard: (id: string, patch: CardPatch) => Promise<void>;
  // Returns true iff the API call succeeded. Callers (e.g. the card
  // modal) use this to decide whether to tear down UI that would
  // otherwise orphan the user's intent on failure.
  deleteCard: (id: string) => Promise<boolean>;
  moveCard: (
    cardId: string,
    fromColumnId: string,
    targetColumnId: string,
    insertIndex: number,
  ) => Promise<void>;

  loadTags: () => Promise<void>;
  reloadTagMap: () => Promise<void>;
  tagCreate: (name: string, color?: string | null) => Promise<TagDto | null>;
  tagUpdate: (id: string, patch: TagPatch) => Promise<void>;
  tagDelete: (id: string) => Promise<void>;
  addCardTag: (cardId: string, tagId: string) => Promise<void>;
  removeCardTag: (cardId: string, tagId: string) => Promise<void>;

  toggleTagFilter: (tagId: string) => void;
  clearTagFilters: () => void;
}

function formatError(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const err = e as { kind?: string; message?: string };
    return `${err.kind ?? 'error'}: ${err.message ?? String(e)}`;
  }
  return String(e);
}

// Build the {before, after} payload from an insertion index into the
// post-removal target list. Backend semantics: `before` is the neighbour
// that should end up at the LOWER position (i.e. the predecessor) and
// `after` is the SUCCESSOR. The neighbours come straight from the list:
//
//   list = [..., L[i-1], L[i], ...]
//   inserting at i → before = L[i-1], after = L[i]
//
// Either side may be absent (prepend / append / empty list).
export function computeAnchors(
  targetCards: readonly CardDto[],
  insertIndex: number,
): { before?: string; after?: string } {
  const clamped = Math.max(0, Math.min(insertIndex, targetCards.length));
  const prev = targetCards[clamped - 1];
  const next = targetCards[clamped];
  const anchors: { before?: string; after?: string } = {};
  if (prev) anchors.before = prev.id;
  if (next) anchors.after = next.id;
  return anchors;
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

async function fetchBoardContents(
  boardId: string,
): Promise<{ columns: ColumnDto[]; cardsByColumn: Record<string, CardDto[]> }> {
  const columns = await columnsList(boardId);
  const lists = await Promise.all(columns.map((c) => cardsList(c.id)));
  const cardsByColumn: Record<string, CardDto[]> = {};
  columns.forEach((c, i) => {
    cardsByColumn[c.id] = lists[i] ?? [];
  });
  return { columns, cardsByColumn };
}

// Build a `cardId -> tagIds[]` map for a board in a single round-trip.
// Returns an empty map when no board is active.
async function fetchCardTagMap(
  boardId: string | null,
): Promise<Record<string, string[]>> {
  if (!boardId) return {};
  const links = await boardCardTagsList(boardId);
  const map: Record<string, string[]> = {};
  for (const { card_id, tag_id } of links) {
    const list = map[card_id];
    if (list) list.push(tag_id);
    else map[card_id] = [tag_id];
  }
  return map;
}

export const useKanbanStore = create<KanbanState>((set, get) => ({
  status: 'idle',
  error: null,
  boards: [],
  currentBoardId: null,
  columns: [],
  cardsByColumn: {},
  selectedCardId: null,
  tags: [],
  tagsLoaded: false,
  cardTagMap: {},
  selectedTagIds: [],

  selectCard: (id) => set({ selectedCardId: id }),

  load: async () => {
    const myVersion = ++loadVersion;
    set({ status: 'loading', error: null });
    try {
      // Seed first so a brand-new install has at least one board + column.
      await defaultColumn();
      const boards = await boardsList();
      const persisted = readPersistedBoardId();
      const target =
        (persisted && boards.find((b) => b.id === persisted)) ?? boards[0] ?? null;

      if (!target) {
        if (myVersion !== loadVersion) return;
        persistBoardId(null);
        set({
          status: 'ready',
          boards,
          currentBoardId: null,
          columns: [],
          cardsByColumn: {},
          cardTagMap: {},
          error: null,
        });
        return;
      }

      const { columns, cardsByColumn } = await fetchBoardContents(target.id);
      if (myVersion !== loadVersion) return;
      persistBoardId(target.id);
      set({
        status: 'ready',
        boards,
        currentBoardId: target.id,
        columns,
        cardsByColumn,
        error: null,
      });
      await get().reloadTagMap();
    } catch (e) {
      if (myVersion !== loadVersion) return;
      set({ status: 'error', error: formatError(e) });
    }
  },

  switchBoard: async (id) => {
    if (get().currentBoardId === id) return true;
    const myVersion = ++loadVersion;
    try {
      const { columns, cardsByColumn } = await fetchBoardContents(id);
      if (myVersion !== loadVersion) return false;
      persistBoardId(id);
      set({ currentBoardId: id, columns, cardsByColumn, selectedCardId: null, error: null });
      await get().reloadTagMap();
      return true;
    } catch (e) {
      if (myVersion !== loadVersion) return false;
      set({ error: formatError(e) });
      return false;
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

  boardDelete: async (id) => {
    try {
      await boardDelete(id);
      const boards = await boardsList();
      if (get().currentBoardId === id) {
        const next = boards[0] ?? null;
        if (next) {
          const myVersion = ++loadVersion;
          const { columns, cardsByColumn } = await fetchBoardContents(next.id);
          if (myVersion !== loadVersion) return;
          persistBoardId(next.id);
          set({
            boards,
            currentBoardId: next.id,
            columns,
            cardsByColumn,
            selectedCardId: null,
          });
          await get().reloadTagMap();
        } else {
          ++loadVersion;
          persistBoardId(null);
          set({
            boards,
            currentBoardId: null,
            columns: [],
            cardsByColumn: {},
            cardTagMap: {},
            selectedCardId: null,
          });
        }
      } else {
        set({ boards });
      }
    } catch (e) {
      set({ error: formatError(e) });
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
    const mySeq = nextCardMutation(id);
    set((s) => replaceCard(s, optimistic));
    try {
      const fresh = await cardUpdate(id, patch);
      if (!isLatestCardMutation(id, mySeq)) return;
      set((s) => replaceCard(s, fresh));
    } catch (e) {
      if (!isLatestCardMutation(id, mySeq)) return;
      set((s) => replaceCard(s, prev));
      set({ error: formatError(e) });
    }
  },

  deleteCard: async (id) => {
    const prev = findCard(get().cardsByColumn, id);
    if (!prev) return false;
    // Pessimistic: keep the card visible (and the modal mounted) until
    // the server confirms. Optimistic removal used to snap the modal
    // shut on rollback, orphaning the user's intent on failure.
    // Sequence bump still gates a concurrent updateCard's stale write.
    const mySeq = nextCardMutation(id);
    try {
      await cardDelete(id);
      // Delete success is terminal — the card is gone on the server, so
      // the UI must reflect that regardless of a concurrent updateCard's
      // newer sequence.
      set((s) => removeCard(s, id));
      if (get().selectedCardId === id) set({ selectedCardId: null });
      return true;
    } catch (e) {
      if (!isLatestCardMutation(id, mySeq)) return false;
      set({ error: formatError(e) });
      return false;
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

  openCardOnBoard: async (cardId, boardId) => {
    if (get().currentBoardId !== boardId) {
      const committed = await get().switchBoard(boardId);
      if (!committed) return;
    }
    // Belt-and-braces: a newer board switch may have committed between our
    // await and this set; only open the drawer if we're still on the right
    // board and the card actually exists in the loaded data.
    const s = get();
    if (s.currentBoardId !== boardId) return;
    const present = Object.values(s.cardsByColumn).some((cards) =>
      cards.some((c) => c.id === cardId),
    );
    if (!present) return;
    set({ selectedCardId: cardId });
  },

  loadTags: async () => {
    // Snapshot the catalog before the request so we can distinguish
    // "user mutated locally while we were in flight" from "server has
    // fresh data we should trust".
    const startById = new Map<string, TagDto>();
    for (const t of get().tags) startById.set(t.id, t);
    try {
      const fetched = await tagsList();
      set((s) => {
        const localById = new Map<string, TagDto>();
        for (const t of s.tags) localById.set(t.id, t);
        const merged: TagDto[] = [];
        for (const remote of fetched) {
          const local = localById.get(remote.id);
          const wasPresentAtStart = startById.has(remote.id);
          if (!local && wasPresentAtStart) {
            // Existed at request start, gone locally now -> user
            // deleted while the fetch was in flight. Don't resurrect.
            continue;
          }
          if (local && local.updated_at > remote.updated_at) {
            // Local was updated after the server snapshot was taken.
            // Keep the fresher local copy.
            merged.push(local);
            continue;
          }
          merged.push(remote);
        }
        // Local-only ids that the server didn't return: preserve iff
        // they're new since the request started (i.e. a concurrent
        // tagCreate). Anything the server no longer knows about and
        // that was already local at start is a server-side delete.
        for (const local of s.tags) {
          if (localById.has(local.id) && !merged.some((m) => m.id === local.id)) {
            if (!startById.has(local.id)) merged.push(local);
          }
        }
        return { tags: merged, tagsLoaded: true };
      });
      const map = await fetchCardTagMap(get().currentBoardId);
      set({ cardTagMap: map });
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  reloadTagMap: async () => {
    const boardId = get().currentBoardId;
    const version = loadVersion;
    try {
      const map = await fetchCardTagMap(boardId);
      if (loadVersion !== version || get().currentBoardId !== boardId) return;
      set({ cardTagMap: map });
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  tagCreate: async (name, color) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    try {
      const created = await tagCreate(trimmed, color ?? undefined);
      set((s) => ({ tags: [...s.tags, created] }));
      return created;
    } catch (e) {
      set({ error: formatError(e) });
      return null;
    }
  },

  tagUpdate: async (id, patch) => {
    const prev = get().tags.find((t) => t.id === id);
    if (!prev) return;
    // Optimistic rename / recolor.
    set((s) => ({
      tags: s.tags.map((t) =>
        t.id === id
          ? {
              ...t,
              name: patch.name ?? t.name,
              color: patch.color === undefined ? t.color : patch.color,
            }
          : t,
      ),
    }));
    try {
      const fresh = await tagUpdate(id, patch);
      set((s) => ({ tags: s.tags.map((t) => (t.id === id ? fresh : t)) }));
    } catch (e) {
      set((s) => ({
        tags: s.tags.map((t) => (t.id === id ? prev : t)),
        error: formatError(e),
      }));
    }
  },

  tagDelete: async (id) => {
    try {
      await tagDelete(id);
      set((s) => ({
        tags: s.tags.filter((t) => t.id !== id),
        cardTagMap: Object.fromEntries(
          Object.entries(s.cardTagMap).map(([cid, ids]) => [
            cid,
            ids.filter((tid) => tid !== id),
          ]),
        ),
        selectedTagIds: s.selectedTagIds.filter((tid) => tid !== id),
      }));
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  addCardTag: async (cardId, tagId) => {
    const prev = get().cardTagMap[cardId] ?? [];
    if (prev.includes(tagId)) return;
    set((s) => ({
      cardTagMap: { ...s.cardTagMap, [cardId]: [...(s.cardTagMap[cardId] ?? []), tagId] },
    }));
    try {
      await cardTagAdd(cardId, tagId);
    } catch (e) {
      // Per-tag rollback: drop only this tag id from whatever the current
      // list is, so a concurrent mutation that already settled isn't
      // clobbered by restoring the pre-call snapshot.
      set((s) => ({
        cardTagMap: {
          ...s.cardTagMap,
          [cardId]: (s.cardTagMap[cardId] ?? []).filter((id) => id !== tagId),
        },
        error: formatError(e),
      }));
    }
  },

  removeCardTag: async (cardId, tagId) => {
    const prev = get().cardTagMap[cardId] ?? [];
    if (!prev.includes(tagId)) return;
    set((s) => ({
      cardTagMap: {
        ...s.cardTagMap,
        [cardId]: (s.cardTagMap[cardId] ?? []).filter((id) => id !== tagId),
      },
    }));
    try {
      await cardTagRemove(cardId, tagId);
    } catch (e) {
      // Per-tag rollback: re-add this tag id (idempotent) without touching
      // concurrent mutations on other tags of the same card.
      set((s) => {
        const cur = s.cardTagMap[cardId] ?? [];
        if (cur.includes(tagId)) {
          return { error: formatError(e) };
        }
        return {
          cardTagMap: { ...s.cardTagMap, [cardId]: [...cur, tagId] },
          error: formatError(e),
        };
      });
    }
  },

  toggleTagFilter: (tagId) =>
    set((s) => ({
      selectedTagIds: s.selectedTagIds.includes(tagId)
        ? s.selectedTagIds.filter((id) => id !== tagId)
        : [...s.selectedTagIds, tagId],
    })),

  clearTagFilters: () => set({ selectedTagIds: [] }),
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
