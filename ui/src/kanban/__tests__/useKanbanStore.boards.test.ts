import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setInvoker, type InvokeFn } from '../api/client';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import { useKanbanStore } from '../hooks/useKanbanStore';
import type { BoardDto, CardDto, ColumnDto } from '../types';

const makeBoard = (id: string): BoardDto => ({
  id,
  name: id.toUpperCase(),
  position: id,
  color: null,
  created_at: 0,
  updated_at: 0,
});

const makeColumn = (id: string, boardId: string): ColumnDto => ({
  id,
  board_id: boardId,
  name: id.toUpperCase(),
  position: id,
  color: null,
  created_at: 0,
  updated_at: 0,
});

const makeCard = (id: string, columnId: string): CardDto => ({
  id,
  column_id: columnId,
  title: id,
  body_text: null,
  position: id,
  due_at: null,
  created_at: 0,
  updated_at: 0,
});

const installLocalStorageShim = () => {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: shim,
  });
};

interface FakeServer {
  boards: BoardDto[];
  columns: ColumnDto[];
  cards: CardDto[];
}

const buildInvoker = (server: FakeServer): InvokeFn => {
  return async (cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case 'default_column':
        return { board_id: server.boards[0]?.id ?? '', column_id: '' } as never;
      case 'boards_list':
        return server.boards as never;
      case 'columns_list':
        return server.columns.filter((c) => c.board_id === a.boardId) as never;
      case 'cards_list':
        return server.cards.filter((c) => c.column_id === a.columnId) as never;
      case 'board_create': {
        const created = makeBoard(`b-${server.boards.length + 1}`);
        created.name = a.name as string;
        server.boards.push(created);
        return created as never;
      }
      case 'board_update': {
        const id = a.id as string;
        const patch = (a.patch ?? {}) as { name?: string; color?: string | null };
        server.boards = server.boards.map((b) =>
          b.id === id ? { ...b, ...patch } : b,
        );
        return server.boards.find((b) => b.id === id) as never;
      }
      case 'board_delete': {
        const id = a.id as string;
        server.boards = server.boards.filter((b) => b.id !== id);
        return undefined as never;
      }
      default:
        return undefined as never;
    }
  };
};

describe('useKanbanStore boards', () => {
  let server: FakeServer;

  beforeEach(() => {
    server = {
      boards: [makeBoard('b1'), makeBoard('b2')],
      columns: [makeColumn('c1', 'b1'), makeColumn('c2', 'b2')],
      cards: [makeCard('k1', 'c1'), makeCard('k2', 'c2')],
    };
    __setInvoker(buildInvoker(server));
    installLocalStorageShim();
    useKanbanStore.setState({
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
    });
  });

  afterEach(() => {
    __setInvoker(realInvoke);
  });

  it('load picks first board when no persisted id', async () => {
    await useKanbanStore.getState().load();
    const s = useKanbanStore.getState();
    expect(s.status).toBe('ready');
    expect(s.currentBoardId).toBe('b1');
    expect(s.columns.map((c) => c.id)).toEqual(['c1']);
    expect(window.localStorage.getItem('kanso.currentBoardId')).toBe('b1');
  });

  it('load respects persisted board id', async () => {
    window.localStorage.setItem('kanso.currentBoardId', 'b2');
    await useKanbanStore.getState().load();
    expect(useKanbanStore.getState().currentBoardId).toBe('b2');
  });

  it('falls back to first board when persisted id is gone', async () => {
    window.localStorage.setItem('kanso.currentBoardId', 'ghost');
    await useKanbanStore.getState().load();
    expect(useKanbanStore.getState().currentBoardId).toBe('b1');
  });

  it('switchBoard updates current and persists', async () => {
    await useKanbanStore.getState().load();
    await useKanbanStore.getState().switchBoard('b2');
    expect(useKanbanStore.getState().currentBoardId).toBe('b2');
    expect(window.localStorage.getItem('kanso.currentBoardId')).toBe('b2');
    expect(useKanbanStore.getState().columns.map((c) => c.id)).toEqual(['c2']);
  });

  it('boardCreate adds a new board and switches to it', async () => {
    await useKanbanStore.getState().load();
    const created = await useKanbanStore.getState().boardCreate('My new board');
    expect(created?.name).toBe('My new board');
    expect(useKanbanStore.getState().currentBoardId).toBe(created?.id);
    expect(useKanbanStore.getState().boards.map((b) => b.id)).toContain(created?.id);
  });

  it('deleting the current board switches to the next remaining board', async () => {
    await useKanbanStore.getState().load();
    expect(useKanbanStore.getState().currentBoardId).toBe('b1');
    await useKanbanStore.getState().boardDelete('b1');
    expect(useKanbanStore.getState().currentBoardId).toBe('b2');
  });

  it('deleting the last board lands on empty state', async () => {
    server.boards = [makeBoard('only')];
    server.columns = [];
    server.cards = [];
    await useKanbanStore.getState().load();
    expect(useKanbanStore.getState().currentBoardId).toBe('only');
    await useKanbanStore.getState().boardDelete('only');
    expect(useKanbanStore.getState().currentBoardId).toBeNull();
    expect(useKanbanStore.getState().columns).toEqual([]);
    expect(window.localStorage.getItem('kanso.currentBoardId')).toBeNull();
  });

  it('boardRename is optimistic and rolls back on failure', async () => {
    await useKanbanStore.getState().load();
    const baseInvoker = buildInvoker(server);
    __setInvoker(async (cmd, args) => {
      if (cmd === 'board_update') throw { kind: 'failed', message: 'nope' };
      return baseInvoker(cmd, args);
    });
    await useKanbanStore.getState().boardRename('b1', 'Renamed');
    const s = useKanbanStore.getState();
    expect(s.boards.find((b) => b.id === 'b1')?.name).toBe('B1');
    expect(s.error).toMatch(/nope/);
  });
});
