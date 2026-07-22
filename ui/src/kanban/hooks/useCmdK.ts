// Global keyboard shortcuts for the kanban surface.
//
// `useCmdF` — ⌘F on macOS / Ctrl+F elsewhere. Opens the SearchPalette,
// EXCEPT when focus is inside the TipTap editor (`.kanso-doc-content`
// subtree or any contenteditable), in which case we do NOT preventDefault
// and let the browser handle in-document find.
//
// `useCmdN` — ⌘N / Ctrl+N. Opens the quick-add modal. Suppressed when
// the user is typing into an input, textarea, select, or contenteditable.
//
// `useCmdK` — kept as an alias so existing muscle memory still opens the
// palette. Same guard semantics as `useCmdF` (blocks only when inside the
// document editor; not blocked by ordinary form inputs).

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

function isInsideDocEditor(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t.closest('[contenteditable="true"]')) return true;
  if (t.closest('.kanso-doc-content')) return true;
  return false;
}

function bindModKey(
  key: string,
  isBlocked: (target: EventTarget | null) => boolean,
  onTrigger: () => void,
): () => void {
  const lower = key.toLowerCase();
  const upper = key.toUpperCase();
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== lower && e.key !== upper) return;
    const mod = isMac() ? e.metaKey : e.ctrlKey;
    if (!mod) return;
    // Skip when other modifiers are held (e.g. Cmd+Shift+F browser shortcuts).
    if (e.altKey || e.shiftKey) return;
    if (isBlocked(e.target)) return;
    e.preventDefault();
    onTrigger();
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

export function useCmdF(onTrigger: () => void): void {
  useEffect(() => bindModKey('f', isInsideDocEditor, onTrigger), [onTrigger]);
}

export function useCmdN(onTrigger: () => void): void {
  useEffect(() => bindModKey('n', isEditableTarget, onTrigger), [onTrigger]);
}

/** Backwards-compatible alias. ⌘K continues to open the search palette. */
export function useCmdK(onTrigger: () => void): void {
  useEffect(() => bindModKey('k', isInsideDocEditor, onTrigger), [onTrigger]);
}
