// Bottom status bar: connection dot + loopback address + keyboard hints.
// The API is in-process on loopback, so "connected" just means the
// api_port command answered. When running outside Tauri (vitest, browser
// preview), we render an "offline" state with no port.

import { useEffect, useState } from 'react';
import { apiPort, isTauri } from './kanban/api/client';

export default function StatusBar() {
  const [port, setPort] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    apiPort()
      .then((p) => {
        if (!alive) return;
        setPort(p);
        setConnected(true);
      })
      .catch((err: unknown) => {
        console.warn('api_port failed', err);
        if (alive) setConnected(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <footer className="kanso-status-bar" role="contentinfo">
      <span
        className={`kanso-status-dot ${
          connected ? 'kanso-status-dot--ok' : 'kanso-status-dot--off'
        }`}
        aria-hidden="true"
      />
      <span>{connected ? 'connected' : 'offline'}</span>
      {port !== null && (
        <span className="kanso-status-mono">127.0.0.1:{port}</span>
      )}
      <span className="kanso-status-hints">
        <kbd className="kanso-kbd">⌘K</kbd>
        <kbd className="kanso-kbd">N</kbd>
        <kbd className="kanso-kbd">?</kbd>
      </span>
    </footer>
  );
}
