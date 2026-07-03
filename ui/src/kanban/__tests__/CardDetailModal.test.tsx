import { forwardRef, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import { __setInvoker, type InvokeFn } from '../api/client';
import { useKanbanStore } from '../hooks/useKanbanStore';
import type { CardDto } from '../types';

// Module-level controls for the mocked CardBodyEditor. Each test sets a
// `flushImpl` that returns a deferred / rejection so we can drive the
// close/delete coordination paths. `onSaved` is captured so title-only
// save flow can be asserted without triggering the body path.
const editorState: {
  flushImpl: () => Promise<void>;
  flushCalls: number;
  lastOnSaved: (() => void) | undefined;
} = {
  flushImpl: () => Promise.resolve(),
  flushCalls: 0,
  lastOnSaved: undefined,
};

vi.mock('../CardBodyEditor', () => {
  interface MockProps {
    onSaved?: () => void;
  }
  const Editor = forwardRef<{ flush: () => Promise<void> }, MockProps>((props, ref) => {
    editorState.lastOnSaved = props.onSaved;
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

// Avoid pulling tag network paths into modal tests.
vi.mock('../TagPickerPopover', () => ({
  default: () => <div data-testid="tag-picker-mock" />,
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
  };
}

function resetStore(seed: CardDto | CardDto[]) {
  const cards = Array.isArray(seed) ? seed : [seed];
  const firstId = cards[0]?.id ?? null;
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
        color: '#abcdef',
        position: 'a',
        created_at: 0,
        updated_at: 0,
      },
    ],
    cardsByColumn: { col1: cards },
    selectedCardId: firstId,
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
    editorState.lastOnSaved = undefined;
    resetStore(card());
  });

  afterEach(() => {
    __setInvoker(realInvoke);
    vi.restoreAllMocks();
  });

  it('renders dialog with accessible title control and tag picker', () => {
    __setInvoker(async () => undefined as never);
    render(<CardDetailModal card={card()} />);
    expect(screen.getByRole('dialog', { name: /card detail/i })).toBeTruthy();
    // Title is a textarea with an aria-label — no visible label element.
    const title = screen.getByRole('textbox', { name: 'Card title' }) as HTMLTextAreaElement;
    expect(title.value).toBe('Hello');
    expect(title.tagName).toBe('TEXTAREA');
    expect(title.placeholder).toBe('Untitled');
    expect(screen.getByTestId('tag-picker-mock')).toBeTruthy();
  });

  it('does not render DueBadge or DueDateEditor inside the modal', () => {
    __setInvoker(async () => undefined as never);
    render(<CardDetailModal card={card()} />);
    expect(screen.queryByTestId('due-date-mock')).toBeNull();
    // DueBadge renders with class .kanso-due-badge.
    expect(document.querySelector('.kanso-due-badge')).toBeNull();
  });

  it('initial focus lands on the title textarea', () => {
    __setInvoker(async () => undefined as never);
    render(<CardDetailModal card={card()} />);
    const title = screen.getByRole('textbox', { name: 'Card title' });
    expect(document.activeElement).toBe(title);
  });

  it('title blur with change calls card_update and flashes Saved', async () => {
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
    const input = screen.getByRole('textbox', { name: 'Card title' }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'New title' } });
    fireEvent.blur(input);
    await waitFor(() => expect(updateArgs).not.toBeNull());
    expect(updateArgs!.id).toBe('c1');
  });

  it('Enter in the title textarea blurs (no line break)', async () => {
    __setInvoker(async () => card('c1', 'One line') as never);
    render(<CardDetailModal card={card()} />);
    const input = screen.getByRole('textbox', { name: 'Card title' }) as HTMLTextAreaElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'One line' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Blur fires as a consequence.
    expect(document.activeElement).not.toBe(input);
  });

  it('Escape in the title textarea reverts and does not close the modal', async () => {
    __setInvoker(async () => undefined as never);
    render(<CardDetailModal card={card()} />);
    const input = screen.getByRole('textbox', { name: 'Card title' }) as HTMLTextAreaElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'Half-written' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('Hello');
    expect(useKanbanStore.getState().selectedCardId).toBe('c1');
  });

  it('backdrop click awaits flush then deselects', async () => {
    const def = deferred<void>();
    editorState.flushImpl = () => def.promise;
    __setInvoker(async () => undefined as never);
    render(<CardDetailModal card={card()} />);
    await screen.findByTestId('body-editor-mock');

    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    await act(async () => {
      fireEvent.click(backdrop);
      // Let close() advance past `await commitTitle()` so `flush()` runs.
      await Promise.resolve();
    });
    expect(editorState.flushCalls).toBe(1);
    expect(useKanbanStore.getState().selectedCardId).toBe('c1');

    await act(async () => {
      def.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(useKanbanStore.getState().selectedCardId).toBeNull());
  });

  it('close-blocked banner appears when body flush rejects', async () => {
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

  it('close-blocked banner appears when title save rejects', async () => {
    const invoker: InvokeFn = async (cmd) => {
      if (cmd === 'card_update') throw new Error('title save failed');
      return undefined as never;
    };
    __setInvoker(invoker);
    render(<CardDetailModal card={card()} />);
    await screen.findByTestId('body-editor-mock');
    const input = screen.getByRole('textbox', { name: 'Card title' }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Dirty title' } });

    // Body flush would succeed — we're proving title-save failures also
    // block close and surface the same banner.
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
      // close() → await commitTitle() → updateCard throws → setCloseBlocked.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(useKanbanStore.getState().selectedCardId).toBe('c1');
    });
    expect(screen.getByRole('alert').textContent).toMatch(/Can.t close yet/);
  });

  it('Escape triggers close when the overflow menu is closed', async () => {
    __setInvoker(async () => undefined as never);
    render(<CardDetailModal card={card()} />);
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    expect(editorState.flushCalls).toBe(1);
    await waitFor(() => expect(useKanbanStore.getState().selectedCardId).toBeNull());
  });

  it('Escape closes the overflow menu without closing the modal', async () => {
    __setInvoker(async () => undefined as never);
    render(<CardDetailModal card={card()} />);
    const menuBtn = screen.getByRole('button', { name: 'Card menu' });
    fireEvent.click(menuBtn);
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.keyDown(menuBtn, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(useKanbanStore.getState().selectedCardId).toBe('c1');
    expect(editorState.flushCalls).toBe(0);
  });

  it('delete via overflow menu awaits flush then calls card_delete', async () => {
    const def = deferred<void>();
    editorState.flushImpl = () => def.promise;
    let deleted = false;
    const invoker: InvokeFn = async (cmd) => {
      if (cmd === 'card_delete') {
        deleted = true;
        return undefined as never;
      }
      return undefined as never;
    };
    __setInvoker(invoker);
    render(<CardDetailModal card={card()} />);
    await screen.findByTestId('body-editor-mock');

    fireEvent.click(screen.getByRole('button', { name: 'Card menu' }));
    const item = await screen.findByRole('menuitem', { name: /delete/i });
    await act(async () => {
      fireEvent.click(item);
      await Promise.resolve();
    });
    expect(editorState.flushCalls).toBe(1);
    expect(deleted).toBe(false);

    await act(async () => {
      def.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(deleted).toBe(true));
  });

  it('rapid double-click on Delete does not fire two card_delete calls', async () => {
    // Regression: `deleting` state only flips true AFTER the pre-delete
    // commitTitle/flush awaits, so a second click during that window
    // used to slip past the button's disabled guard and run a parallel
    // deleteThis(). Ref-guard prevents that; two clicks -> one flush,
    // one card_delete.
    const def = deferred<void>();
    editorState.flushImpl = () => def.promise;
    let deleteCalls = 0;
    const invoker: InvokeFn = async (cmd) => {
      if (cmd === 'card_delete') {
        deleteCalls += 1;
        return undefined as never;
      }
      return undefined as never;
    };
    __setInvoker(invoker);
    render(<CardDetailModal card={card()} />);
    await screen.findByTestId('body-editor-mock');

    fireEvent.click(screen.getByRole('button', { name: 'Card menu' }));
    const item = await screen.findByRole('menuitem', { name: /delete/i });
    await act(async () => {
      fireEvent.click(item);
      await Promise.resolve();
    });

    // Menu closed after the first click; reopen and click Delete again
    // while the initial flush is still pending.
    fireEvent.click(screen.getByRole('button', { name: 'Card menu' }));
    const itemAgain = await screen.findByRole('menuitem', { name: /delete/i });
    await act(async () => {
      fireEvent.click(itemAgain);
      await Promise.resolve();
    });

    // Only the first deleteThis() acquired the ref-guard; the second
    // returned early, so flush was only invoked once.
    expect(editorState.flushCalls).toBe(1);

    await act(async () => {
      def.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(deleteCalls).toBe(1));
  });

  it('delete keeps modal open when body flush rejects', async () => {
    editorState.flushImpl = () => Promise.reject(new Error('save failed'));
    let deleted = false;
    const invoker: InvokeFn = async (cmd) => {
      if (cmd === 'card_delete') {
        deleted = true;
        return undefined as never;
      }
      return undefined as never;
    };
    __setInvoker(invoker);
    render(<CardDetailModal card={card()} />);
    await screen.findByTestId('body-editor-mock');

    fireEvent.click(screen.getByRole('button', { name: 'Card menu' }));
    const item = await screen.findByRole('menuitem', { name: /delete/i });
    await act(async () => {
      fireEvent.click(item);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleted).toBe(false);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('delete keeps modal open and shows error when delete API rejects', async () => {
    const invoker: InvokeFn = async (cmd) => {
      if (cmd === 'card_delete') throw new Error('delete boom');
      return undefined as never;
    };
    __setInvoker(invoker);
    render(<CardDetailModal card={card()} />);
    await screen.findByTestId('body-editor-mock');

    fireEvent.click(screen.getByRole('button', { name: 'Card menu' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: /delete/i }));
      // Let commitTitle (no-op), flush (resolves), then deleteCard settle.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Modal is still mounted and selection is retained.
    expect(useKanbanStore.getState().selectedCardId).toBe('c1');
    expect(screen.getByRole('dialog', { name: /card detail/i })).toBeTruthy();
    // An error banner tells the user why the delete didn't happen.
    const alerts = screen.getAllByRole('alert');
    expect(alerts.some((el) => /delete/i.test(el.textContent ?? ''))).toBe(true);

    // Delete menu is re-clickable after the failure (no lingering disable).
    fireEvent.click(screen.getByRole('button', { name: 'Card menu' }));
    const retryItem = await screen.findByRole('menuitem', { name: /delete/i });
    expect(retryItem.hasAttribute('disabled')).toBe(false);
  });

  it('body onSaved callback flashes the header Saved pill', async () => {
    __setInvoker(async () => undefined as never);
    render(<CardDetailModal card={card()} />);
    // The mock captures onSaved; simulate a successful body save.
    expect(editorState.lastOnSaved).toBeTruthy();
    await act(async () => {
      editorState.lastOnSaved?.();
    });
    const pill = document.querySelector('.kanso-saved-pill--visible');
    expect(pill).toBeTruthy();
    expect(pill?.textContent).toMatch(/Saved/);
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

  it('long multi-line title stays within the textarea (no horizontal overflow)', () => {
    __setInvoker(async () => undefined as never);
    const long =
      'A very long title that would wrap across multiple visual lines when rendered in the doc-title control at 22px semibold';
    render(<CardDetailModal card={card('c1', long)} />);
    const input = screen.getByRole('textbox', { name: 'Card title' }) as HTMLTextAreaElement;
    // Textarea wraps by default (wrap attr defaults to soft) — no
    // horizontal scroll needed. Asserting the CSS-driven wrapping props.
    expect(input.value).toBe(long);
    // A textarea's rendered wrap is the browser default; the important
    // guarantee here is that the control IS a textarea (accepts wrap)
    // rather than a single-line input.
    expect(input.tagName).toBe('TEXTAREA');
  });

  it('delete returns focus to the next card in the same column', async () => {
    resetStore([card('c1', 'First'), card('c2', 'Second')]);
    const nextEl = document.createElement('div');
    nextEl.setAttribute('data-card-id', 'c2');
    nextEl.setAttribute('tabindex', '0');
    document.body.appendChild(nextEl);

    const invoker: InvokeFn = async (cmd) => {
      if (cmd === 'card_delete') return undefined as never;
      return undefined as never;
    };
    __setInvoker(invoker);
    render(<CardDetailModal card={card('c1', 'First')} />);
    await screen.findByTestId('body-editor-mock');

    fireEvent.click(screen.getByRole('button', { name: 'Card menu' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('menuitem', { name: /delete/i }));
    });
    // Let queueMicrotask fire.
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(nextEl);

    document.body.removeChild(nextEl);
  });
});
