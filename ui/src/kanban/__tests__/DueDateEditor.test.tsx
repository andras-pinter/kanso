import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { useKanbanStore } from '../hooks/useKanbanStore';
import DueDateEditor from '../DueDateEditor';
import type { CardDto } from '../types';

function card(due: number | null = null): CardDto {
  return {
    id: 'c1',
    column_id: 'col1',
    title: 'Test',
    body_text: null,
    position: 'c1',
    due_at: due,
    created_at: 0,
    updated_at: 0,
    archived_at: null,
  };
}

describe('DueDateEditor', () => {
  let updateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    updateSpy = vi.fn().mockResolvedValue(undefined);
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
      tagsLoaded: false,
      cardTagMap: {},
      updateCard: updateSpy,
    });
  });

  afterEach(() => {
    useKanbanStore.setState({});
  });

  it('stores picked date as UTC midnight millis', () => {
    const { container } = render(<DueDateEditor card={card(null)} />);
    const input = container.querySelector('input[type=date]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2025-06-15' } });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [id, patch] = updateSpy.mock.calls[0]!;
    expect(id).toBe('c1');
    const expected = Date.UTC(2025, 5, 15, 0, 0, 0, 0);
    expect(patch).toEqual({ due_at: expected });
  });

  it('Clear button passes null', () => {
    const dueMs = Date.UTC(2025, 5, 15);
    const { getByText } = render(<DueDateEditor card={card(dueMs)} />);
    fireEvent.click(getByText('Clear'));
    expect(updateSpy).toHaveBeenCalledWith('c1', { due_at: null });
  });

  it('does not render Clear when due_at is null', () => {
    const { queryByText } = render(<DueDateEditor card={card(null)} />);
    expect(queryByText('Clear')).toBeNull();
  });
});
