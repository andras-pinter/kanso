import { describe, expect, it } from 'vitest';
import { computeAnchors } from '../hooks/useKanbanStore';
import type { CardDto } from '../types';

function card(id: string): CardDto {
  return {
    id,
    column_id: 'c',
    title: id,
    body_text: null,
    position: id,
    due_at: null,
    created_at: 0,
    updated_at: 0,
  };
}

describe('computeAnchors', () => {
  const cards = [card('a'), card('b'), card('c')];

  it('returns {after} when inserting at the start', () => {
    expect(computeAnchors(cards, 0)).toEqual({ after: 'a' });
  });

  it('returns {before, after} when inserting in the middle', () => {
    expect(computeAnchors(cards, 1)).toEqual({ before: 'a', after: 'b' });
    expect(computeAnchors(cards, 2)).toEqual({ before: 'b', after: 'c' });
  });

  it('returns {before} when appending to the end', () => {
    expect(computeAnchors(cards, 3)).toEqual({ before: 'c' });
  });

  it('returns {} for an empty list', () => {
    expect(computeAnchors([], 0)).toEqual({});
  });

  it('clamps an out-of-range insertIndex', () => {
    expect(computeAnchors(cards, 99)).toEqual({ before: 'c' });
    expect(computeAnchors(cards, -5)).toEqual({ after: 'a' });
  });
});
