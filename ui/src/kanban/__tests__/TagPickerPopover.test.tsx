// Repro for Wave 8b blank-screen bug. TagPickerPopover used a selector
// `(s) => s.cardTagMap[cardId] ?? []` that returned a fresh `[]` on every
// render for cards with no tags. Zustand 5's strict-equality store flagged
// each `[]` as a change, triggering a re-render loop that React 19 aborts
// with "Maximum update depth exceeded" -> uncaught throw -> blank app.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useKanbanStore } from '../hooks/useKanbanStore';
import TagPickerPopover from '../TagPickerPopover';

describe('TagPickerPopover (no-tags repro)', () => {
  beforeEach(() => {
    useKanbanStore.setState({
      status: 'ready',
      error: null,
      tags: [],
      tagsLoaded: true,
      cardTagMap: {},
    });
  });

  it('renders without entering an infinite render loop when the card has no tags', () => {
    const errs: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errs.push(args);
    });

    render(<TagPickerPopover cardId="card-without-tags" />);

    expect(screen.getByRole('button', { name: '+ Add tag' })).toBeTruthy();
    const loopErr = errs.find((e) =>
      JSON.stringify(e).includes('Maximum update depth'),
    );
    expect(loopErr).toBeUndefined();

    spy.mockRestore();
  });
});
