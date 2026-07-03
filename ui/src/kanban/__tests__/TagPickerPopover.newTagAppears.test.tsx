// Regression for "new tag created in ManageTagsDrawer is missing from a
// card's Add-tag popover". The historical bug: ManageTagsDrawer's initial
// `loadTags()` set `tagsLoaded=true` AND filled `tags`. The popover, on
// mount, saw `tagsLoaded=true` and did NOT re-fetch — it read the in-memory
// `tags`. If `tagCreate` failed to update that in-memory array (or updated
// it with a non-new reference so Zustand skipped notification), the picker
// showed a stale list forever.
//
// This test drives the actual flow end-to-end: drawer creates a tag via
// `tagCreate`, then the popover renders and must list it as available.
//
// If the picker's `available` doesn't include the newly-created tag,
// somewhere along the store/subscription path a reference or invalidation
// broke.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrictMode } from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { invoke as realInvoke } from '@tauri-apps/api/core';
import { __setInvoker, type InvokeFn } from '../api/client';
import { useKanbanStore } from '../hooks/useKanbanStore';
import TagPickerPopover from '../TagPickerPopover';
import type { TagDto } from '../types';

function tag(id: string, name: string): TagDto {
  return { id, name, color: null, created_at: 0, updated_at: 0 };
}

interface FakeServer {
  tags: TagDto[];
  seq: number;
}

function buildInvoker(server: FakeServer): InvokeFn {
  return async (cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case 'tags_list':
        // Return a copy — real IPC always returns a fresh JSON array. If
        // we returned the raw ref, later pushes would alias the store's
        // internal `tags` array and mask ref-based bugs.
        return server.tags.map((t) => ({ ...t })) as never;
      case 'board_card_tags_list':
        return [] as never;
      case 'tag_create': {
        const body = a.body as { name: string; color?: string | null };
        server.seq += 1;
        const created = tag(`srv-${server.seq}`, body.name);
        created.color = body.color ?? null;
        server.tags.push(created);
        return { ...created } as never;
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
    selectedTagIds: [],
    currentBoardId: 'board1',
  });
}

describe('TagPickerPopover - new tag visibility', () => {
  let server: FakeServer;

  beforeEach(() => {
    server = { tags: [tag('t1', 'existing')], seq: 100 };
    __setInvoker(buildInvoker(server));
    reset();
  });

  afterEach(() => {
    __setInvoker(realInvoke);
    reset();
  });

  it('shows a tag created via store.tagCreate after tags were already loaded', async () => {
    // Simulate the drawer having opened first: it primes the store.
    await act(async () => {
      await useKanbanStore.getState().loadTags();
    });
    expect(useKanbanStore.getState().tagsLoaded).toBe(true);
    expect(useKanbanStore.getState().tags.map((t) => t.name)).toEqual(['existing']);

    // Drawer flow: user hits + New and submits "freshly-minted".
    await act(async () => {
      await useKanbanStore.getState().tagCreate('freshly-minted');
    });

    // Card popover mounts after the tag was created. Under StrictMode so
    // any effect-driven reload race would surface as a doubled fetch or
    // stale render.
    render(
      <StrictMode>
        <TagPickerPopover cardId="card-1" />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole('button', { name: '+ Add tag' }));

    // Both the pre-existing and the newly-created tag must be pickable.
    expect(screen.getByText('existing')).toBeTruthy();
    expect(screen.getByText('freshly-minted')).toBeTruthy();
  });

  it('shows a tag created via the popover inline-create in the same session', async () => {
    // Prime the store so tagsLoaded=true (mirrors real app boot).
    await act(async () => {
      await useKanbanStore.getState().loadTags();
    });

    render(<TagPickerPopover cardId="card-2" />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add tag' }));

    // Type a name that has no exact match to unlock the Create trigger.
    fireEvent.change(screen.getByLabelText('Filter tags'), {
      target: { value: 'brand-new' },
    });
    // Click "Create" trigger -> enter the create sub-view.
    fireEvent.click(screen.getByRole('button', { name: /Create "brand-new"/ }));
    // Confirm inside the create form.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    });

    // The just-created tag was auto-linked to the card, so it should appear
    // as a chip in the current-tags row.
    expect(screen.getByText('brand-new')).toBeTruthy();
    // Store must reflect the new tag too.
    expect(useKanbanStore.getState().tags.some((t) => t.name === 'brand-new')).toBe(true);
  });

  it('shows a tag whose create promise resolves after the popover mounts', async () => {
    // Simulate the drawer's fire-and-forget submit: `void tagCreate(name)`.
    // The user then closes the drawer and opens a card FAST — before the
    // API round-trip resolves. The popover must still pick up the new tag
    // once the store commits it.
    await act(async () => {
      await useKanbanStore.getState().loadTags();
    });

    // Fire without awaiting.
    const creating = useKanbanStore.getState().tagCreate('async-tag');

    render(<TagPickerPopover cardId="card-3" />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add tag' }));

    // Not there yet — still in flight.
    expect(screen.queryByText('async-tag')).toBeNull();

    // Let the create settle.
    await act(async () => {
      await creating;
    });

    expect(screen.getByText('async-tag')).toBeTruthy();
  });
});
