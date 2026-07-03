// Keyboard shortcuts: ⌘F opens search, ⌘N opens quick-add. ⌘K stays
// aliased to ⌘F for muscle memory. All three are suppressed inside the
// document editor (contenteditable / `.kanso-doc-content`); ⌘N is also
// suppressed inside plain form inputs so it doesn't clobber typing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCmdF, useCmdK, useCmdN } from '../hooks/useCmdK';

function dispatchMod(key: string, target: Element) {
  const ev = new KeyboardEvent('keydown', {
    key,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(ev, 'target', { value: target, configurable: true });
  document.dispatchEvent(ev);
  return ev;
}

describe('mod-key shortcuts', () => {
  const realPlatform = navigator.platform;

  beforeEach(() => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'platform', {
      value: realPlatform,
      configurable: true,
    });
    document.body.innerHTML = '';
  });

  describe('useCmdF', () => {
    it('fires on Cmd+F from body', () => {
      const trigger = vi.fn();
      renderHook(() => useCmdF(trigger));
      const ev = dispatchMod('f', document.body);
      expect(trigger).toHaveBeenCalledTimes(1);
      expect(ev.defaultPrevented).toBe(true);
    });

    it('still fires when focus is in a plain INPUT (palette-search is unrelated to typing)', () => {
      const trigger = vi.fn();
      renderHook(() => useCmdF(trigger));
      const input = document.createElement('input');
      document.body.appendChild(input);
      dispatchMod('f', input);
      expect(trigger).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire inside a contentEditable surface (browser find handles it)', () => {
      const trigger = vi.fn();
      renderHook(() => useCmdF(trigger));
      const wrap = document.createElement('div');
      wrap.setAttribute('contenteditable', 'true');
      const inner = document.createElement('span');
      wrap.appendChild(inner);
      document.body.appendChild(wrap);
      const ev = dispatchMod('f', inner);
      expect(trigger).not.toHaveBeenCalled();
      expect(ev.defaultPrevented).toBe(false);
    });

    it('does NOT fire inside `.kanso-doc-content`', () => {
      const trigger = vi.fn();
      renderHook(() => useCmdF(trigger));
      const doc = document.createElement('div');
      doc.className = 'kanso-doc-content';
      const inner = document.createElement('div');
      doc.appendChild(inner);
      document.body.appendChild(doc);
      const ev = dispatchMod('f', inner);
      expect(trigger).not.toHaveBeenCalled();
      expect(ev.defaultPrevented).toBe(false);
    });
  });

  describe('useCmdN', () => {
    it('fires on Cmd+N from body', () => {
      const trigger = vi.fn();
      renderHook(() => useCmdN(trigger));
      const ev = dispatchMod('n', document.body);
      expect(trigger).toHaveBeenCalledTimes(1);
      expect(ev.defaultPrevented).toBe(true);
    });

    it('does NOT fire when focus is in an INPUT', () => {
      const trigger = vi.fn();
      renderHook(() => useCmdN(trigger));
      const input = document.createElement('input');
      document.body.appendChild(input);
      dispatchMod('n', input);
      expect(trigger).not.toHaveBeenCalled();
    });

    it('does NOT fire when focus is in a TEXTAREA', () => {
      const trigger = vi.fn();
      renderHook(() => useCmdN(trigger));
      const ta = document.createElement('textarea');
      document.body.appendChild(ta);
      dispatchMod('n', ta);
      expect(trigger).not.toHaveBeenCalled();
    });

    it('does NOT fire inside a contentEditable surface', () => {
      const trigger = vi.fn();
      renderHook(() => useCmdN(trigger));
      const wrap = document.createElement('div');
      wrap.setAttribute('contenteditable', 'true');
      const inner = document.createElement('span');
      wrap.appendChild(inner);
      document.body.appendChild(wrap);
      dispatchMod('n', inner);
      expect(trigger).not.toHaveBeenCalled();
    });
  });

  describe('useCmdK (alias of useCmdF)', () => {
    it('fires on Cmd+K from body', () => {
      const trigger = vi.fn();
      renderHook(() => useCmdK(trigger));
      dispatchMod('k', document.body);
      expect(trigger).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire inside `.kanso-doc-content`', () => {
      const trigger = vi.fn();
      renderHook(() => useCmdK(trigger));
      const doc = document.createElement('div');
      doc.className = 'kanso-doc-content';
      const inner = document.createElement('div');
      doc.appendChild(inner);
      document.body.appendChild(doc);
      dispatchMod('k', inner);
      expect(trigger).not.toHaveBeenCalled();
    });
  });
});
