import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { readStoredPreference, useTheme, type ThemePreference } from '../useTheme';

type MQListener = (e: { matches: boolean }) => void;

function installLocalStorageShim(): void {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: shim });
}

function installMatchMedia(initialDark: boolean) {
  const listeners = new Set<MQListener>();
  const state = { matches: initialDark };
  const mq = {
    get matches() {
      return state.matches;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_evt: string, fn: MQListener) => listeners.add(fn),
    removeEventListener: (_evt: string, fn: MQListener) => listeners.delete(fn),
    addListener: (fn: MQListener) => listeners.add(fn),
    removeListener: (fn: MQListener) => listeners.delete(fn),
    dispatchEvent: () => true,
    onchange: null,
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue(mq),
  });
  return {
    setDark(dark: boolean) {
      state.matches = dark;
      listeners.forEach((fn) => fn({ matches: dark }));
    },
  };
}

describe('useTheme', () => {
  beforeEach(() => {
    installLocalStorageShim();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to system preference when no value persisted', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('resolves to dark when system reports dark', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('reads persisted preference on mount', () => {
    window.localStorage.setItem('kanso.theme', 'dark');
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('dark');
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('setPreference("light") writes localStorage and sets data-theme', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('light'));
    expect(window.localStorage.getItem('kanso.theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(result.current.resolved).toBe('light');
  });

  it('setPreference("system") clears localStorage and data-theme', () => {
    window.localStorage.setItem('kanso.theme', 'dark');
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    act(() => result.current.setPreference('system'));
    expect(window.localStorage.getItem('kanso.theme')).toBeNull();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('reacts to OS scheme flip while on "system"', () => {
    const mq = installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('light');
    act(() => mq.setDark(true));
    expect(result.current.resolved).toBe('dark');
  });

  it('ignores OS scheme flip when manual preference is pinned', () => {
    const mq = installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('light'));
    act(() => mq.setDark(true));
    expect(result.current.resolved).toBe('light');
  });
});

describe('readStoredPreference', () => {
  beforeEach(() => installLocalStorageShim());

  it('returns "system" for missing key', () => {
    expect(readStoredPreference()).toBe('system');
  });

  it('returns persisted preference', () => {
    const cases: ThemePreference[] = ['light', 'dark', 'system'];
    for (const v of cases) {
      window.localStorage.setItem('kanso.theme', v);
      expect(readStoredPreference()).toBe(v);
    }
  });

  it('rejects garbage values and falls back to "system"', () => {
    window.localStorage.setItem('kanso.theme', 'mauve');
    expect(readStoredPreference()).toBe('system');
  });
});
