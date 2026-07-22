// Regression: single-card mutations (updateCard, deleteCard) must ignore
// stale API responses for field-level state. Two rapid updateCards to the
// same card can resolve out of order; the older response used to overwrite
// the newer store value. Per-card mutation-sequence gating fixes that.
// Delete success is terminal for the visible list — the card is gone on
// the server, so it must be removed regardless of a newer mutation's seq.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setInvoker, type InvokeFn } from '../api/client';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import { useKanbanStore } from '../hooks/useKanbanStore';
import type { CardListDto } from '../types';

function card(id: string, title: string): CardListDto {
  return {
    id,
    column_id: 'col1',
    title,
    has_body: false,
    position: id,
    due_at: null,
    created_at: 0,
    updated_at: 0,
  };
}

function seed(cards: CardListDto[]) {
  useKanbanStore.setState({
    status: 'ready',
    error: null,
    boards: [],
    currentBoardId: 'b1',
    columns: [
      {
        id: 'col1',
        board_id: 'b1',
        name: 'Todo',
        color: null,
        position: 'a',
        created_at: 0,
        updated_at: 0,
      },
    ],
    cardsByColumn: { col1: cards },
    selectedCardId: cards[0]?.id ?? null,
    tags: [],
    tagsLoaded: true,
    cardTagMap: {},
    selectedTagIds: [],
  });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useKanbanStore card mutation race gating', () => {
  beforeEach(() => {
    seed([card('c1', 'orig')]);
  });

  afterEach(() => {
    __setInvoker(realInvoke);
  });

  it('slow updateCard(A) then fast updateCard(B): store ends as B', async () => {
    const aGate = deferred<CardListDto>();
    const bGate = deferred<CardListDto>();

    const invoker: InvokeFn = async (cmd, args) => {
      if (cmd === 'card_update') {
        const a = args as { id: string; patch: { title?: string } };
        if (a.patch.title === 'A') return (await aGate.promise) as never;
        if (a.patch.title === 'B') return (await bGate.promise) as never;
      }
      return undefined as never;
    };
    __setInvoker(invoker);

    const pA = useKanbanStore.getState().updateCard('c1', { title: 'A' });
    const pB = useKanbanStore.getState().updateCard('c1', { title: 'B' });

    // Resolve B first with server-echoed title 'B'.
    bGate.resolve(card('c1', 'B'));
    await pB;
    expect(
      useKanbanStore.getState().cardsByColumn.col1?.find((c) => c.id === 'c1')?.title,
    ).toBe('B');

    // Late A response must be dropped on the floor.
    aGate.resolve(card('c1', 'A'));
    await pA;
    expect(
      useKanbanStore.getState().cardsByColumn.col1?.find((c) => c.id === 'c1')?.title,
    ).toBe('B');
  });

  it('older updateCard error after newer success does not rollback', async () => {
    const aGate = deferred<CardListDto>();
    const bGate = deferred<CardListDto>();

    const invoker: InvokeFn = async (cmd, args) => {
      if (cmd === 'card_update') {
        const a = args as { id: string; patch: { title?: string } };
        if (a.patch.title === 'A') return (await aGate.promise) as never;
        if (a.patch.title === 'B') return (await bGate.promise) as never;
      }
      return undefined as never;
    };
    __setInvoker(invoker);

    const pA = useKanbanStore.getState().updateCard('c1', { title: 'A' });
    const pB = useKanbanStore.getState().updateCard('c1', { title: 'B' });

    bGate.resolve(card('c1', 'B'));
    await pB;
    expect(
      useKanbanStore.getState().cardsByColumn.col1?.find((c) => c.id === 'c1')?.title,
    ).toBe('B');

    // Older call rejects — must NOT rollback to prior 'orig' or set error.
    aGate.reject(new Error('boom'));
    await pA;
    const s = useKanbanStore.getState();
    expect(s.cardsByColumn.col1?.find((c) => c.id === 'c1')?.title).toBe('B');
    expect(s.error).toBeNull();
  });

  it('deleteCard mutation bumps the same per-card sequence as updateCard', async () => {
    // If an updateCard is already in flight and an deleteCard fires
    // after it, the delete should bump the sequence so the older
    // update's response is discarded. Practically the modal's delete
    // path (commitTitle → deleteCard) relies on this ordering.
    const updateGate = deferred<CardListDto>();
    const deleteGate = deferred<CardListDto>();

    const invoker: InvokeFn = async (cmd, args) => {
      if (cmd === 'card_update') {
        const a = args as { patch: { title?: string } };
        if (a.patch.title === 'A') return (await updateGate.promise) as never;
      }
      if (cmd === 'card_delete') return (await deleteGate.promise) as never;
      return undefined as never;
    };
    __setInvoker(invoker);

    const pUpdate = useKanbanStore.getState().updateCard('c1', { title: 'A' });
    const pDelete = useKanbanStore.getState().deleteCard('c1');

    // Delete resolves first — card gone from store.
    deleteGate.resolve(card('c1', 'orig'));
    await pDelete;
    expect(
      useKanbanStore.getState().cardsByColumn.col1?.find((c) => c.id === 'c1'),
    ).toBeUndefined();

    // Late update response must not resurrect the card.
    updateGate.resolve(card('c1', 'A'));
    await pUpdate;
    expect(
      useKanbanStore.getState().cardsByColumn.col1?.find((c) => c.id === 'c1'),
    ).toBeUndefined();
  });

  it('deleteCard returns true on success and removes the card', async () => {
    __setInvoker(async (cmd) => {
      if (cmd === 'card_delete') return undefined as never;
      return undefined as never;
    });
    const ok = await useKanbanStore.getState().deleteCard('c1');
    expect(ok).toBe(true);
    expect(
      useKanbanStore.getState().cardsByColumn.col1?.find((c) => c.id === 'c1'),
    ).toBeUndefined();
  });

  it('deleteCard returns false on API rejection and keeps the card', async () => {
    __setInvoker(async (cmd) => {
      if (cmd === 'card_delete') throw new Error('boom');
      return undefined as never;
    });
    const ok = await useKanbanStore.getState().deleteCard('c1');
    expect(ok).toBe(false);
    // Pessimistic: card was never removed, so nothing to roll back.
    expect(
      useKanbanStore.getState().cardsByColumn.col1?.find((c) => c.id === 'c1')?.title,
    ).toBe('orig');
    expect(useKanbanStore.getState().error).toMatch(/boom/);
  });

  it('deleteCard removes the card even when a newer mutation bumped the seq (stale success)', async () => {
    // Delete success is terminal for the visible list — the server
    // deleted the card, so the UI must drop it regardless of a
    // concurrent updateCard's newer sequence. Anything else leaves a
    // ghost card until the next full reload.
    const deleteGate = deferred<undefined>();
    __setInvoker(async (cmd) => {
      if (cmd === 'card_delete') return (await deleteGate.promise) as never;
      if (cmd === 'card_update') return card('c1', 'newer') as never;
      return undefined as never;
    });

    useKanbanStore.setState({ selectedCardId: 'c1' });
    const pDelete = useKanbanStore.getState().deleteCard('c1');
    // A newer mutation bumps the sequence past the delete.
    await useKanbanStore.getState().updateCard('c1', { title: 'newer' });
    deleteGate.resolve(undefined);
    const ok = await pDelete;
    expect(ok).toBe(true);
    expect(
      useKanbanStore.getState().cardsByColumn.col1?.find((c) => c.id === 'c1'),
    ).toBeUndefined();
    expect(useKanbanStore.getState().selectedCardId).toBeNull();
  });

  it('deleteCard returns false on stale failure without rolling back', async () => {
    // Pessimistic delete never removed the card, so a stale failure
    // needs no rollback. The seq guard suppresses the error surface
    // because a newer mutation already owns the store state.
    const deleteGate = deferred<undefined>();
    __setInvoker(async (cmd) => {
      if (cmd === 'card_delete') return (await deleteGate.promise) as never;
      if (cmd === 'card_update') return card('c1', 'newer') as never;
      return undefined as never;
    });

    useKanbanStore.setState({ selectedCardId: 'c1' });
    const pDelete = useKanbanStore.getState().deleteCard('c1');
    await useKanbanStore.getState().updateCard('c1', { title: 'newer' });
    deleteGate.reject(new Error('boom'));
    const ok = await pDelete;
    expect(ok).toBe(false);
    const s = useKanbanStore.getState();
    expect(s.cardsByColumn.col1?.find((c) => c.id === 'c1')?.title).toBe('newer');
    expect(s.selectedCardId).toBe('c1');
    expect(s.error).toBeNull();
  });
});
