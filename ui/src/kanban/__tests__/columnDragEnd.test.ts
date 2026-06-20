import { describe, expect, it } from 'vitest';
import {
  applyColumnReorder,
  columnDragId,
  computeColumnAnchors,
  parseColumnDragId,
  resolveColumnDragEnd,
} from '../columnDragEnd';
import type { ColumnDto } from '../types';

function col(id: string, position: string): ColumnDto {
  return {
    id,
    board_id: 'b',
    name: id.toUpperCase(),
    position,
    color: null,
    created_at: 0,
    updated_at: 0,
    archived_at: null,
  };
}

const columns = [col('a', 'a0'), col('b', 'b0'), col('c', 'c0'), col('d', 'd0')];

describe('column drag id', () => {
  it('roundtrips through prefix helpers', () => {
    expect(columnDragId('xyz')).toBe('col:xyz');
    expect(parseColumnDragId('col:xyz')).toBe('xyz');
    expect(parseColumnDragId('xyz')).toBeNull();
  });
});

describe('resolveColumnDragEnd', () => {
  it('returns null when overId is null', () => {
    expect(resolveColumnDragEnd('col:a', null, { columns })).toBeNull();
  });

  it('ignores non-column drags', () => {
    expect(resolveColumnDragEnd('card1', 'col:b', { columns })).toBeNull();
    expect(resolveColumnDragEnd('col:a', 'card1', { columns })).toBeNull();
  });

  it('returns null on same-slot drop', () => {
    expect(resolveColumnDragEnd('col:a', 'col:a', { columns })).toBeNull();
  });

  it('returns null on adjacent forward drop that would not move it', () => {
    // Moving b rightward over c: post-removal effective insert at idx 1,
    // which is b's original idx — so this is a no-op.
    expect(resolveColumnDragEnd('col:b', 'col:c', { columns })).toBeNull();
  });

  it('resolves moving forward: a -> over c, inserts at idx 1 after removal', () => {
    // Original [a,b,c,d]; remove a -> [b,c,d]. Over c (orig idx 2). a was
    // at idx 0 < 2 so effective insert = 2 - 1 = 1 in [b,c,d] → between b
    // and c → final order [b, a, c, d].
    const r = resolveColumnDragEnd('col:a', 'col:c', { columns });
    expect(r).toEqual({ columnId: 'a', insertIndex: 1 });
  });

  it('resolves moving backward: d -> over a, inserts at idx 0', () => {
    const r = resolveColumnDragEnd('col:d', 'col:a', { columns });
    expect(r).toEqual({ columnId: 'd', insertIndex: 0 });
  });

  it('handles drop at the very end (moving forward to last)', () => {
    // a -> over d: post-removal [b,c,d]; effective = 3 - 1 = 2 (index of d
    // in post-removal list) → insert at idx 2 → [b,c,a,d]. That's NOT the
    // very end, but is the slot the user dropped on.
    const r = resolveColumnDragEnd('col:a', 'col:d', { columns });
    expect(r).toEqual({ columnId: 'a', insertIndex: 2 });
  });
});

describe('computeColumnAnchors', () => {
  it('returns before:<id> when inserting in front of a column', () => {
    const withoutMoved = [col('b', 'b0'), col('c', 'c0'), col('d', 'd0')];
    expect(computeColumnAnchors(withoutMoved, 0)).toEqual({ before: 'b' });
    expect(computeColumnAnchors(withoutMoved, 1)).toEqual({ before: 'c' });
    expect(computeColumnAnchors(withoutMoved, 2)).toEqual({ before: 'd' });
  });

  it('returns empty when appending to end', () => {
    const withoutMoved = [col('b', 'b0'), col('c', 'c0')];
    expect(computeColumnAnchors(withoutMoved, 2)).toEqual({});
    expect(computeColumnAnchors([], 0)).toEqual({});
  });
});

describe('applyColumnReorder', () => {
  it('reorders columns optimistically', () => {
    const next = applyColumnReorder(columns, { columnId: 'a', insertIndex: 1 });
    expect(next.map((c) => c.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('appends to end when insertIndex >= length-1', () => {
    const next = applyColumnReorder(columns, { columnId: 'a', insertIndex: 99 });
    expect(next.map((c) => c.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('returns a copy unchanged when the moving column is missing', () => {
    const next = applyColumnReorder(columns, { columnId: 'zz', insertIndex: 0 });
    expect(next.map((c) => c.id)).toEqual(columns.map((c) => c.id));
  });
});
