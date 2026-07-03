import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import { __setInvoker, type InvokeFn } from '../../kanban/api/client';
import { useKanbanStore } from '../../kanban/hooks/useKanbanStore';
import type { BoardDto, ColumnDto, CardDto } from '../../kanban/types';
import QuickAddModal from '../QuickAddModal';

function board(id: string, name: string): BoardDto {
  return {
    id,
    name,
    position: id,
    color: null,
    created_at: 0,
    updated_at: 0,
  };
}

function column(id: string, board_id: string, name: string): ColumnDto {
  return {
    id,
    board_id,
    name,
    position: id,
    color: null,
    created_at: 0,
    updated_at: 0,
  };
}

function card(id: string, column_id: string, title: string): CardDto {
  return {
    id,
    column_id,
    title,
    body_text: null,
    position: id,
    due_at: null,
    created_at: 0,
    updated_at: 0,
  };
}

interface SeedOpts {
  currentBoardId: string | null;
  columns?: ColumnDto[];
}

function seedStore(opts: SeedOpts) {
  const b1 = board('b1', 'Personal');
  const b2 = board('b2', 'Work');
  const cols = opts.columns ?? [
    column('col1', 'b1', 'Incoming'),
    column('col2', 'b1', 'Todo'),
    column('col3', 'b1', 'Done'),
  ];
  useKanbanStore.setState({
    status: 'ready',
    error: null,
    boards: [b1, b2],
    currentBoardId: opts.currentBoardId,
    columns: cols,
    cardsByColumn: Object.fromEntries(cols.map((c) => [c.id, []])),
    selectedCardId: null,
    tags: [],
    tagsLoaded: true,
    cardTagMap: {},
  });
}

describe('QuickAddModal', () => {
  beforeEach(() => {
    seedStore({ currentBoardId: 'b1' });
  });

  afterEach(() => {
    __setInvoker(realInvoke);
    vi.restoreAllMocks();
  });

  it('renders title input, focused, and target label for current board', () => {
    __setInvoker(async () => undefined as never);
    render(<QuickAddModal onClose={() => undefined} />);
    expect(screen.getByRole('dialog', { name: /quick add card/i })).toBeTruthy();

    const titleInput = screen.getByLabelText('Title') as HTMLInputElement;
    expect(titleInput).toBeTruthy();
    expect(document.activeElement).toBe(titleInput);

    expect(screen.getByText(/Adding to: Personal · Incoming/i)).toBeTruthy();
    expect(screen.queryByLabelText('Board')).toBeNull();
    expect(screen.queryByLabelText('Column')).toBeNull();
  });

  it('submitting calls card_create on the Incoming column then closes', async () => {
    let createArgs: { columnId: string; title: string } | null = null;
    const invoker: InvokeFn = async (cmd, args) => {
      if (cmd === 'card_create') {
        const a = args as { columnId: string; title: string };
        createArgs = { columnId: a.columnId, title: a.title };
        return card('c1', a.columnId, a.title) as never;
      }
      return undefined as never;
    };
    __setInvoker(invoker);

    const closeSpy = vi.fn();
    render(<QuickAddModal onClose={closeSpy} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Buy milk' } });
    fireEvent.submit(screen.getByLabelText('Title').closest('form')!);

    await waitFor(() => expect(closeSpy).toHaveBeenCalled());
    expect(createArgs).toEqual({ columnId: 'col1', title: 'Buy milk' });
  });

  it('matches Incoming case-insensitively', async () => {
    seedStore({
      currentBoardId: 'b1',
      columns: [
        column('cX', 'b1', '  incoming  '),
        column('cY', 'b1', 'Todo'),
      ],
    });
    let createArgs: { columnId: string; title: string } | null = null;
    __setInvoker(async (cmd, args) => {
      if (cmd === 'card_create') {
        const a = args as { columnId: string; title: string };
        createArgs = { columnId: a.columnId, title: a.title };
        return card('c1', a.columnId, a.title) as never;
      }
      return undefined as never;
    });

    const closeSpy = vi.fn();
    render(<QuickAddModal onClose={closeSpy} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'test' } });
    fireEvent.submit(screen.getByLabelText('Title').closest('form')!);

    await waitFor(() => expect(closeSpy).toHaveBeenCalled());
    expect(createArgs).toEqual({ columnId: 'cX', title: 'test' });
  });

  it('Esc closes', () => {
    __setInvoker(async () => undefined as never);
    const closeSpy = vi.fn();
    render(<QuickAddModal onClose={closeSpy} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(closeSpy).toHaveBeenCalled();
  });

  it('clicking the backdrop closes', () => {
    __setInvoker(async () => undefined as never);
    const closeSpy = vi.fn();
    const { container } = render(<QuickAddModal onClose={closeSpy} />);
    const backdrop = container.querySelector('.kanso-modal-backdrop') as HTMLElement;
    fireEvent.click(backdrop);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('empty title disables submit', () => {
    __setInvoker(async () => undefined as never);
    render(<QuickAddModal onClose={() => undefined} />);
    const btn = screen.getByRole('button', { name: /add card/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'hi' } });
    expect(btn.disabled).toBe(false);
  });

  it('shows error and disables submit when no Incoming column exists', () => {
    seedStore({
      currentBoardId: 'b1',
      columns: [column('c1', 'b1', 'Todo'), column('c2', 'b1', 'Done')],
    });
    __setInvoker(async () => undefined as never);
    render(<QuickAddModal onClose={() => undefined} />);
    expect(screen.getByText(/No Incoming column/i)).toBeTruthy();
    const btn = screen.getByRole('button', { name: /add card/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('shows error and disables submit when no boards exist', () => {
    useKanbanStore.setState({
      status: 'ready',
      error: null,
      boards: [],
      currentBoardId: null,
      columns: [],
      cardsByColumn: {},
      selectedCardId: null,
      tags: [],
      tagsLoaded: true,
      cardTagMap: {},
    });
    __setInvoker(async () => undefined as never);
    render(<QuickAddModal onClose={() => undefined} />);
    expect(screen.getByText(/No boards yet/i)).toBeTruthy();
    const btn = screen.getByRole('button', { name: /add card/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('falls back to first board and lazy-fetches its columns when currentBoardId is null', async () => {
    seedStore({ currentBoardId: null });
    const calls: string[] = [];
    __setInvoker(async (cmd, args) => {
      calls.push(cmd);
      if (cmd === 'columns_list') {
        const a = args as { boardId: string };
        return [column('bc1', a.boardId, 'Incoming'), column('bc2', a.boardId, 'Todo')] as never;
      }
      if (cmd === 'card_create') {
        const a = args as { columnId: string; title: string };
        return card('c1', a.columnId, a.title) as never;
      }
      return undefined as never;
    });

    const closeSpy = vi.fn();
    render(<QuickAddModal onClose={closeSpy} />);
    expect(screen.getByText(/Adding to: Personal · Incoming/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'via api' } });

    await waitFor(() => expect(calls).toContain('columns_list'));
    fireEvent.submit(screen.getByLabelText('Title').closest('form')!);
    await waitFor(() => expect(closeSpy).toHaveBeenCalled());
    expect(calls).toContain('card_create');
  });

  it('focus trap wraps from last back to first on Tab', () => {
    __setInvoker(async () => undefined as never);
    render(<QuickAddModal onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog');
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])',
      ),
    );
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(focusables[0]);
  });
});
