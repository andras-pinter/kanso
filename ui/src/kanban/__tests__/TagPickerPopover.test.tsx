// Repro for Wave 8b blank-screen bug. The first hot-fix landed a stable
// `EMPTY_TAG_IDS` reference for the no-tags selector but the real-app
// loop still fired during the initial `loadTags` cycle. This test runs
// the popover under <StrictMode> with a real `loadTags` invocation so
// it catches both the "getSnapshot should be cached" warning and the
// "Maximum update depth exceeded" loop.

import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import { __setInvoker, type InvokeFn } from '../api/client';
import { useKanbanStore } from '../hooks/useKanbanStore';
import TagPickerPopover from '../TagPickerPopover';
import type { TagDto } from '../types';

function tag(id: string, name: string): TagDto {
  return {
    id,
    name,
    color: 'IGNORED',
    created_at: 0,
    updated_at: 0,
  };
}

function buildInvoker(opts: { tags: TagDto[]; cardTagLinks: Record<string, string[]> }): InvokeFn {
  return async (cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case 'tags_list':
        return opts.tags as never;
      case 'tag_cards_list': {
        const tagId = a.tagId as string;
        const cardIds = Object.entries(opts.cardTagLinks)
          .filter(([, ts]) => ts.includes(tagId))
          .map(([cid]) => ({
            id: cid,
            column_id: 'c',
            title: cid,
            has_body: false,
            position: cid,
            due_at: null,
            created_at: 0,
            updated_at: 0,
          }));
        return cardIds as never;
      }
      default:
        return undefined as never;
    }
  };
}

function reset() {
  useKanbanStore.setState({
    status: 'idle',
    error: null,
    tags: [],
    tagsLoaded: false,
    cardTagMap: {},
  });
}

describe('TagPickerPopover', () => {
  afterEach(() => {
    __setInvoker(realInvoke);
    reset();
  });

  it('renders without an infinite re-render when the card has no tags', () => {
    reset();
    useKanbanStore.setState({ tagsLoaded: true });
    const errs: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errs.push(args);
    });

    render(<TagPickerPopover cardId="card-without-tags" />);

    expect(screen.getByRole('button', { name: '+ Add tag' })).toBeTruthy();
    expect(errs.find((e) => JSON.stringify(e).includes('Maximum update depth'))).toBeUndefined();
    expect(
      errs.find((e) => JSON.stringify(e).includes('getSnapshot should be cached')),
    ).toBeUndefined();
    spy.mockRestore();
  });

  it('does not loop or warn through a real loadTags cycle under StrictMode', async () => {
    reset();
    __setInvoker(
      buildInvoker({
        tags: [tag('t1', 'red'), tag('t2', 'blue')],
        cardTagLinks: { other: ['t1'] },
      }),
    );

    const errs: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errs.push(args);
    });

    await act(async () => {
      render(
        <StrictMode>
          <TagPickerPopover cardId="card-without-tags" />
        </StrictMode>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.getByRole('button', { name: '+ Add tag' })).toBeTruthy();
    expect(errs.find((e) => JSON.stringify(e).includes('Maximum update depth'))).toBeUndefined();
    expect(
      errs.find((e) => JSON.stringify(e).includes('getSnapshot should be cached')),
    ).toBeUndefined();
    spy.mockRestore();
  });
});

