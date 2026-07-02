// End-to-end coverage of the cards drag pipeline: resolver → post-removal
// list → computeAnchors. Locks the contract against the backend's
// `before` = lower-position neighbour, `after` = higher-position
// neighbour rule.

import { describe, expect, it } from 'vitest';
import { resolveDragEnd } from '../dragEnd';
import { computeAnchors } from '../hooks/useKanbanStore';
import type { CardDto } from '../types';

function card(id: string, columnId: string): CardDto {
  return {
    id,
    column_id: columnId,
    title: id,
    body_text: null,
    position: id,
    due_at: null,
    created_at: 0,
    updated_at: 0,
  };
}

function anchorsFor(activeId: string, overId: string | null) {
  const layout = {
    cardsByColumn: {
      todo: [card('a', 'todo'), card('b', 'todo'), card('c', 'todo')],
      doing: [card('x', 'doing'), card('y', 'doing'), card('z', 'doing')],
      done: [] as CardDto[],
    },
  };
  const r = resolveDragEnd(activeId, overId, layout);
  if (!r) return null;
  const fromList = layout.cardsByColumn[r.fromColumnId as keyof typeof layout.cardsByColumn];
  const targetList =
    layout.cardsByColumn[r.targetColumnId as keyof typeof layout.cardsByColumn];
  const postRemoval =
    r.fromColumnId === r.targetColumnId
      ? fromList.filter((c) => c.id !== r.cardId)
      : targetList.slice();
  return computeAnchors(postRemoval, r.insertIndex);
}

describe('card drag → anchors integration', () => {
  it('drop a on c (same column, move down) → before:b after:c', () => {
    expect(anchorsFor('a', 'c')).toEqual({ before: 'b', after: 'c' });
  });

  it('drop c on a (same column, move up) → after:a only (a was first)', () => {
    expect(anchorsFor('c', 'a')).toEqual({ after: 'a' });
  });

  it('drop b on a (same column, move up adjacent) → after:a', () => {
    expect(anchorsFor('b', 'a')).toEqual({ after: 'a' });
  });

  it('drop a on column body (cross-column append) → before:z', () => {
    expect(anchorsFor('a', 'column:doing')).toEqual({ before: 'z' });
  });

  it('drop a on x (cross-column, insert before first) → after:x', () => {
    expect(anchorsFor('a', 'x')).toEqual({ after: 'x' });
  });

  it('drop a on y (cross-column, insert between) → before:x after:y', () => {
    expect(anchorsFor('a', 'y')).toEqual({ before: 'x', after: 'y' });
  });

  it('drop a on column body of empty column → {} (true append, empty)', () => {
    expect(anchorsFor('a', 'column:done')).toEqual({});
  });

  it('drop on self is null (no anchors)', () => {
    expect(anchorsFor('a', 'a')).toBeNull();
  });
});
