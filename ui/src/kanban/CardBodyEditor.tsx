import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { mountEditor, type EditorHandle } from '../editor';
import { cardBodyGet, cardBodySet } from './api/client';
import { useDebouncedSave } from './hooks/useDebouncedSave';

interface Props {
  cardId: string;
  /** Optional callback fired when a save round-trips successfully. When
   * provided the editor SUPPRESSES its own inline Saving…/Saved pill so
   * the parent modal can render a single "Saved" indicator. */
  onSaved?: () => void;
  /** Optional callback fired when a save fails. The editor still renders
   * its inline "Save failed — retry" affordance because retry is coupled
   * to editor state; this is for parents that want their own error UI. */
  onSaveError?: (message: string) => void;
}

/** Imperative handle exposed to the parent drawer so its Close button can
 * await pending edits before navigating away. */
export interface CardBodyEditorHandle {
  /**
   * Force any pending or in-flight save to land. Rejects if the underlying
   * PUT fails so the drawer can keep itself open on the error.
   */
  flush(): Promise<void>;
}

type Phase =
  | { kind: 'fetching' }
  | { kind: 'mounting' }
  | { kind: 'ready' }
  /** Body fetch rejected. Editor is NOT mounted — a stray save would
   * overwrite the unread markdown with empty. User must explicitly retry. */
  | { kind: 'fetch-failed'; message: string }
  /** Editor failed to mount after a successful fetch (rare). Same retry path. */
  | { kind: 'mount-failed'; message: string };

type SaveState = 'idle' | 'saving' | 'saved' | { kind: 'error'; message: string };

const DEBOUNCE_MS = 500;
const SAVED_PILL_MS = 1400;

function CardBodyEditorImpl(
  { cardId, onSaved, onSaveError }: Props,
  ref: React.ForwardedRef<CardBodyEditorHandle>,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'fetching' });
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [fetchAttempt, setFetchAttempt] = useState(0);
  const savedTimerRef = useRef<number | null>(null);
  const lastSentRef = useRef<string | null>(null);
  // Set to true during unmount cleanup so a detached save-in-flight (or the
  // cleanup fire-and-forget flush) skips setState, timers, and parent
  // callbacks — the PUT still persists, but no UI lifecycle work touches
  // the dead component.
  const unmountedRef = useRef(false);
  // Refs so the debounced save closure sees the latest callback without
  // re-instantiating useDebouncedSave (which would drop pending saves).
  const onSavedRef = useRef(onSaved);
  const onSaveErrorRef = useRef(onSaveError);
  useEffect(() => {
    onSavedRef.current = onSaved;
    onSaveErrorRef.current = onSaveError;
  }, [onSaved, onSaveError]);

  const saver = useDebouncedSave<string>(async (markdown) => {
    if (markdown === lastSentRef.current) return;
    if (!unmountedRef.current) setSaveState('saving');
    try {
      await cardBodySet(cardId, { body_markdown: markdown });
      lastSentRef.current = markdown;
      if (unmountedRef.current) return;
      setSaveState('saved');
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = window.setTimeout(() => setSaveState('idle'), SAVED_PILL_MS);
      onSavedRef.current?.();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[kanso] card_body_set failed', e);
      if (!unmountedRef.current) {
        setSaveState({ kind: 'error', message });
        onSaveErrorRef.current?.(message);
      }
      // Rethrow so useDebouncedSave retains the value AND flush() rejects,
      // which lets the drawer close handler keep the drawer open.
      throw e;
    }
  }, DEBOUNCE_MS);

  useImperativeHandle(ref, () => ({ flush: () => saver.flush() }), [saver]);

  useEffect(() => {
    // Reset the unmount guard for this run so a prior cardId's cleanup does
    // not stop the new editor from updating UI state.
    unmountedRef.current = false;
    let aborted = false;
    let handle: EditorHandle | null = null;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      setPhase({ kind: 'fetching' });
      let initialMarkdown: string;
      try {
        const body = await cardBodyGet(cardId);
        if (aborted) return;
        initialMarkdown = body.body_markdown ?? '';
        lastSentRef.current = initialMarkdown;
      } catch (e) {
        if (aborted) return;
        const message = e instanceof Error ? e.message : String(e);
        console.error('[kanso] card_body_get failed', e);
        // H5: do NOT mount an empty editor here — a subsequent save would
        // overwrite the real (unread) body with empty content. Surface the
        // error and let the user retry.
        setPhase({ kind: 'fetch-failed', message });
        return;
      }

      if (aborted || !hostRef.current) return;
      setPhase({ kind: 'mounting' });

      try {
        handle = await mountEditor(hostRef.current, { initialMarkdown });
      } catch (e) {
        if (aborted) return;
        const message = e instanceof Error ? e.message : String(e);
        console.error('[kanso] editor mount failed', e);
        setPhase({ kind: 'mount-failed', message });
        return;
      }
      if (aborted) {
        handle.destroy();
        return;
      }
      handleRef.current = handle;
      // Re-derive the canonical markdown so the very next change (which may
      // be an identical string due to Markdown serializer normalisation)
      // doesn't trigger a save.
      lastSentRef.current = handle.getMarkdown();

      unsubscribe = handle.onChange(() => {
        const h = handleRef.current;
        if (!h) return;
        saver.schedule(h.getMarkdown());
      });
      setPhase({ kind: 'ready' });
    })();

    return () => {
      // Set the unmount guard BEFORE flushing. React runs cleanup callbacks
      // in declaration order, so this cleanup fires before the timer-clear
      // effect below — and saver.flush() invokes the save closure's sync
      // portion the moment it starts. If the guard isn't set here, that
      // sync portion (and any sync-thrown catch handler underneath) leaks
      // setSaveState / onSaveError to the dying component.
      unmountedRef.current = true;
      aborted = true;
      unsubscribe?.();
      // Tear down ProseMirror synchronously so listeners, observers and the
      // slash-menu portal go away immediately — a hung save must not keep
      // them alive. The Close button awaits flush separately and keeps the
      // drawer open on failure; this path runs when unmount is unavoidable
      // (cardId change, parent gone), so a rejected save here means we've
      // lost the edit.
      const localHandle = handle;
      handle = null;
      handleRef.current = null;
      if (localHandle) {
        try {
          localHandle.destroy();
        } catch (e) {
          console.warn('[kanso] editor destroy threw', e);
        }
      }
      void saver.flush().catch((e) => {
        console.error('[kanso] cleanup flush failed; edits may be lost', e);
      });
    };
    // cardId is the identity; saver is stable across renders; fetchAttempt
    // is intentionally a dep so retry can re-run the effect from scratch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, fetchAttempt]);

  useEffect(() => {
    // savedTimerRef is only relevant across the component's whole lifetime
    // (not per cardId), so it lives in its own mount-only effect. The
    // unmount guard is managed by the main effect above — setting it there
    // ensures it lands BEFORE saver.flush() runs during cleanup.
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
        savedTimerRef.current = null;
      }
    };
  }, []);

  // H3: retry pulls the *current* editor state instead of replaying the
  // stashed value, so an edit made after the failure isn't evicted.
  const retrySave = (): void => {
    const handle = handleRef.current;
    if (!handle) return;
    saver.schedule(handle.getMarkdown());
  };

  const retryFetch = (): void => {
    setSaveState('idle');
    lastSentRef.current = null;
    setFetchAttempt((n) => n + 1);
  };

  const fetchFailed = phase.kind === 'fetch-failed';
  const mountFailed = phase.kind === 'mount-failed';
  // When the parent supplies onSaved, it renders its own "Saved" pill.
  // Suppress the inline Saving…/Saved indicators so the user never sees
  // two pills at once. The "Save failed — retry" affordance stays: retry
  // is coupled to editor state and the parent can't replicate it.
  const suppressInlinePill = onSaved !== undefined;

  return (
    <div className="kanso-editor">
      <div className="kanso-editor-status" aria-live="polite">
        {phase.kind === 'fetching' && <span className="kanso-editor-loading">Loading body…</span>}
        {phase.kind === 'mounting' && (
          <span className="kanso-editor-loading">Loading editor…</span>
        )}
        {!suppressInlinePill && saveState === 'saving' && (
          <span className="kanso-saved-pill">Saving…</span>
        )}
        {!suppressInlinePill && saveState === 'saved' && (
          <span className="kanso-saved-pill kanso-saved-pill--visible">Saved</span>
        )}
        {typeof saveState === 'object' && (
          <button
            type="button"
            className="kanso-save-error"
            onClick={retrySave}
            title={saveState.message}
          >
            Save failed — retry
          </button>
        )}
      </div>
      {(fetchFailed || mountFailed) && (
        <div className="kanso-editor-banner" role="alert">
          <span>
            {fetchFailed ? 'Couldn’t load body' : 'Couldn’t open editor'} — {phase.message}
          </span>
          <button type="button" className="kanso-btn kanso-btn--small" onClick={retryFetch}>
            Retry
          </button>
        </div>
      )}
      {/* Host is unconditional so React never tears down a div that TipTap-
       * owned ProseMirror DOM lives inside. Hidden via CSS when a failure
       * banner is showing; keeps mount/unmount coupled 1:1 with this
       * component. */}
      <div
        ref={hostRef}
        className="kanso-editor-host"
        hidden={fetchFailed || mountFailed}
      />
    </div>
  );
}

/**
 * Rich-text body editor for a single card.
 *
 * **Caller invariant:** callers MUST render this component with
 * `key={cardId}` (see `KanbanBoard.tsx` — the drawer keys the selected card
 * that way). Effect A keeps `cardId` in its dep list to support the
 * fetch-retry case (same `cardId`, bumped `fetchAttempt`), but it does NOT
 * isolate the `useDebouncedSave` closure across genuine `cardId` changes: a
 * save in flight when `cardId` flips would resolve into the new run's state
 * and potentially write the previous card's body into the new one. The
 * `key={cardId}` remount makes that unreachable in production.
 *
 * If a future caller ever swaps `cardId` without a keyed remount, the saver
 * needs per-cardId isolation — either an inner component keyed by `cardId`
 * that owns the saver, or a lifecycle generation counter threaded into each
 * save closure so stale saves can no-op on landing.
 */
const CardBodyEditor = forwardRef<CardBodyEditorHandle, Props>(CardBodyEditorImpl);
CardBodyEditor.displayName = 'CardBodyEditor';
export default CardBodyEditor;
