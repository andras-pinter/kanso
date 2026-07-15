import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Regression guard for issue #6. BlockSuite's slash-menu active-item
 * highlight is `background: var(--affine-hover-color)` on `<icon-button>`.
 * If `blocksuite-theme.css` is deleted or the token map is trimmed, this
 * test fails before it can ship.
 *
 * We read the CSS file directly and inject it via <style> instead of
 * `import './blocksuite-theme.css'` so the assertion doesn't rely on
 * Vite's dev-mode CSS side-effect injection.
 */

const CSS_PATH = path.resolve(__dirname, '../blocksuite-theme.css');
const CSS = fs.readFileSync(CSS_PATH, 'utf8');

function installStyle(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  return style;
}

/**
 * kanban.css owns the `--kanso-*` palette that blocksuite-theme.css
 * references. Test in isolation with a tiny stub so we don't drag the
 * whole kanban stylesheet in.
 */
function installKansoTokens(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = `:root {
    --kanso-bg-hover: #f3f4f6;
    --kanso-accent: #3b82f6;
    --kanso-border: #e5e7eb;
    --kanso-fg: #111827;
    --kanso-fg-muted: #6b7280;
    --kanso-fg-subtle: #9ca3af;
    --kanso-bg-subtle: #fafaf9;
  }`;
  document.head.appendChild(style);
  return style;
}

describe('blocksuite-theme.css', () => {
  const installed: HTMLStyleElement[] = [];

  afterEach(() => {
    for (const el of installed.splice(0)) el.remove();
  });

  it('defines --affine-hover-color so slash-menu active items render', () => {
    installed.push(installKansoTokens(), installStyle());
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue('--affine-hover-color')
      .trim();
    expect(value).not.toBe('');
  });

  it('bridges the state/icon tokens BlockSuite widgets read', () => {
    installed.push(installKansoTokens(), installStyle());
    const cs = getComputedStyle(document.documentElement);
    for (const token of [
      '--affine-hover-color',
      '--affine-primary-color',
      '--affine-brand-color',
      '--affine-border-color',
      '--affine-icon-color',
      '--affine-text-disable-color',
    ]) {
      expect(cs.getPropertyValue(token).trim(), token).not.toBe('');
    }
  });

  it('pins portalled overlay z-index above the card modal', () => {
    installed.push(installStyle());
    const cs = getComputedStyle(document.documentElement);
    expect(cs.getPropertyValue('--affine-z-index-popover').trim()).toBe('65');
    expect(cs.getPropertyValue('--affine-z-index-modal').trim()).toBe('65');
  });
});
