import { useEffect, useRef, useState } from 'react';
import { mountEditor, type EditorHandle } from '../editor';
import { base64ToBytes, bytesToBase64 } from './base64';
import { cardBodyGet, cardBodySet } from './api/client';
import { useDebouncedSave } from './hooks/useDebouncedSave';

interface Props {
  cardId: string;
}

type Phase =
  | { kind: 'fetching' }
  | { kind: 'mounting' }
  | { kind: 'ready' }
  | { kind: 'load-failed'; message: string };

type SaveState = 'idle' | 'saving' | 'saved' | { kind: 'error'; message: string };

const DEBOUNCE_MS = 500;
const SAVED_PILL_MS = 1400;

export default function CardBodyEditor({ cardId }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'fetching' });
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const savedTimerRef = useRef<number | null>(null);
  const lastSentRef = useRef<string | null>(null);
  const pendingRetryRef = useRef<{ blob: Uint8Array; text: string } | null>(null);

  const saver = useDebouncedSave<{ blob: Uint8Array; text: string }>(async (value) => {
    const b64 = bytesToBase64(value.blob);
    if (b64 === lastSentRef.current) return;
    setSaveState('saving');
    try {
      await cardBodySet(cardId, { body_blocksuite_b64: b64, body_text: value.text });
      lastSentRef.current = b64;
      pendingRetryRef.current = null;
      setSaveState('saved');
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = window.setTimeout(() => setSaveState('idle'), SAVED_PILL_MS);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[kanso] card_body_set failed', e);
      pendingRetryRef.current = value;
      setSaveState({ kind: 'error', message });
    }
  }, DEBOUNCE_MS);

  useEffect(() => {
    let aborted = false;
    let handle: EditorHandle | null = null;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      setPhase({ kind: 'fetching' });
      let initialBytes: Uint8Array | undefined;
      let initialText = '';
      try {
        const body = await cardBodyGet(cardId);
        if (aborted) return;
        if (body.body_blocksuite_b64) {
          initialBytes = base64ToBytes(body.body_blocksuite_b64);
          lastSentRef.current = body.body_blocksuite_b64;
        }
        initialText = body.body_text ?? '';
      } catch (e) {
        if (aborted) return;
        const message = e instanceof Error ? e.message : String(e);
        console.error('[kanso] card_body_get failed; starting fresh', e);
        setPhase({ kind: 'load-failed', message });
        // fall through with an empty editor so the user doesn't lose the ability to type
      }

      if (aborted || !hostRef.current) return;
      setPhase((p) => (p.kind === 'load-failed' ? p : { kind: 'mounting' }));

      try {
        handle = await mountEditor(hostRef.current, { initialDoc: initialBytes });
      } catch (e) {
        if (aborted) return;
        const message = e instanceof Error ? e.message : String(e);
        console.error('[kanso] editor mount failed', e);
        setPhase({ kind: 'load-failed', message });
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
        const text = handleRef.current?.extractPlaintext() ?? initialText;
        saver.schedule({ blob: doc, text });
      });
      setPhase((p) => (p.kind === 'load-failed' ? p : { kind: 'ready' }));
    })();

    return () => {
      aborted = true;
      unsubscribe?.();
      // Best-effort flush of any pending edits before tearing down.
      void saver.flush().finally(() => {
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
    // cardId is the identity; saver is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    };
  }, []);

  const retry = (): void => {
    const value = pendingRetryRef.current;
    if (value) saver.schedule(value);
  };

  return (
    <div className="kanso-editor">
      <div className="kanso-editor-status" aria-live="polite">
        {phase.kind === 'fetching' && <span className="kanso-editor-loading">Loading body…</span>}
        {phase.kind === 'mounting' && (
          <span className="kanso-editor-loading">Loading editor…</span>
        )}
        {phase.kind === 'load-failed' && (
          <span className="kanso-editor-banner" role="alert">
            Couldn’t load body — starting fresh ({phase.message}).
          </span>
        )}
        {saveState === 'saving' && <span className="kanso-saved-pill">Saving…</span>}
        {saveState === 'saved' && (
          <span className="kanso-saved-pill kanso-saved-pill--visible">Saved</span>
        )}
        {typeof saveState === 'object' && (
          <button
            type="button"
            className="kanso-save-error"
            onClick={retry}
            title={saveState.message}
          >
            Save failed — retry
          </button>
        )}
      </div>
      <div ref={hostRef} className="kanso-editor-host" />
    </div>
  );
}
