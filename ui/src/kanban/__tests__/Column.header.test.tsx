import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { useKanbanStore } from '../hooks/useKanbanStore';
import Column from '../Column';
import type { CardDto, ColumnDto } from '../types';

function makeColumn(color: string | null): ColumnDto {
  return {
    id: 'col1',
    board_id: 'b1',
    name: 'Todo',
    position: 'a',
    color,
    created_at: 0,
    updated_at: 0,
    archived_at: null,
  };
}

function resetStore(column: ColumnDto, cards: CardDto[]) {
  useKanbanStore.setState({
    status: 'ready',
    error: null,
    boards: [],
    currentBoardId: 'b1',
    showArchived: false,
    columns: [column],
    cardsByColumn: { col1: cards },
    selectedCardId: null,
    tags: [],
    tagsLoaded: true,
    cardTagMap: {},
    selectedTagIds: [],
  });
}

function renderColumn(column: ColumnDto, cards: CardDto[]) {
  return render(
    <DndContext>
      <Column column={column} cards={cards} />
    </DndContext>,
  );
}

describe('Column header color dot', () => {
  afterEach(() => resetStore(makeColumn(null), []));

  it('renders a dot with the column color when set', () => {
    const column = makeColumn('#ff8800');
    resetStore(column, []);
    const { container } = renderColumn(column, []);
    const dot = container.querySelector('.kanso-column-dot') as HTMLElement | null;
    expect(dot).not.toBeNull();
    expect(dot?.style.backgroundColor).toBe('#ff8800');
  });

  it('does not render the dot when the column has no color', () => {
    const column = makeColumn(null);
    resetStore(column, []);
    const { container } = renderColumn(column, []);
    expect(container.querySelector('.kanso-column-dot')).toBeNull();
  });
});

describe('Column count quiet-zero styling', () => {
  beforeEach(() => resetStore(makeColumn(null), []));
  afterEach(() => resetStore(makeColumn(null), []));

  it('adds the --empty modifier when the column has zero cards', () => {
    const column = makeColumn(null);
    resetStore(column, []);
    const { container } = renderColumn(column, []);
    const count = container.querySelector('.kanso-column-count') as HTMLElement | null;
    expect(count?.classList.contains('kanso-column-count--empty')).toBe(true);
  });

  it('does not add the --empty modifier when cards are present', () => {
    const column = makeColumn(null);
    const cards: CardDto[] = [
      {
        id: 'c1',
        column_id: 'col1',
        title: 'first',
        body_text: null,
        position: 'a',
        due_at: null,
        created_at: 0,
        updated_at: 0,
        archived_at: null,
      },
    ];
    resetStore(column, cards);
    const { container } = renderColumn(column, cards);
    const count = container.querySelector('.kanso-column-count') as HTMLElement | null;
    expect(count?.classList.contains('kanso-column-count--empty')).toBe(false);
  });
});
