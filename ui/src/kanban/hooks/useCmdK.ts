// Global "open command palette" hotkey: ⌘K on macOS, Ctrl+K elsewhere.

import { useEffect } from 'react';

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.platform.toLowerCase().includes('mac');
}

export function useCmdK(onTrigger: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'k' && e.key !== 'K') return;
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      // Skip if another modifier is held (avoid Cmd+Shift+K browser shortcuts).
      if (e.altKey) return;
      e.preventDefault();
      onTrigger();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onTrigger]);
}
