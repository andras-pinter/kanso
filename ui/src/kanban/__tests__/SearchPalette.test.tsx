import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setInvoker, type InvokeFn } from '../api/client';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import { useKanbanStore } from '../hooks/useKanbanStore';
import SearchPalette from '../SearchPalette';
import type { CardSearchHitDto } from '../types';

function hit(cardId: string, title: string, boardId: string): CardSearchHitDto {
  return {
    card: {
      id: cardId,
      column_id: 'col1',
      title,
      has_body: false,
      position: cardId,
      due_at: null,
      created_at: 0,
      updated_at: 0,
    },
    column_id: 'col1',
    column_name: 'Todo',
    board_id: boardId,
    board_name: 'Board ' + boardId,
  };
}

describe('SearchPalette', () => {
  beforeEach(() => {
    useKanbanStore.setState({
      status: 'ready',
      error: null,
      boards: [],
      currentBoardId: null,
      columns: [],
      cardsByColumn: {},
      selectedCardId: null,
      tags: [],
      tagsLoaded: false,
      cardTagMap: {},
    });
  });

  afterEach(() => {
    __setInvoker(realInvoke);
  });

  it('shows hint when query is empty', () => {
    const invoker: InvokeFn = async () => [] as never;
    __setInvoker(invoker);
    render(<SearchPalette onClose={() => undefined} />);
    expect(screen.getByText(/Start typing to search/i)).toBeTruthy();
  });

  it('debounces input then displays results', async () => {
    let calls = 0;
    const invoker: InvokeFn = async (cmd) => {
      if (cmd === 'card_search') {
        calls += 1;
        return [hit('c1', 'Buy ribbon', 'b1'), hit('c2', 'Wrap gift', 'b1')] as never;
      }
      return undefined as never;
    };
    __setInvoker(invoker);

    render(<SearchPalette onClose={() => undefined} />);
    const input = screen.getByLabelText('Search query') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'buy' } });
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(1), { timeout: 1500 });
    await waitFor(() => expect(screen.getByText('Buy ribbon')).toBeTruthy());
    expect(screen.getByText('Wrap gift')).toBeTruthy();
  });

  it('clicking a result invokes openCardOnBoard and closes', async () => {
    const invoker: InvokeFn = async (cmd) => {
      if (cmd === 'card_search') {
        return [hit('c1', 'Buy ribbon', 'b1')] as never;
      }
      return undefined as never;
    };
    __setInvoker(invoker);

    const openSpy = vi.fn().mockResolvedValue(undefined);
    useKanbanStore.setState({ openCardOnBoard: openSpy });

    const closeSpy = vi.fn();
    render(<SearchPalette onClose={closeSpy} />);
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'buy' } });
    await waitFor(() => screen.getByText('Buy ribbon'), { timeout: 1500 });
    fireEvent.click(screen.getByText('Buy ribbon'));
    expect(openSpy).toHaveBeenCalledWith('c1', 'b1');
    expect(closeSpy).toHaveBeenCalled();
  });
});
