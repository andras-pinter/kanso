import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useKanbanStore } from '../hooks/useKanbanStore';
import BoardFilterBar from '../BoardFilterBar';
import type { TagDto } from '../types';

function tag(id: string, name: string, archived = false): TagDto {
  return {
    id,
    name,
    color: null,
    created_at: 0,
    updated_at: 0,
    archived_at: archived ? 1 : null,
  };
}

function resetStore(state: Partial<ReturnType<typeof useKanbanStore.getState>>) {
  useKanbanStore.setState({
    status: 'ready',
    error: null,
    boards: [],
    currentBoardId: null,
    showArchived: false,
    columns: [],
    cardsByColumn: {},
    selectedCardId: null,
    tags: [],
    tagsLoaded: true,
    cardTagMap: {},
    selectedTagIds: [],
    ...state,
  });
}

describe('BoardFilterBar', () => {
  beforeEach(() => resetStore({}));
  afterEach(() => resetStore({}));

  it('renders nothing when there are no live tags', () => {
    resetStore({ tags: [tag('t1', 'archived-only', true)] });
    const { container } = render(<BoardFilterBar />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one chip per live tag with aria-pressed reflecting state', () => {
    resetStore({
      tags: [tag('t1', 'red'), tag('t2', 'blue'), tag('t3', 'gone', true)],
      selectedTagIds: ['t2'],
    });
    render(<BoardFilterBar />);
    const red = screen.getByRole('button', { name: 'red' });
    const blue = screen.getByRole('button', { name: 'blue' });
    expect(red.getAttribute('aria-pressed')).toBe('false');
    expect(blue.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'gone' })).toBeNull();
  });

  it('toggles a tag on click', () => {
    resetStore({ tags: [tag('t1', 'red')] });
    render(<BoardFilterBar />);
    const red = screen.getByRole('button', { name: 'red' });
    fireEvent.click(red);
    expect(useKanbanStore.getState().selectedTagIds).toEqual(['t1']);
    fireEvent.click(red);
    expect(useKanbanStore.getState().selectedTagIds).toEqual([]);
  });

  it('hides "Clear filter" until at least one tag is selected', () => {
    resetStore({ tags: [tag('t1', 'red')] });
    const { rerender } = render(<BoardFilterBar />);
    expect(screen.queryByRole('button', { name: /clear filter/i })).toBeNull();

    resetStore({ tags: [tag('t1', 'red')], selectedTagIds: ['t1'] });
    rerender(<BoardFilterBar />);
    expect(screen.getByRole('button', { name: /clear filter/i })).toBeTruthy();
  });

  it('"Clear filter" empties the selection', () => {
    resetStore({ tags: [tag('t1', 'red'), tag('t2', 'blue')], selectedTagIds: ['t1', 't2'] });
    render(<BoardFilterBar />);
    fireEvent.click(screen.getByRole('button', { name: /clear filter/i }));
    expect(useKanbanStore.getState().selectedTagIds).toEqual([]);
  });
});
