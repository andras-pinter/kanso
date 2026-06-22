// Subscribes to the `quick-add:open` Tauri event so the global hotkey and
// tray menu can pop the quick-add modal from the Rust side. No-op outside
// Tauri so tests + Vite dev shell don't try to import the Tauri event API.

import { useEffect } from 'react';
import { isTauri } from '../kanban/api/client';

export const QUICK_ADD_EVENT = 'quick-add:open';

export function useQuickAddOpenEvent(onTrigger: () => void): void {
  useEffect(() => {
    if (!isTauri()) return;
    let dispose: (() => void) | null = null;
    let alive = true;
    void import('@tauri-apps/api/event').then(({ listen }) => {
      if (!alive) return;
      void listen(QUICK_ADD_EVENT, () => onTrigger()).then((un) => {
        if (!alive) {
          un();
          return;
        }
        dispose = un;
      });
    });
    return () => {
      alive = false;
      if (dispose) dispose();
    };
  }, [onTrigger]);
}
