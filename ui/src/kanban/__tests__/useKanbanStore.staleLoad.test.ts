// H2 regression: board-content fetches must be gated by a monotonic
// load-version token. A slow in-flight fetch from a prior switchBoard /
// setShowArchived must NOT overwrite state once the user has moved on.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setInvoker, type InvokeFn } from '../api/client';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import { useKanbanStore } from '../hooks/useKanbanStore';
import type { BoardDto, CardDto, ColumnDto } from '../types';

function board(id: string): BoardDto {
  return {
    id,
    name: id,
    position: id,
    color: null,
    created_at: 0,
    updated_at: 0,
  };
}

function column(id: string, boardId: string): ColumnDto {
  return {
    id,
    board_id: boardId,
    name: id,
    position: id,
    color: null,
    created_at: 0,
    updated_at: 0,
  };
}

function card(id: string, columnId: string): CardDto {
  return {
    id,
    column_id: columnId,
    title: id,
    body_text: null,
    position: id,
    due_at: null,
    created_at: 0,
    updated_at: 0,
  };
}

function installLocalStorageShim() {
  const data = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      getItem: (k: string) => (data.has(k) ? (data.get(k) ?? null) : null),
      key: (i: number) => Array.from(data.keys())[i] ?? null,
      removeItem: (k: string) => {
        data.delete(k);
      },
      setItem: (k: string, v: string) => {
        data.set(k, String(v));
      },
    } satisfies Storage,
  });
}

describe('useKanbanStore stale-load gating', () => {
  beforeEach(() => {
    installLocalStorageShim();
    useKanbanStore.setState({
      status: 'idle',
      error: null,
      boards: [board('a'), board('b'), board('c')],
      currentBoardId: 'a',
      columns: [column('ca', 'a')],
      cardsByColumn: { ca: [card('k1', 'ca')] },
      selectedCardId: null,
      tags: [],
      tagsLoaded: false,
      cardTagMap: {},
    });
  });

  afterEach(() => {
    __setInvoker(realInvoke);
  });

  it('switchBoard(B) then switchBoard(C): late B response is ignored', async () => {
    let resolveB!: () => void;
    const bGate = new Promise<void>((r) => {
      resolveB = r;
    });
    let resolveC!: () => void;
    const cGate = new Promise<void>((r) => {
      resolveC = r;
    });

    const invoker: InvokeFn = async (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      if (cmd === 'columns_list') {
        const boardId = a.boardId as string;
        if (boardId === 'b') await bGate;
        if (boardId === 'c') await cGate;
        return [column(`c${boardId}`, boardId)] as never;
      }
      if (cmd === 'cards_list') {
        const colId = a.columnId as string;
        return [card(`k-${colId}`, colId)] as never;
      }
      return undefined as never;
    };
    __setInvoker(invoker);

    // Two concurrent switches; we control which fetch resolves first.
    const pB = useKanbanStore.getState().switchBoard('b');
    const pC = useKanbanStore.getState().switchBoard('c');

    // Resolve C first → state should reflect C.
    resolveC();
    await pC;
    expect(useKanbanStore.getState().currentBoardId).toBe('c');
    expect(useKanbanStore.getState().columns.map((c) => c.id)).toEqual(['cc']);

    // Now resolve B late. The guard must drop the result on the floor.
    resolveB();
    await pB;
    const s = useKanbanStore.getState();
    expect(s.currentBoardId).toBe('c');
    expect(s.columns.map((c) => c.id)).toEqual(['cc']);
  });
});
