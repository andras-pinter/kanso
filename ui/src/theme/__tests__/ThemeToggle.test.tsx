import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ThemeToggle from '../ThemeToggle';

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

beforeEach(() => {
  installLocalStorageShim();
  document.documentElement.removeAttribute('data-theme');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
      onchange: null,
    }),
  });
});

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeToggle', () => {
  it('renders Light / System / Dark buttons with System initially pressed', () => {
    render(<ThemeToggle />);
    const light = screen.getByRole('button', { name: /light theme/i });
    const system = screen.getByRole('button', { name: /system theme/i });
    const dark = screen.getByRole('button', { name: /dark theme/i });
    expect(light.getAttribute('aria-pressed')).toBe('false');
    expect(system.getAttribute('aria-pressed')).toBe('true');
    expect(dark.getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking Dark persists "dark" and pins data-theme', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /dark theme/i }));
    expect(window.localStorage.getItem('kanso.theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: /dark theme/i }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('clicking Light then System clears persistence and data-theme', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /light theme/i }));
    expect(window.localStorage.getItem('kanso.theme')).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: /system theme/i }));
    expect(window.localStorage.getItem('kanso.theme')).toBeNull();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
