import { beforeEach, describe, expect, it } from 'vitest';
import { useKanbanStore } from '../hooks/useKanbanStore';

function reset() {
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
}

describe('useKanbanStore tag filter', () => {
  beforeEach(() => reset());

  it('starts with an empty filter', () => {
    expect(useKanbanStore.getState().selectedTagIds).toEqual([]);
  });

  it('toggleTagFilter adds then removes an id', () => {
    const { toggleTagFilter } = useKanbanStore.getState();
    toggleTagFilter('t1');
    expect(useKanbanStore.getState().selectedTagIds).toEqual(['t1']);
    toggleTagFilter('t2');
    expect(useKanbanStore.getState().selectedTagIds).toEqual(['t1', 't2']);
    toggleTagFilter('t1');
    expect(useKanbanStore.getState().selectedTagIds).toEqual(['t2']);
  });

  it('clearTagFilters empties the selection', () => {
    useKanbanStore.setState({ selectedTagIds: ['t1', 't2', 't3'] });
    useKanbanStore.getState().clearTagFilters();
    expect(useKanbanStore.getState().selectedTagIds).toEqual([]);
  });

  it('AND semantics on cardTagMap: card must carry every selected tag', () => {
    const map: Record<string, string[]> = {
      c1: ['t1', 't2'],
      c2: ['t1'],
      c3: ['t1', 't2', 't3'],
      c4: [],
    };
    useKanbanStore.setState({ selectedTagIds: ['t1', 't2'] });
    const selected = useKanbanStore.getState().selectedTagIds;
    const visible = Object.keys(map).filter((cid) =>
      selected.every((tid) => (map[cid] ?? []).includes(tid)),
    );
    expect(visible.sort()).toEqual(['c1', 'c3']);
  });
});
