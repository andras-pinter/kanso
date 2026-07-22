import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import type { EditorHandle } from '../../editor';

// Deferred controls for the async body_get + save flow. Each test can drive
// them explicitly so we can assert what happens between "save in flight"
// and "component unmounts".
const editorState: {
  destroyCalls: number;
  onChangeCbs: Array<() => void>;
  markdown: string;
  /** Pending mountEditor resolvers, FIFO. Each render/effect run pushes one
   * — the test can resolve them in order to exercise transient-mount paths
   * that the abort guard is supposed to clean up. */
  mountResolvers: Array<(h: EditorHandle) => void>;
} = {
  destroyCalls: 0,
  onChangeCbs: [],
  markdown: '',
  mountResolvers: [],
};

const apiState: {
  bodyGetResolve: ((v: { body_markdown: string | null }) => void) | null;
  /** FIFO queue of pending body_get resolvers so StrictMode's double-invoke
   * can drive step 1 and step 3 independently. */
  bodyGetQueue: Array<(v: { body_markdown: string | null }) => void>;
  bodySetResolve: (() => void) | null;
  bodySetReject: ((e: unknown) => void) | null;
  bodySetCalls: number;
} = {
  bodyGetResolve: null,
  bodyGetQueue: [],
  bodySetResolve: null,
  bodySetReject: null,
  bodySetCalls: 0,
};

vi.mock('../../editor', () => ({
  mountEditor: vi.fn(
    (): Promise<EditorHandle> =>
      new Promise<EditorHandle>((resolve) => {
        editorState.mountResolvers.push(resolve);
      }),
  ),
}));

const makeHandle = (): EditorHandle => ({
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
});

vi.mock('../api/client', () => ({
  cardBodyGet: vi.fn(
    () =>
      new Promise((resolve) => {
        apiState.bodyGetResolve = resolve;
        apiState.bodyGetQueue.push(resolve);
      }),
  ),
  cardBodySet: vi.fn(() => {
    apiState.bodySetCalls += 1;
    return new Promise<void>((resolve, reject) => {
      apiState.bodySetResolve = resolve;
      apiState.bodySetReject = reject;
    });
  }),
}));

// Import AFTER mocks so the component sees the stubs.
import CardBodyEditor from '../CardBodyEditor';

beforeEach(() => {
  editorState.destroyCalls = 0;
  editorState.onChangeCbs = [];
  editorState.markdown = '';
  editorState.mountResolvers = [];
  apiState.bodyGetResolve = null;
  apiState.bodyGetQueue = [];
  apiState.bodySetResolve = null;
  apiState.bodySetReject = null;
  apiState.bodySetCalls = 0;
});

/** Drain the current queue: resolve every pending body_get promise and, if
 * requested, resolve every mount promise with a fresh handle. Used by the
 * non-StrictMode tests to reach `phase === 'ready'` without caring about
 * the internal timing between body_get and mount. */
const settleAllMounts = async (): Promise<void> => {
  const gets = apiState.bodyGetQueue.splice(0);
  gets.forEach((r) => r({ body_markdown: '' }));
  await Promise.resolve();
  await Promise.resolve();
  const mounts = editorState.mountResolvers.splice(0);
  mounts.forEach((r) => r(makeHandle()));
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('CardBodyEditor unmount safety', () => {
  it('destroys the editor synchronously even when a save is in flight', async () => {
    const onSaved = vi.fn();
    const onSaveError = vi.fn();
    const { unmount } = render(
      <CardBodyEditor cardId="c1" onSaved={onSaved} onSaveError={onSaveError} />,
    );

    // Resolve the initial body_get and mount so the editor reaches ready.
    await act(async () => {
      await settleAllMounts();
    });
    await waitFor(() => expect(editorState.onChangeCbs.length).toBe(1));

    // Type an edit and let the debounce fire; a save is now in flight.
    editorState.markdown = 'edited';
    act(() => {
      editorState.onChangeCbs[0]?.();
    });
    await waitFor(() => expect(apiState.bodySetCalls).toBeGreaterThanOrEqual(1), {
      timeout: 800,
    });
    expect(apiState.bodySetResolve).not.toBeNull();

    // Unmount while the save is still pending. Editor must go away NOW.
    unmount();
    expect(editorState.destroyCalls).toBe(1);

    // Resolving the save after unmount must NOT call onSaved (component gone).
    await act(async () => {
      apiState.bodySetResolve?.();
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(onSaveError).not.toHaveBeenCalled();
  });

  it('does not fire onSaveError after unmount when the in-flight save rejects', async () => {
    const onSaveError = vi.fn();
    const { unmount } = render(<CardBodyEditor cardId="c1" onSaveError={onSaveError} />);

    await act(async () => {
      await settleAllMounts();
    });
    await waitFor(() => expect(editorState.onChangeCbs.length).toBe(1));

    editorState.markdown = 'edited';
    act(() => {
      editorState.onChangeCbs[0]?.();
    });
    await waitFor(() => expect(apiState.bodySetCalls).toBeGreaterThanOrEqual(1), {
      timeout: 800,
    });

    unmount();
    expect(editorState.destroyCalls).toBe(1);

    // Silence Vitest's unhandled-rejection detection: the saver rethrows
    // after we skip the UI callback, and our cleanup fire-and-forget
    // .catch()es it — but a stray rejection can still be flagged.
    await act(async () => {
      apiState.bodySetReject?.(new Error('network fell over'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onSaveError).not.toHaveBeenCalled();
  });

  it('destroys both transient and final editor handles under React StrictMode', async () => {
    const { unmount } = render(
      <StrictMode>
        <CardBodyEditor cardId="c1" />
      </StrictMode>,
    );

    // StrictMode dev double-invoke queues two body_get promises before any
    // microtask flushes. Wait for both to be enqueued.
    await waitFor(() => expect(apiState.bodyGetQueue.length).toBe(2));

    // Resolve the first body_get. Its effect's continuation runs, checks
    // `aborted` (true — the second effect setup already ran) and returns
    // WITHOUT calling mountEditor. Only the second effect enqueues a mount
    // resolver.
    await act(async () => {
      apiState.bodyGetQueue[0]?.({ body_markdown: '' });
      apiState.bodyGetQueue[1]?.({ body_markdown: '' });
      await Promise.resolve();
      await Promise.resolve();
    });

    // The live effect asked mountEditor for a handle. Resolve it and let
    // the component reach `ready`.
    await waitFor(() => expect(editorState.mountResolvers.length).toBeGreaterThan(0));
    await act(async () => {
      editorState.mountResolvers.splice(0).forEach((r) => r(makeHandle()));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(editorState.onChangeCbs.length).toBe(1));

    const destroysBefore = editorState.destroyCalls;
    unmount();
    // The final live handle must be destroyed by cleanup.
    expect(editorState.destroyCalls).toBe(destroysBefore + 1);
  });
});
