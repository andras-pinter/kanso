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

function seedStore(opts: { currentBoardId: string | null }) {
  const b1 = board('b1', 'Personal');
  const b2 = board('b2', 'Work');
  const cols = [column('col1', 'b1', 'To Do'), column('col2', 'b1', 'Done')];
  useKanbanStore.setState({
    status: 'ready',
    error: null,
    boards: [b1, b2],
    currentBoardId: opts.currentBoardId,
    columns: cols,
    cardsByColumn: { col1: [], col2: [] },
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

  it('renders title input, board selector defaulted to current, column to first', () => {
    __setInvoker(async () => undefined as never);
    render(<QuickAddModal onClose={() => undefined} />);
    expect(screen.getByRole('dialog', { name: /quick add card/i })).toBeTruthy();

    const titleInput = screen.getByLabelText('Title') as HTMLInputElement;
    expect(titleInput).toBeTruthy();
    // Autofocus
    expect(document.activeElement).toBe(titleInput);

    const boardSelect = screen.getByLabelText('Board') as HTMLSelectElement;
    expect(boardSelect.value).toBe('b1');

    const colSelect = screen.getByLabelText('Column') as HTMLSelectElement;
    expect(colSelect.value).toBe('col1');
  });

  it('submitting calls card_create on the chosen column then closes', async () => {
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

  it('switching to a non-current board fetches its columns via columns_list', async () => {
    const calls: string[] = [];
    const invoker: InvokeFn = async (cmd, args) => {
      calls.push(cmd);
      if (cmd === 'columns_list') {
        const a = args as { boardId: string };
        return [column('w1', a.boardId, 'Backlog'), column('w2', a.boardId, 'WIP')] as never;
      }
      return undefined as never;
    };
    __setInvoker(invoker);

    render(<QuickAddModal onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Board'), { target: { value: 'b2' } });

    await waitFor(() => {
      const colSelect = screen.getByLabelText('Column') as HTMLSelectElement;
      expect(colSelect.value).toBe('w1');
    });
    expect(calls).toContain('columns_list');
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
