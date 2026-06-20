// M1 regression: Cmd+K must not steal focus from inputs, textareas,
// selects, or contentEditable surfaces (BlockSuite editor).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCmdK } from '../hooks/useCmdK';

function dispatchCmdK(target: Element) {
  // Pretend we're on macOS so metaKey is the active modifier.
  const ev = new KeyboardEvent('keydown', {
    key: 'k',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(ev, 'target', { value: target, configurable: true });
  document.dispatchEvent(ev);
  return ev;
}

describe('useCmdK', () => {
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

  it('fires on Cmd+K from body', () => {
    const trigger = vi.fn();
    renderHook(() => useCmdK(trigger));
    dispatchCmdK(document.body);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('does not fire when focus is in an INPUT', () => {
    const trigger = vi.fn();
    renderHook(() => useCmdK(trigger));
    const input = document.createElement('input');
    document.body.appendChild(input);
    const ev = dispatchCmdK(input);
    expect(trigger).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('does not fire when focus is in a TEXTAREA', () => {
    const trigger = vi.fn();
    renderHook(() => useCmdK(trigger));
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    dispatchCmdK(ta);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('does not fire inside a contentEditable surface', () => {
    const trigger = vi.fn();
    renderHook(() => useCmdK(trigger));
    const wrap = document.createElement('div');
    wrap.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    dispatchCmdK(inner);
    expect(trigger).not.toHaveBeenCalled();
  });
});
