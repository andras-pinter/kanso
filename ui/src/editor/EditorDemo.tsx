import { useEffect, useRef, useState } from 'react';
import { mountEditor } from './index';
import type { EditorHandle } from './types';

type Status = 'mounting' | 'ready' | { error: string };

export default function EditorDemo() {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const [status, setStatus] = useState<Status>('mounting');
  const [plaintext, setPlaintext] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    let handle: EditorHandle | null = null;
    (async () => {
      if (!hostRef.current) return;
      try {
        handle = await mountEditor(hostRef.current);
        if (cancelled) {
          handle.destroy();
          return;
        }
        handleRef.current = handle;
        setStatus('ready');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[kanso] editor mount failed', err);
        setStatus({ error: msg });
      }
    })();
    return () => {
      cancelled = true;
      if (handle) handle.destroy();
      handleRef.current = null;
    };
  }, []);

  const onExtract = () => {
    const h = handleRef.current;
    if (!h) return;
    setPlaintext(h.extractPlaintext());
  };

  const statusLabel = typeof status === 'string' ? status : `error: ${status.error}`;
  const ready = status === 'ready';

  return (
    <div>
      <div
        style={{
          padding: 8,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          borderBottom: '1px solid var(--kanso-border)',
        }}
      >
        <code>status: {statusLabel}</code>
        <button onClick={onExtract} disabled={!ready}>
          Extract plaintext
        </button>
      </div>
      <div
        ref={hostRef}
        style={{ minHeight: 400, border: '1px solid var(--kanso-border)' }}
      />
      {plaintext && (
        <pre
          style={{
            padding: 8,
            background: 'var(--kanso-bg-subtle)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {plaintext}
        </pre>
      )}
    </div>
  );
}
