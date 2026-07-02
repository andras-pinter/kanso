// Regression: single-card mutations (updateCard, archiveCard) must ignore
// stale API responses. Two rapid updateCards to the same card can resolve
// out of order; the older response used to overwrite the newer store
// value. Per-card mutation-sequence gating fixes that.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setInvoker, type InvokeFn } from '../api/client';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import { useKanbanStore } from '../hooks/useKanbanStore';
import type { CardDto } from '../types';

function card(id: string, title: string): CardDto {
  return {
    id,
    column_id: 'col1',
    title,
    body_text: null,
    position: id,
    due_at: null,
    created_at: 0,
    updated_at: 0,
    archived_at: null,
  };
}

function seed(cards: CardDto[]) {
  useKanbanStore.setState({
    status: 'ready',
    error: null,
    boards: [],
    currentBoardId: 'b1',
    showArchived: false,
    columns: [
      {
        id: 'col1',
        board_id: 'b1',
        name: 'Todo',
        color: null,
        position: 'a',
        created_at: 0,
        updated_at: 0,
        archived_at: null,
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
    const aGate = deferred<CardDto>();
    const bGate = deferred<CardDto>();

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
    const aGate = deferred<CardDto>();
    const bGate = deferred<CardDto>();

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

  it('archiveCard mutation bumps the same per-card sequence as updateCard', async () => {
    // If an updateCard is already in flight and an archiveCard fires
    // after it, the archive should bump the sequence so the older
    // update's response is discarded. Practically the modal's archive
    // path (commitTitle → archiveCard) relies on this ordering.
    const updateGate = deferred<CardDto>();
    const archiveGate = deferred<CardDto>();

    const invoker: InvokeFn = async (cmd, args) => {
      if (cmd === 'card_update') {
        const a = args as { patch: { title?: string } };
        if (a.patch.title === 'A') return (await updateGate.promise) as never;
      }
      if (cmd === 'card_archive') return (await archiveGate.promise) as never;
      return undefined as never;
    };
    __setInvoker(invoker);

    const pUpdate = useKanbanStore.getState().updateCard('c1', { title: 'A' });
    const pArchive = useKanbanStore.getState().archiveCard('c1');

    // Archive resolves first — card gone from store.
    archiveGate.resolve(card('c1', 'orig'));
    await pArchive;
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

  it('archiveCard returns true on success and removes the card', async () => {
    __setInvoker(async (cmd) => {
      if (cmd === 'card_archive') return undefined as never;
      return undefined as never;
    });
    const ok = await useKanbanStore.getState().archiveCard('c1');
    expect(ok).toBe(true);
    expect(
      useKanbanStore.getState().cardsByColumn.col1?.find((c) => c.id === 'c1'),
    ).toBeUndefined();
  });

  it('archiveCard returns false on API rejection and keeps the card', async () => {
    __setInvoker(async (cmd) => {
      if (cmd === 'card_archive') throw new Error('boom');
      return undefined as never;
    });
    const ok = await useKanbanStore.getState().archiveCard('c1');
    expect(ok).toBe(false);
    // Pessimistic: card was never removed, so nothing to roll back.
    expect(
      useKanbanStore.getState().cardsByColumn.col1?.find((c) => c.id === 'c1')?.title,
    ).toBe('orig');
    expect(useKanbanStore.getState().error).toMatch(/boom/);
  });

  it('archiveCard returns true when a stale response arrives after a newer mutation', async () => {
    // Newer mutation wins the store; the archive API call itself still
    // succeeded on the server so we report true to the caller. Callers
    // that own dependent UI (e.g. the modal close) get the "safe to
    // proceed" signal even in the stale case.
    const archiveGate = deferred<undefined>();
    __setInvoker(async (cmd) => {
      if (cmd === 'card_archive') return (await archiveGate.promise) as never;
      if (cmd === 'card_update') return card('c1', 'newer') as never;
      return undefined as never;
    });

    const pArchive = useKanbanStore.getState().archiveCard('c1');
    // A newer mutation bumps the sequence past the archive.
    await useKanbanStore.getState().updateCard('c1', { title: 'newer' });
    archiveGate.resolve(undefined);
    const ok = await pArchive;
    expect(ok).toBe(true);
    // The newer update's state stands.
    expect(
      useKanbanStore.getState().cardsByColumn.col1?.find((c) => c.id === 'c1')?.title,
    ).toBe('newer');
  });
});
