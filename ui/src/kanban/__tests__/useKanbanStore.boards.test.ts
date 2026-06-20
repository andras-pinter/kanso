import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setInvoker, type InvokeFn } from '../api/client';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import { useKanbanStore } from '../hooks/useKanbanStore';
import type { BoardDto, CardDto, ColumnDto } from '../types';

function makeBoard(id: string, archived = false): BoardDto {
  return {
    id,
    name: id.toUpperCase(),
    position: id,
    color: null,
    created_at: 0,
    updated_at: 0,
    archived_at: archived ? 1 : null,
  };
}

function makeColumn(id: string, boardId: string): ColumnDto {
  return {
    id,
    board_id: boardId,
    name: id.toUpperCase(),
    position: id,
    color: null,
    created_at: 0,
    updated_at: 0,
    archived_at: null,
  };
}

function makeCard(id: string, columnId: string): CardDto {
  return {
    id,
    column_id: columnId,
    title: id,
    body_text: null,
    position: id,
    due_at: null,
    created_at: 0,
    updated_at: 0,
    archived_at: null,
  };
}

function installLocalStorageShim() {
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
}

/**
 * Fake server backing the invoker. Just enough fidelity to drive the
 * store's board flow.
 */
interface FakeServer {
  boards: BoardDto[];
  columns: ColumnDto[];
  cards: CardDto[];
}

function buildInvoker(server: FakeServer): InvokeFn {
  return async (cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case 'default_column':
        return { board_id: server.boards[0]?.id ?? '', column_id: '' } as never;
      case 'boards_list':
        return (a.includeArchived
          ? server.boards
          : server.boards.filter((b) => b.archived_at === null)) as never;
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
      case 'board_archive': {
        const id = a.id as string;
        server.boards = server.boards.map((b) =>
          b.id === id ? { ...b, archived_at: 1 } : b,
        );
        return undefined as never;
      }
      case 'board_unarchive': {
        const id = a.id as string;
        server.boards = server.boards.map((b) =>
          b.id === id ? { ...b, archived_at: null } : b,
        );
        return undefined as never;
      }
      case 'board_delete': {
        const id = a.id as string;
        server.boards = server.boards.filter((b) => b.id !== id);
        return undefined as never;
      }
      case 'column_update': {
        const id = a.id as string;
        const patch = (a.patch ?? {}) as { name?: string; color?: string | null };
        server.columns = server.columns.map((c) =>
          c.id === id ? { ...c, ...patch } : c,
        );
        return server.columns.find((c) => c.id === id) as never;
      }
      case 'column_move': {
        // Just echo back the column unchanged — store only uses the row
        // to refresh, ordering already applied optimistically.
        return server.columns.find((c) => c.id === a.id) as never;
      }
      default:
        return undefined as never;
    }
  };
}

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
    // Reset store
    useKanbanStore.setState({
      status: 'idle',
      error: null,
      boards: [],
      currentBoardId: null,
      showArchived: false,
      columns: [],
      cardsByColumn: {},
      selectedCardId: null,
    });
  });

  afterEach(() => {
    __setInvoker(realInvoke);
  });

  it('load picks first live board when no persisted id', async () => {
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

  it('falls back to first live board when persisted id is gone', async () => {
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

  it('archiving the current board switches to the next live board', async () => {
    await useKanbanStore.getState().load();
    expect(useKanbanStore.getState().currentBoardId).toBe('b1');
    await useKanbanStore.getState().boardArchive('b1');
    expect(useKanbanStore.getState().currentBoardId).toBe('b2');
  });

  it('archiving the last live board lands on empty state', async () => {
    server.boards = [makeBoard('only')];
    server.columns = [];
    server.cards = [];
    await useKanbanStore.getState().load();
    expect(useKanbanStore.getState().currentBoardId).toBe('only');
    await useKanbanStore.getState().boardArchive('only');
    expect(useKanbanStore.getState().currentBoardId).toBeNull();
    expect(useKanbanStore.getState().columns).toEqual([]);
    expect(window.localStorage.getItem('kanso.currentBoardId')).toBeNull();
  });

  it('boardRename is optimistic and rolls back on failure', async () => {
    await useKanbanStore.getState().load();
    // Swap to a failing invoker just for rename
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

  it('setColumnColor is optimistic and rolls back on failure', async () => {
    await useKanbanStore.getState().load();
    const baseInvoker = buildInvoker(server);
    __setInvoker(async (cmd, args) => {
      if (cmd === 'column_update') throw { kind: 'failed', message: 'no color' };
      return baseInvoker(cmd, args);
    });
    await useKanbanStore.getState().setColumnColor('c1', '#ff0000');
    const s = useKanbanStore.getState();
    expect(s.columns.find((c) => c.id === 'c1')?.color).toBeNull();
    expect(s.error).toMatch(/no color/);
  });

  it('reorderColumn applies optimistic order + restores on failure', async () => {
    server.boards = [makeBoard('only')];
    server.columns = [
      makeColumn('a', 'only'),
      makeColumn('b', 'only'),
      makeColumn('c', 'only'),
    ];
    server.cards = [];
    await useKanbanStore.getState().load();
    expect(useKanbanStore.getState().columns.map((c) => c.id)).toEqual(['a', 'b', 'c']);

    const baseInvoker = buildInvoker(server);
    __setInvoker(async (cmd, args) => {
      if (cmd === 'column_move') throw { kind: 'failed', message: 'reorder boom' };
      return baseInvoker(cmd, args);
    });
    await useKanbanStore.getState().reorderColumn({ columnId: 'a', insertIndex: 1 });
    const s = useKanbanStore.getState();
    expect(s.columns.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(s.error).toMatch(/reorder boom/);
  });
});
