import { describe, expect, it } from 'vitest';
import { resolveDragEnd } from '../dragEnd';
import type { CardDto } from '../types';

function card(id: string, columnId: string, position = id): CardDto {
  return {
    id,
    column_id: columnId,
    title: id,
    body_text: null,
    position,
    due_at: null,
    created_at: 0,
    updated_at: 0,
    archived_at: null,
  };
}

const layout = {
  cardsByColumn: {
    todo: [card('a', 'todo'), card('b', 'todo'), card('c', 'todo')],
    doing: [card('x', 'doing'), card('y', 'doing')],
    done: [],
  },
};

describe('resolveDragEnd', () => {
  it('returns null when there is no over target', () => {
    expect(resolveDragEnd('a', null, layout)).toBeNull();
  });

  it('returns null when dropping on self', () => {
    expect(resolveDragEnd('a', 'a', layout)).toBeNull();
  });

  it('returns null on a same-column no-op (drop on neighbour at unchanged spot)', () => {
    // a -> drop on b. After removing a, b is at index 0, which is also a's
    // pre-removal index -> no visible change.
    expect(resolveDragEnd('a', 'b', layout)).toBeNull();
  });

  it('moves a card down within the same column (drop on the card after)', () => {
    // a -> drop on c. Post-removal, c sits at index 1 -> insert there.
    expect(resolveDragEnd('a', 'c', layout)).toEqual({
      cardId: 'a',
      fromColumnId: 'todo',
      targetColumnId: 'todo',
      insertIndex: 1,
    });
  });

  it('moves a card up within the same column (drop on earlier card)', () => {
    expect(resolveDragEnd('c', 'a', layout)).toEqual({
      cardId: 'c',
      fromColumnId: 'todo',
      targetColumnId: 'todo',
      insertIndex: 0,
    });
  });

  it('moves a card across columns by dropping on a target card -> insert before it', () => {
    expect(resolveDragEnd('a', 'y', layout)).toEqual({
      cardId: 'a',
      fromColumnId: 'todo',
      targetColumnId: 'doing',
      insertIndex: 1,
    });
  });

  it('moves a card across columns by dropping on the column container -> append', () => {
    expect(resolveDragEnd('a', 'column:doing', layout)).toEqual({
      cardId: 'a',
      fromColumnId: 'todo',
      targetColumnId: 'doing',
      insertIndex: 2,
    });
  });

  it('moves a card to an empty column -> insertIndex 0 (append)', () => {
    expect(resolveDragEnd('a', 'column:done', layout)).toEqual({
      cardId: 'a',
      fromColumnId: 'todo',
      targetColumnId: 'done',
      insertIndex: 0,
    });
  });

  it('returns null when active id is not a known card', () => {
    expect(resolveDragEnd('ghost', 'a', layout)).toBeNull();
  });

  it('returns null when over id is unrecognised', () => {
    expect(resolveDragEnd('a', 'mystery', layout)).toBeNull();
  });
});
