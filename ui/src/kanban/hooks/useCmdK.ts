// Global "open command palette" hotkey: ⌘K on macOS, Ctrl+K elsewhere.

import { useEffect } from 'react';

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.platform.toLowerCase().includes('mac');
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  if (t.closest('[contenteditable="true"]')) return true;
  return false;
}

export function useCmdK(onTrigger: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'k' && e.key !== 'K') return;
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      // Skip if another modifier is held (avoid Cmd+Shift+K browser shortcuts).
      if (e.altKey) return;
      // Don't steal the shortcut while the user is typing in an editor.
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      onTrigger();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onTrigger]);
}
