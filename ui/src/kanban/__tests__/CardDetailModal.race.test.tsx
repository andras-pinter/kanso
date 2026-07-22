// Regression: title blur followed by rapid re-edit + close must not
// commit stale state. When the blur's card_update resolves LATER than
// the close's card_update, the store must reflect the newer title and
// the close must NOT surface a stale-save banner.

import { forwardRef, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import { __setInvoker, type InvokeFn } from '../api/client';
import { useKanbanStore } from '../hooks/useKanbanStore';
import type { CardListDto } from '../types';

vi.mock('../CardBodyEditor', () => {
  const Editor = forwardRef<{ flush: () => Promise<void> }>((_props, ref) => {
    useImperativeHandle(ref, () => ({ flush: () => Promise.resolve() }));
    return <div data-testid="body-editor-mock" />;
  });
  Editor.displayName = 'CardBodyEditorMock';
  return { default: Editor };
});

vi.mock('../TagPickerPopover', () => ({
  default: () => <div data-testid="tag-picker-mock" />,
}));

import CardDetailModal from '../CardDetailModal';

function card(id = 'c1', title = 'orig'): CardListDto {
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

function seedStore(c: CardListDto) {
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
    cardsByColumn: { col1: [c] },
    selectedCardId: c.id,
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

describe('CardDetailModal title-save race', () => {
  beforeEach(() => {
    seedStore(card());
  });

  afterEach(() => {
    __setInvoker(realInvoke);
    vi.restoreAllMocks();
  });

  it('blur → type → close with out-of-order responses commits the newer title', async () => {
    const aGate = deferred<CardListDto>();
    const bGate = deferred<CardListDto>();
    const seen: string[] = [];

    const invoker: InvokeFn = async (cmd, args) => {
      if (cmd === 'card_update') {
        const a = args as { patch: { title?: string } };
        const t = a.patch.title ?? '';
        seen.push(t);
        if (t === 'A') return (await aGate.promise) as never;
        if (t === 'B') return (await bGate.promise) as never;
      }
      return undefined as never;
    };
    __setInvoker(invoker);

    render(<CardDetailModal card={card()} />);
    const input = screen.getByRole('textbox', { name: 'Card title' }) as HTMLTextAreaElement;

    // Type "A" and blur → fires update for "A" (still pending).
    fireEvent.change(input, { target: { value: 'A' } });
    fireEvent.blur(input);
    await waitFor(() => expect(seen).toContain('A'));

    // Re-type to "B" and close → fires update for "B" (still pending).
    fireEvent.change(input, { target: { value: 'B' } });
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(seen).toContain('B'));

    // Resolve B first (the newer save wins).
    await act(async () => {
      bGate.resolve(card('c1', 'B'));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Then resolve the older A response — must be discarded.
    await act(async () => {
      aGate.resolve(card('c1', 'A'));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(useKanbanStore.getState().selectedCardId).toBeNull());
    const stored = useKanbanStore.getState().cardsByColumn.col1?.find((c) => c.id === 'c1');
    expect(stored?.title).toBe('B');
    // The stale blur must not have raised a close-blocked banner after
    // the newer save landed.
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
