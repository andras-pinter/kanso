import { forwardRef, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import { __setInvoker, type InvokeFn } from '../api/client';
import { useKanbanStore } from '../hooks/useKanbanStore';
import type { CardDto } from '../types';

// Module-level controls for the mocked CardBodyEditor. Each test sets a
// `flushImpl` that returns a deferred / rejection so we can drive the
// close/archive coordination paths.
const editorState: { flushImpl: () => Promise<void>; flushCalls: number } = {
  flushImpl: () => Promise.resolve(),
  flushCalls: 0,
};

vi.mock('../CardBodyEditor', () => {
  const Editor = forwardRef<{ flush: () => Promise<void> }>((_props, ref) => {
    useImperativeHandle(ref, () => ({
      flush: () => {
        editorState.flushCalls += 1;
        return editorState.flushImpl();
      },
    }));
    return <div data-testid="body-editor-mock" />;
  });
  Editor.displayName = 'CardBodyEditorMock';
  return { default: Editor };
});

// Avoid pulling tag/due network paths into modal tests.
vi.mock('../TagPickerPopover', () => ({
  default: () => <div data-testid="tag-picker-mock" />,
}));
vi.mock('../DueDateEditor', () => ({
  default: () => <div data-testid="due-date-mock" />,
}));

import CardDetailModal from '../CardDetailModal';

function card(id = 'c1', title = 'Hello'): CardDto {
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

function resetStore(seed: CardDto) {
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
        color: '#abcdef',
        position: 'a',
        created_at: 0,
        updated_at: 0,
        archived_at: null,
      },
    ],
    cardsByColumn: { col1: [seed] },
    selectedCardId: seed.id,
    tags: [],
    tagsLoaded: true,
    cardTagMap: {},
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

describe('CardDetailModal', () => {
  beforeEach(() => {
    editorState.flushImpl = () => Promise.resolve();
    editorState.flushCalls = 0;
    resetStore(card());
  });

  afterEach(() => {
    __setInvoker(realInvoke);
    vi.restoreAllMocks();
  });

  it('renders dialog with title, tag picker, due date, and body slot', () => {
    __setInvoker(async () => undefined as never);
    render(<CardDetailModal card={card()} />);
    expect(screen.getByRole('dialog', { name: /card detail/i })).toBeTruthy();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Hello');
    expect(screen.getByTestId('tag-picker-mock')).toBeTruthy();
    expect(screen.getByTestId('due-date-mock')).toBeTruthy();
  });

  it('title blur with change calls card_update', async () => {
    let updateArgs: { id: string; patch: unknown } | null = null;
    const invoker: InvokeFn = async (cmd, args) => {
      if (cmd === 'card_update') {
        const a = args as { id: string; patch: unknown };
        updateArgs = { id: a.id, patch: a.patch };
        return card('c1', 'New title') as never;
      }
      return undefined as never;
    };
    __setInvoker(invoker);
    render(<CardDetailModal card={card()} />);
    const input = screen.getByLabelText('Title') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'New title' } });
    fireEvent.blur(input);
    await waitFor(() => expect(updateArgs).not.toBeNull());
    expect(updateArgs!.id).toBe('c1');
  });

  it('backdrop click awaits flush then deselects', async () => {
    const def = deferred<void>();
    editorState.flushImpl = () => def.promise;
    __setInvoker(async () => undefined as never);
    render(<CardDetailModal card={card()} />);

    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(editorState.flushCalls).toBe(1);
    expect(useKanbanStore.getState().selectedCardId).toBe('c1');

    await act(async () => {
      def.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(useKanbanStore.getState().selectedCardId).toBeNull());
  });

  it('backdrop click while flush rejects keeps modal open and shows banner', async () => {
    editorState.flushImpl = () => Promise.reject(new Error('save failed'));
    __setInvoker(async () => undefined as never);
    render(<CardDetailModal card={card()} />);

    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    await act(async () => {
      fireEvent.click(backdrop);
    });

    expect(useKanbanStore.getState().selectedCardId).toBe('c1');
    expect(screen.getByRole('alert').textContent).toMatch(/Can.t close yet/);
  });

  it('Escape key triggers close path', async () => {
    __setInvoker(async () => undefined as never);
    render(<CardDetailModal card={card()} />);
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    expect(editorState.flushCalls).toBe(1);
    await waitFor(() => expect(useKanbanStore.getState().selectedCardId).toBeNull());
  });

  it('Escape retries flush after closeBlocked', async () => {
    editorState.flushImpl = () => Promise.reject(new Error('save failed'));
    __setInvoker(async () => undefined as never);
    render(<CardDetailModal card={card()} />);
    const dialog = screen.getByRole('dialog');

    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(editorState.flushCalls).toBe(1);

    editorState.flushImpl = () => Promise.resolve();
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    expect(editorState.flushCalls).toBe(2);
    await waitFor(() => expect(useKanbanStore.getState().selectedCardId).toBeNull());
  });

  it('archive awaits flush then calls card_archive', async () => {
    const def = deferred<void>();
    editorState.flushImpl = () => def.promise;
    let archived = false;
    const invoker: InvokeFn = async (cmd) => {
      if (cmd === 'card_archive') {
        archived = true;
        return undefined as never;
      }
      return undefined as never;
    };
    __setInvoker(invoker);
    render(<CardDetailModal card={card()} />);

    fireEvent.click(screen.getByRole('button', { name: /archive/i }));
    expect(editorState.flushCalls).toBe(1);
    expect(archived).toBe(false);

    await act(async () => {
      def.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(archived).toBe(true));
  });

  it('archive while flush rejects does not call card_archive', async () => {
    editorState.flushImpl = () => Promise.reject(new Error('save failed'));
    let archived = false;
    const invoker: InvokeFn = async (cmd) => {
      if (cmd === 'card_archive') {
        archived = true;
        return undefined as never;
      }
      return undefined as never;
    };
    __setInvoker(invoker);
    render(<CardDetailModal card={card()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /archive/i }));
    });

    expect(archived).toBe(false);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('Tab from last focusable wraps to first', async () => {
    __setInvoker(async () => undefined as never);
    render(<CardDetailModal card={card()} />);
    const dialog = screen.getByRole('dialog');
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    expect(first).toBeTruthy();
    expect(last).toBeTruthy();

    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
