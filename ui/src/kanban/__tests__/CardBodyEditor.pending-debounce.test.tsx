import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { EditorHandle } from '../../editor';

// Independent test file focused on the specific window where the debounce
// timer is still armed at unmount time. The existing unmount test always
// waits for the save to already be in flight, which sidesteps the sync
// portion of runNow() firing setState on the dying component.

const editorState: {
  destroyCalls: number;
  onChangeCbs: Array<() => void>;
  markdown: string;
} = {
  destroyCalls: 0,
  onChangeCbs: [],
  markdown: '',
};

const apiState: {
  bodyGetResolve: ((v: { body_markdown: string | null }) => void) | null;
  bodySetCalls: Array<{ id: string; body_markdown: string }>;
  /** When set, cardBodySet throws SYNCHRONOUSLY with this error instead of
   * returning a resolved promise. Sync throws propagate out of the save
   * closure's `await` and are caught by the surrounding try/catch on the
   * SAME microtask — which is the exact window where the buggy unmount
   * guard hasn't been set yet. */
  bodySetSyncThrow: Error | null;
} = {
  bodyGetResolve: null,
  bodySetCalls: [],
  bodySetSyncThrow: null,
};

vi.mock('../../editor', () => ({
  mountEditor: vi.fn(async (): Promise<EditorHandle> => ({
    destroy: () => {
      editorState.destroyCalls += 1;
    },
    getMarkdown: () => editorState.markdown,
    setMarkdown: (md: string) => {
      editorState.markdown = md;
    },
    onChange: (cb: () => void) => {
      editorState.onChangeCbs.push(cb);
      return () => {
        editorState.onChangeCbs = editorState.onChangeCbs.filter((x) => x !== cb);
      };
    },
  })),
}));

vi.mock('../api/client', () => ({
  cardBodyGet: vi.fn(
    () =>
      new Promise((resolve) => {
        apiState.bodyGetResolve = resolve;
      }),
  ),
  // Resolve immediately so any post-await work in the save closure runs the
  // moment microtasks flush — makes onSaved / onSaveError observable in the
  // buggy case where unmountedRef hasn't been set before the save closure
  // continues past its await.
  cardBodySet: vi.fn((id: string, payload: { body_markdown: string }) => {
    apiState.bodySetCalls.push({ id, body_markdown: payload.body_markdown });
    if (apiState.bodySetSyncThrow) throw apiState.bodySetSyncThrow;
    return Promise.resolve();
  }),
}));

import CardBodyEditor from '../CardBodyEditor';

beforeEach(() => {
  editorState.destroyCalls = 0;
  editorState.onChangeCbs = [];
  editorState.markdown = '';
  apiState.bodyGetResolve = null;
  apiState.bodySetCalls = [];
  apiState.bodySetSyncThrow = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('CardBodyEditor pending-debounce unmount', () => {
  it('flushes the pending edit but never touches the unmounted component', async () => {
    const onSaved = vi.fn();
    const onSaveError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = render(
      <CardBodyEditor cardId="c1" onSaved={onSaved} onSaveError={onSaveError} />,
    );

    // Drive the editor to `ready` synchronously under fake timers by
    // resolving the body_get promise and flushing microtasks in an act().
    await act(async () => {
      apiState.bodyGetResolve?.({ body_markdown: '' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(editorState.onChangeCbs.length).toBe(1);

    // User edits. The saver arms a 500 ms debounce; NO save is in flight
    // yet — this is the window the existing unmount test misses.
    editorState.markdown = 'edited';
    act(() => {
      editorState.onChangeCbs[0]?.();
    });
    expect(apiState.bodySetCalls).toHaveLength(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // Unmount BEFORE advancing timers. Cleanup fires `saver.flush()` which
    // must persist the edit but must not touch the dying component.
    unmount();

    // Drain the flush's promise chain (cardBodySet resolves immediately) so
    // any post-await callbacks that leak past the unmount guard run and
    // become observable in the assertions below.
    await act(async () => {
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Persistence: the pending edit landed.
    expect(apiState.bodySetCalls).toEqual([{ id: 'c1', body_markdown: 'edited' }]);
    // No leftover armed timers.
    expect(vi.getTimerCount()).toBe(0);
    // Parent callbacks must never fire post-unmount.
    expect(onSaved).not.toHaveBeenCalled();
    expect(onSaveError).not.toHaveBeenCalled();
    // React logs an error when setState is called on an unmounted component
    // in dev builds; the buggy path calls setSaveState('saving') inside the
    // synchronous portion of the flush before Effect B's cleanup marks the
    // component as unmounted.
    const unmountedSetStateWarnings = consoleError.mock.calls.filter((args) =>
      args.some(
        (a) =>
          typeof a === 'string' &&
          (a.includes("Can't perform a React state update on an unmounted component") ||
            a.includes('unmounted component')),
      ),
    );
    expect(unmountedSetStateWarnings).toHaveLength(0);

    consoleError.mockRestore();
  });

  it('does not leak onSaveError when the pending-debounce flush fails synchronously', async () => {
    // A synchronous throw from cardBodySet propagates out of `await` and
    // reaches the save closure's catch handler on the SAME synchronous
    // scope as `saver.flush()`. That is precisely the window where the
    // buggy code has not yet marked the component as unmounted: Effect A
    // cleanup fires the flush; Effect B cleanup (which sets the guard)
    // only runs AFTER Effect A's cleanup returns.
    const onSaveError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = render(<CardBodyEditor cardId="c1" onSaveError={onSaveError} />);

    await act(async () => {
      apiState.bodyGetResolve?.({ body_markdown: '' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(editorState.onChangeCbs.length).toBe(1);

    editorState.markdown = 'edited';
    act(() => {
      editorState.onChangeCbs[0]?.();
    });
    expect(apiState.bodySetCalls).toHaveLength(0);

    // Arm the synchronous throw and unmount while the debounce is pending.
    apiState.bodySetSyncThrow = new Error('boom');
    unmount();

    await act(async () => {
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The flush did attempt to persist (even though it failed).
    expect(apiState.bodySetCalls).toEqual([{ id: 'c1', body_markdown: 'edited' }]);
    // The bug: onSaveError fires because unmountedRef is still false when
    // the sync-throw's catch handler runs.
    expect(onSaveError).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
