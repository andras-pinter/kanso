import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useKanbanStore } from '../hooks/useKanbanStore';
import TagChips from '../TagChips';
import type { TagDto } from '../types';

function tag(id: string, name: string, color: string | null = '#ff0000', archived = false): TagDto {
  return {
    id,
    name,
    color,
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
    ...state,
  });
}

describe('TagChips', () => {
  beforeEach(() => {
    resetStore({});
  });
  afterEach(() => {
    resetStore({});
  });

  it('renders nothing when card has no tags', () => {
    resetStore({ tags: [tag('t1', 'red')] });
    const { container } = render(<TagChips cardId="c1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders up to max chips and +N overflow', () => {
    resetStore({
      tags: [tag('t1', 'one'), tag('t2', 'two'), tag('t3', 'three'), tag('t4', 'four'), tag('t5', 'five')],
      cardTagMap: { c1: ['t1', 't2', 't3', 't4', 't5'] },
    });
    render(<TagChips cardId="c1" max={3} />);
    expect(screen.getByText('one')).toBeTruthy();
    expect(screen.getByText('two')).toBeTruthy();
    expect(screen.getByText('three')).toBeTruthy();
    expect(screen.queryByText('four')).toBeNull();
    expect(screen.getByText('+2')).toBeTruthy();
  });

  it('skips archived tags', () => {
    resetStore({
      tags: [tag('t1', 'live'), tag('t2', 'gone', '#ff0000', true)],
      cardTagMap: { c1: ['t1', 't2'] },
    });
    render(<TagChips cardId="c1" />);
    expect(screen.getByText('live')).toBeTruthy();
    expect(screen.queryByText('gone')).toBeNull();
  });
});
