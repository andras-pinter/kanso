import { describe, expect, it } from 'vitest';
import {
  applyColumnReorder,
  columnDragId,
  computeColumnAnchors,
  filterCollidersForActive,
  parseColumnDragId,
  resolveColumnDragEnd,
} from '../columnDragEnd';
import type { ColumnDto } from '../types';

function col(id: string, position: string, archived = false): ColumnDto {
  return {
    id,
    board_id: 'b',
    name: id.toUpperCase(),
    position,
    color: null,
    created_at: 0,
    updated_at: 0,
    archived_at: archived ? 1 : null,
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

  it('returns null on a drop on self', () => {
    expect(resolveColumnDragEnd('col:a', 'col:a', { columns })).toBeNull();
  });

  it('returns null when active or over column is not present', () => {
    expect(resolveColumnDragEnd('col:z', 'col:a', { columns })).toBeNull();
    expect(resolveColumnDragEnd('col:a', 'col:z', { columns })).toBeNull();
  });

  it('resolves adjacent forward drop (b over c)', () => {
    const r = resolveColumnDragEnd('col:b', 'col:c', { columns });
    expect(r?.columnId).toBe('b');
    expect(r?.reordered.map((c) => c.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('resolves drop over a non-adjacent later column (a over c)', () => {
    const r = resolveColumnDragEnd('col:a', 'col:c', { columns });
    expect(r?.reordered.map((c) => c.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('resolves drop on the LAST column reaches the end (a over d)', () => {
    const r = resolveColumnDragEnd('col:a', 'col:d', { columns });
    expect(r?.reordered.map((c) => c.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('resolves drop on the FIRST column reaches the start (d over a)', () => {
    const r = resolveColumnDragEnd('col:d', 'col:a', { columns });
    expect(r?.reordered.map((c) => c.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('ignores archived columns when computing the live order', () => {
    const withArchived = [
      col('a', 'a0'),
      col('b', 'b0', true),
      col('c', 'c0'),
      col('d', 'd0'),
    ];
    const r = resolveColumnDragEnd('col:a', 'col:d', { columns: withArchived });
    // Live list pre-move = [a, c, d]; a over d → [c, d, a].
    expect(r?.reordered.map((c) => c.id)).toEqual(['c', 'd', 'a']);
  });
});

describe('computeColumnAnchors', () => {
  const live = [col('b', 'b0'), col('a', 'a0'), col('c', 'c0'), col('d', 'd0')];

  it('returns {after} for the first slot', () => {
    expect(computeColumnAnchors([col('a', 'a0'), col('b', 'b0')], 'a')).toEqual({
      after: 'b',
    });
  });

  it('returns {before, after} for a middle slot', () => {
    expect(computeColumnAnchors(live, 'a')).toEqual({ before: 'b', after: 'c' });
  });

  it('returns {before} for the last slot', () => {
    expect(computeColumnAnchors(live, 'd')).toEqual({ before: 'c' });
  });

  it('returns {} for a single-item list', () => {
    expect(computeColumnAnchors([col('only', 'x')], 'only')).toEqual({});
  });

  it('returns {} when the column is missing', () => {
    expect(computeColumnAnchors(live, 'ghost')).toEqual({});
  });
});

describe('applyColumnReorder', () => {
  it('reorders live columns according to the resolution', () => {
    const r = resolveColumnDragEnd('col:a', 'col:d', { columns });
    if (!r) throw new Error('expected resolution');
    const next = applyColumnReorder(columns, r);
    expect(next.map((c) => c.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('keeps archived columns in their original slots', () => {
    const withArchived = [
      col('a', 'a0'),
      col('arc', 'arc0', true),
      col('b', 'b0'),
      col('c', 'c0'),
    ];
    const r = resolveColumnDragEnd('col:a', 'col:c', { columns: withArchived });
    if (!r) throw new Error('expected resolution');
    const next = applyColumnReorder(withArchived, r);
    // Live pre-move: [a,b,c]; a over c → [b,c,a]. Archived col stays in
    // its slot (was at index 1 in the full list).
    expect(next.map((c) => c.id)).toEqual(['b', 'arc', 'c', 'a']);
  });
});

describe('filterCollidersForActive', () => {
  const droppables = ['col:a', 'col:b', 'col:c', 'column:a', 'column:b', 'card-1', 'card-2'];

  it('column drag → only col: ids survive', () => {
    expect(filterCollidersForActive('col:a', droppables)).toEqual(['col:a', 'col:b', 'col:c']);
  });

  it('card drag → no col: ids survive (avoids hijacking by the column sortable)', () => {
    expect(filterCollidersForActive('card-1', droppables)).toEqual([
      'column:a',
      'column:b',
      'card-1',
      'card-2',
    ]);
  });

  it('column drag over a column that contains cards still resolves to a column id', () => {
    // The bug: closestCorners over a populated column reports the nested
    // card / `column:` body droppable. After filtering, only the column
    // sortable ids remain so the resolver gets a valid target.
    const overPopulated = ['col:a', 'col:b', 'column:b', 'card-99'];
    expect(filterCollidersForActive('col:a', overPopulated)).toEqual(['col:a', 'col:b']);
  });
});
