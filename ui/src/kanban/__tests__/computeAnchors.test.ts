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
    archived_at: null,
  };
}

describe('computeAnchors', () => {
  const cards = [card('a'), card('b'), card('c')];

  it('returns before:<id> when inserting in front of a card', () => {
    expect(computeAnchors(cards, 0)).toEqual({ before: 'a' });
    expect(computeAnchors(cards, 1)).toEqual({ before: 'b' });
  });

  it('returns empty when appending at end', () => {
    expect(computeAnchors(cards, 3)).toEqual({});
    expect(computeAnchors([], 0)).toEqual({});
  });
});
