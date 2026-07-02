import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useKanbanStore } from '../hooks/useKanbanStore';
import TagChips from '../TagChips';
import type { TagDto } from '../types';

function tag(id: string, name: string): TagDto {
  return {
    id,
    name,
    // UI must ignore this field. Set a sentinel so any accidental read
    // shows up as an obviously-wrong style value in tests.
    color: 'IGNORED',
    created_at: 0,
    updated_at: 0,
  };
}

function resetStore(state: Partial<ReturnType<typeof useKanbanStore.getState>>) {
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
});
