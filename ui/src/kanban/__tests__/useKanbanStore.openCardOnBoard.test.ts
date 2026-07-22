// H2 regression: rapid Cmd+K result picks must not leave the store
// pointing at a stale card. openCardOnBoard must respect switchBoard's
// commit signal and re-verify state before setting selectedCardId.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setInvoker, type InvokeFn } from '../api/client';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import { useKanbanStore } from '../hooks/useKanbanStore';
import type { BoardDto, CardListDto, ColumnDto } from '../types';

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

function card(id: string, columnId: string): CardListDto {
  return {
    id,
    column_id: columnId,
    title: id,
    has_body: false,
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

describe('useKanbanStore.openCardOnBoard race safety', () => {
  beforeEach(() => {
    installLocalStorageShim();
    useKanbanStore.setState({
      status: 'idle',
      error: null,
      boards: [board('a'), board('b'), board('c')],
      currentBoardId: 'a',
      columns: [column('ca', 'a')],
      cardsByColumn: { ca: [card('ka', 'ca')] },
      selectedCardId: null,
      tags: [],
      tagsLoaded: false,
      cardTagMap: {},
    });
  });

  afterEach(() => {
    __setInvoker(realInvoke);
  });

  it('stale openCardOnBoard does not clobber a newer board switch', async () => {
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

    // User clicks two palette results in quick succession: kB on board b,
    // then kC on board c. C resolves first; B must not write its card.
    const pB = useKanbanStore.getState().openCardOnBoard('kB', 'b');
    const pC = useKanbanStore.getState().openCardOnBoard('kC', 'c');

    resolveC();
    await pC;
    expect(useKanbanStore.getState().currentBoardId).toBe('c');

    resolveB();
    await pB;
    const s = useKanbanStore.getState();
    expect(s.currentBoardId).toBe('c');
    // selectedCardId must NOT be kB — that card doesn't exist on board c.
    expect(s.selectedCardId).not.toBe('kB');
  });

  it('skips selection when the card is not present on the loaded board', async () => {
    const invoker: InvokeFn = async (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      if (cmd === 'columns_list') {
        const boardId = a.boardId as string;
        return [column(`c${boardId}`, boardId)] as never;
      }
      if (cmd === 'cards_list') {
        const colId = a.columnId as string;
        // The board's only card is k-<col>, NOT the one we asked for.
        return [card(`k-${colId}`, colId)] as never;
      }
      return undefined as never;
    };
    __setInvoker(invoker);

    await useKanbanStore.getState().openCardOnBoard('ghost', 'b');
    expect(useKanbanStore.getState().currentBoardId).toBe('b');
    expect(useKanbanStore.getState().selectedCardId).toBeNull();
  });
});
