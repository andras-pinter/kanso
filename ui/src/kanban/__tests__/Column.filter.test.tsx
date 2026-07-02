import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { useKanbanStore } from '../hooks/useKanbanStore';
import Column from '../Column';
import type { CardDto, ColumnDto, TagDto } from '../types';

function tag(id: string, name: string): TagDto {
  return { id, name, color: null, created_at: 0, updated_at: 0, archived_at: null };
}

function card(id: string, title: string, columnId = 'col1'): CardDto {
  return {
    id,
    column_id: columnId,
    title,
    body_text: null,
    position: id,
    due_at: null,
    created_at: 0,
    updated_at: 0,
    archived_at: null,
  };
}

const column: ColumnDto = {
  id: 'col1',
  board_id: 'b1',
  name: 'Todo',
  position: 'a',
  color: null,
  created_at: 0,
  updated_at: 0,
  archived_at: null,
};

function resetStore(state: Partial<ReturnType<typeof useKanbanStore.getState>>) {
  useKanbanStore.setState({
    status: 'ready',
    error: null,
    boards: [],
    currentBoardId: 'b1',
    showArchived: false,
    columns: [column],
    cardsByColumn: { col1: [] },
    selectedCardId: null,
    tags: [],
    tagsLoaded: true,
    cardTagMap: {},
    selectedTagIds: [],
    ...state,
  });
}

function renderColumn(cards: CardDto[]) {
  return render(
    <DndContext>
      <Column column={column} cards={cards} />
    </DndContext>,
  );
}

describe('Column tag filter', () => {
  beforeEach(() => resetStore({}));
  afterEach(() => resetStore({}));

  it('shows all live cards when no filter is active', () => {
    const cards = [card('c1', 'first'), card('c2', 'second')];
    resetStore({ cardsByColumn: { col1: cards } });
    renderColumn(cards);
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();
    expect(screen.queryByText(/no cards match this filter/i)).toBeNull();
  });

  it('applies AND semantics across selected tags', () => {
    const cards = [card('c1', 'first'), card('c2', 'second'), card('c3', 'third')];
    resetStore({
      tags: [tag('t1', 'a'), tag('t2', 'b')],
      cardsByColumn: { col1: cards },
      cardTagMap: {
        c1: ['t1', 't2'],
        c2: ['t1'],
        c3: ['t1', 't2', 't3'],
      },
      selectedTagIds: ['t1', 't2'],
    });
    renderColumn(cards);
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.queryByText('second')).toBeNull();
    expect(screen.getByText('third')).toBeTruthy();
  });

  it('renders zero-state message when column has cards but none match', () => {
    const cards = [card('c1', 'first'), card('c2', 'second')];
    resetStore({
      tags: [tag('t1', 'a')],
      cardsByColumn: { col1: cards },
      cardTagMap: { c1: [], c2: [] },
      selectedTagIds: ['t1'],
    });
    renderColumn(cards);
    expect(screen.getByText(/no cards match this filter/i)).toBeTruthy();
    expect(screen.queryByText('first')).toBeNull();
    expect(screen.queryByText('second')).toBeNull();
  });

  it('does not render the filter zero-state message for an empty column', () => {
    resetStore({
      tags: [tag('t1', 'a')],
      cardsByColumn: { col1: [] },
      selectedTagIds: ['t1'],
    });
    renderColumn([]);
    expect(screen.queryByText(/no cards match this filter/i)).toBeNull();
    expect(screen.getByText(/no cards yet/i)).toBeTruthy();
  });

  it('renders "No cards yet" for an unfiltered empty column', () => {
    resetStore({ cardsByColumn: { col1: [] } });
    renderColumn([]);
    expect(screen.getByText(/no cards yet/i)).toBeTruthy();
    expect(screen.queryByText(/no cards match this filter/i)).toBeNull();
  });

  it('does not render "No cards yet" when the column has cards hidden by a filter', () => {
    const cards = [card('c1', 'first')];
    resetStore({
      tags: [tag('t1', 'a')],
      cardsByColumn: { col1: cards },
      cardTagMap: { c1: [] },
      selectedTagIds: ['t1'],
    });
    renderColumn(cards);
    expect(screen.queryByText(/no cards yet/i)).toBeNull();
    expect(screen.getByText(/no cards match this filter/i)).toBeTruthy();
  });

  it('column count reflects the filtered list', () => {
    const cards = [card('c1', 'first'), card('c2', 'second'), card('c3', 'third')];
    resetStore({
      tags: [tag('t1', 'a')],
      cardsByColumn: { col1: cards },
      cardTagMap: { c1: ['t1'], c2: [], c3: ['t1'] },
      selectedTagIds: ['t1'],
    });
    const { container } = renderColumn(cards);
    const count = container.querySelector('.kanso-column-count');
    expect(count?.textContent).toBe('2');
  });
});
