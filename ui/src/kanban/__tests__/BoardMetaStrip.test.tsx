import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useKanbanStore } from '../hooks/useKanbanStore';
import BoardMetaStrip from '../BoardMetaStrip';
import type { CardListDto, ColumnDto } from '../types';

function startOfToday(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const DAY = 24 * 60 * 60 * 1000;

function col(id: string, name: string): ColumnDto {
  return {
    id,
    board_id: 'b1',
    name,
    position: id,
    color: null,
    created_at: 0,
    updated_at: 0,
  };
}

function card(id: string, columnId: string, dueAt: number | null): CardListDto {
  return {
    id,
    column_id: columnId,
    title: id,
    has_body: false,
    position: id,
    due_at: dueAt,
    created_at: 0,
    updated_at: 0,
  };
}

function seed(cards: Record<string, CardListDto[]>) {
  useKanbanStore.setState({
    status: 'ready',
    error: null,
    boards: [],
    currentBoardId: 'b1',
    columns: [col('todo', 'Todo'), col('done', 'Done')],
    cardsByColumn: cards,
    selectedCardId: null,
    tags: [],
    tagsLoaded: true,
    cardTagMap: {},
    selectedTagIds: [],
  });
}

describe('BoardMetaStrip', () => {
  beforeEach(() => seed({ todo: [], done: [] }));
  afterEach(() => seed({ todo: [], done: [] }));

  it('counts open cards as everything not in Done', () => {
    seed({
      todo: [card('c1', 'todo', null), card('c2', 'todo', null)],
      done: [card('c3', 'done', null)],
    });
    render(<BoardMetaStrip />);
    expect(screen.getByText('2').textContent).toBe('2');
    // Overdue chip should be absent when the count is zero.
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it('does not count cards due today as overdue', () => {
    seed({ todo: [card('c1', 'todo', startOfToday())], done: [] });
    render(<BoardMetaStrip />);
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it('counts cards due yesterday as overdue', () => {
    seed({ todo: [card('c1', 'todo', startOfToday() - DAY)], done: [] });
    render(<BoardMetaStrip />);
    expect(screen.getByText(/overdue/i)).toBeTruthy();
  });

  it('ignores overdue cards that landed in Done', () => {
    seed({
      todo: [],
      done: [card('c1', 'done', startOfToday() - DAY)],
    });
    render(<BoardMetaStrip />);
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it('renders nothing when the board has no columns', () => {
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
      selectedTagIds: [],
    });
    const { container } = render(<BoardMetaStrip />);
    expect(container.firstChild).toBeNull();
  });
});
