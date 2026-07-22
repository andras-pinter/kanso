// Bottom status bar: dot + loopback address + keyboard hints.
// The API is in-process on loopback, so a successful api_port call
// just means the Tauri command answered — it does NOT prove the axum
// server is still up. We label the address as "loopback" (not
// "connected") to avoid overselling that signal.

import { useEffect, useState } from 'react';
import { apiPort, isTauri } from './kanban/api/client';

export default function StatusBar() {
  const [port, setPort] = useState<number | null>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    apiPort()
      .then((p) => {
        if (!alive) return;
        setPort(p);
        setAvailable(true);
      })
      .catch((err: unknown) => {
        console.warn('api_port failed', err);
        if (alive) setAvailable(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <footer className="kanso-status-bar" role="contentinfo">
      <span
        className={`kanso-status-dot ${
          available ? 'kanso-status-dot--ok' : 'kanso-status-dot--off'
        }`}
        aria-hidden="true"
      />
      <span>{available ? 'loopback' : 'offline'}</span>
      {port !== null && (
        <span className="kanso-status-mono">127.0.0.1:{port}</span>
      )}
      <span className="kanso-status-hints">
        <kbd className="kanso-kbd">⌘K</kbd>
        <kbd className="kanso-kbd">⌘N</kbd>
        <kbd className="kanso-kbd">?</kbd>
      </span>
    </footer>
  );
}

