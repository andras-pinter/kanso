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

describe('resolveDragEnd with a tag filter (visibleCardsByColumn)', () => {
  // Full: [A(no-tag), B(X), C(no-tag), D(X)] in col `todo`, visible=[B, D].
  // Full: [E(no-tag), F(X), G(no-tag)]      in col `doing`, visible=[F].
  // Full: []                                 in col `done`, visible=[].
  const filtered = {
    cardsByColumn: {
      todo: [card('A', 'todo'), card('B', 'todo'), card('C', 'todo'), card('D', 'todo')],
      doing: [card('E', 'doing'), card('F', 'doing'), card('G', 'doing')],
      done: [] as CardDto[],
    },
    visibleCardsByColumn: {
      todo: [card('B', 'todo'), card('D', 'todo')],
      doing: [card('F', 'doing')],
      done: [] as CardDto[],
    },
  };

  it('same column: drop D onto B → insert D before B in absolute space', () => {
    // Simulates the finding #3 scenario. Absolute insert index for B is 1;
    // no shift needed because D (currentIdx=3) > 1.
    expect(resolveDragEnd('D', 'B', filtered)).toEqual({
      cardId: 'D',
      fromColumnId: 'todo',
      targetColumnId: 'todo',
      insertIndex: 1,
    });
    // After moveCard applies this: [A, D, B, C]. Hidden A and C keep their
    // ordering relative to each other and to B/D that didn't move.
  });

  it('cross-column: drop D onto F → insert before F, hidden neighbours untouched', () => {
    expect(resolveDragEnd('D', 'F', filtered)).toEqual({
      cardId: 'D',
      fromColumnId: 'todo',
      targetColumnId: 'doing',
      insertIndex: 1,
    });
    // Target becomes [E, D, F, G] — hidden E stays first, hidden G stays last.
  });

  it('cross-column drop on column body appends after last VISIBLE card, not full end', () => {
    // Drop D on doing body. Old (buggy) behaviour was insertIndex = 3
    // (full length), pushing D past hidden G. Fix inserts after F at 2.
    expect(resolveDragEnd('D', 'column:doing', filtered)).toEqual({
      cardId: 'D',
      fromColumnId: 'todo',
      targetColumnId: 'doing',
      insertIndex: 2,
    });
  });

  it('same-column drop on column body appends after last visible in that column', () => {
    // Drop B on todo body. Filtered end is after D. Absolute idx = idx(D)+1 = 4.
    // Same-column shift: currentIdx(B)=1, insertIndex=4 → effective=3.
    // Post-removal list is [A, C, D]; inserting B at 3 → [A, C, D, B].
    expect(resolveDragEnd('B', 'column:todo', filtered)).toEqual({
      cardId: 'B',
      fromColumnId: 'todo',
      targetColumnId: 'todo',
      insertIndex: 3,
    });
  });

  it('same-column drop on body of a card already at the visible end is a no-op', () => {
    // D is already the last visible card in todo. Absolute insert = 4,
    // currentIdx = 3, effective = 3 → matches current position → null.
    expect(resolveDragEnd('D', 'column:todo', filtered)).toBeNull();
  });

  it('cross-column drop on body of a column with no visible cards falls back to full end', () => {
    // done has neither hidden nor visible cards — behaviour is unchanged.
    expect(resolveDragEnd('D', 'column:done', filtered)).toEqual({
      cardId: 'D',
      fromColumnId: 'todo',
      targetColumnId: 'done',
      insertIndex: 0,
    });
  });
});
