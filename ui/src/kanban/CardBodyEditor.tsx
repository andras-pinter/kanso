import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { mountEditor, type EditorHandle } from '../editor';
import { base64ToBytes, bytesToBase64 } from './base64';
import { cardBodyGet, cardBodySet } from './api/client';
import { useDebouncedSave } from './hooks/useDebouncedSave';

interface Props {
  cardId: string;
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
   * overwrite the unread blob with empty. User must explicitly retry. */
  | { kind: 'fetch-failed'; message: string }
  /** Editor failed to mount after a successful fetch (rare). Same retry path. */
  | { kind: 'mount-failed'; message: string };

type SaveState = 'idle' | 'saving' | 'saved' | { kind: 'error'; message: string };

const DEBOUNCE_MS = 500;
const SAVED_PILL_MS = 1400;

function CardBodyEditorImpl(
  { cardId }: Props,
  ref: React.ForwardedRef<CardBodyEditorHandle>,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'fetching' });
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [fetchAttempt, setFetchAttempt] = useState(0);
  const savedTimerRef = useRef<number | null>(null);
  const lastSentRef = useRef<string | null>(null);

  const saver = useDebouncedSave<{ blob: Uint8Array; text: string }>(async (value) => {
    const b64 = bytesToBase64(value.blob);
    if (b64 === lastSentRef.current) return;
    setSaveState('saving');
    try {
      await cardBodySet(cardId, { body_blocksuite_b64: b64, body_text: value.text });
      lastSentRef.current = b64;
      setSaveState('saved');
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = window.setTimeout(() => setSaveState('idle'), SAVED_PILL_MS);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[kanso] card_body_set failed', e);
      setSaveState({ kind: 'error', message });
      // Rethrow so useDebouncedSave retains the value AND flush() rejects,
      // which lets the drawer close handler keep the drawer open.
      throw e;
    }
  }, DEBOUNCE_MS);

  useImperativeHandle(ref, () => ({ flush: () => saver.flush() }), [saver]);

  useEffect(() => {
    let aborted = false;
    let handle: EditorHandle | null = null;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      setPhase({ kind: 'fetching' });
      let initialBytes: Uint8Array | undefined;
      let initialText = '';
      let convertedFromLegacy = false;
      try {
        const body = await cardBodyGet(cardId);
        if (aborted) return;
        if (body.body_blocksuite_b64) {
          initialBytes = base64ToBytes(body.body_blocksuite_b64);
          lastSentRef.current = body.body_blocksuite_b64;
        } else if (body.body_text && body.body_text.length > 0) {
          // Legacy textarea-era card: silently seed the editor with the
          // existing plaintext so the user's content isn't shadowed by an
          // empty blob on the first save.
          initialText = body.body_text;
          convertedFromLegacy = true;
        }
      } catch (e) {
        if (aborted) return;
        const message = e instanceof Error ? e.message : String(e);
        console.error('[kanso] card_body_get failed', e);
        // H5: do NOT mount an empty editor here — a subsequent save would
        // overwrite the real (unread) blob with empty content. Surface the
        // error and let the user retry.
        setPhase({ kind: 'fetch-failed', message });
        return;
      }

      if (aborted || !hostRef.current) return;
      setPhase({ kind: 'mounting' });

      try {
        handle = await mountEditor(hostRef.current, {
          initialDoc: initialBytes,
          initialText: convertedFromLegacy ? initialText : undefined,
        });
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
      // Re-derive the canonical b64 so the very next change (which may be
      // identical bytes due to BlockSuite normalisation) doesn't trigger a save.
      const baseline = bytesToBase64(handle.serialize());
      if (initialBytes) lastSentRef.current = baseline;

      unsubscribe = handle.onChange((doc) => {
        const h = handleRef.current;
        if (!h) return;
        saver.schedule({ blob: doc, text: h.extractPlaintext() });
      });
      setPhase({ kind: 'ready' });

      // H1 follow-through: persist the seeded blob even if the user makes
      // no edits, so the legacy -> BlockSuite conversion survives
      // open + close-without-editing.
      if (convertedFromLegacy) {
        saver.schedule({ blob: handle.serialize(), text: handle.extractPlaintext() });
      }
    })();

    return () => {
      aborted = true;
      unsubscribe?.();
      // Best-effort flush before teardown. The Close button awaits flush
      // separately and keeps the drawer open on failure; this path only
      // runs when the unmount is unavoidable (cardId change, parent gone),
      // so a rejected save here means we've lost the edit.
      void saver
        .flush()
        .catch((e) => {
          console.error('[kanso] cleanup flush failed; edits may be lost', e);
        })
        .finally(() => {
          if (handle) {
            try {
              handle.destroy();
            } catch (e) {
              console.warn('[kanso] editor destroy threw', e);
            }
          }
          handleRef.current = null;
        });
    };
    // cardId is the identity; saver is stable across renders; fetchAttempt
    // is intentionally a dep so retry can re-run the effect from scratch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, fetchAttempt]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    };
  }, []);

  // H3: retry pulls the *current* editor state instead of replaying the
  // stashed value, so an edit made after the failure isn't evicted.
  const retrySave = (): void => {
    const handle = handleRef.current;
    if (!handle) return;
    saver.schedule({ blob: handle.serialize(), text: handle.extractPlaintext() });
  };

  const retryFetch = (): void => {
    setSaveState('idle');
    lastSentRef.current = null;
    setFetchAttempt((n) => n + 1);
  };

  const fetchFailed = phase.kind === 'fetch-failed';
  const mountFailed = phase.kind === 'mount-failed';

  return (
    <div className="kanso-editor">
      <div className="kanso-editor-status" aria-live="polite">
        {phase.kind === 'fetching' && <span className="kanso-editor-loading">Loading body…</span>}
        {phase.kind === 'mounting' && (
          <span className="kanso-editor-loading">Loading editor…</span>
        )}
        {saveState === 'saving' && <span className="kanso-saved-pill">Saving…</span>}
        {saveState === 'saved' && (
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
      {!fetchFailed && !mountFailed && <div ref={hostRef} className="kanso-editor-host" />}
    </div>
  );
}

const CardBodyEditor = forwardRef<CardBodyEditorHandle, Props>(CardBodyEditorImpl);
CardBodyEditor.displayName = 'CardBodyEditor';
export default CardBodyEditor;
