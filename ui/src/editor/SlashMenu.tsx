import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import type { Editor, Range } from '@tiptap/core';
import type { SlashItem } from './slashItems';

export interface SlashMenuProps {
  editor: Editor;
  range: Range;
  items: SlashItem[];
  clientRect: (() => DOMRect | null) | null;
}

export interface SlashMenuHandle {
  onKeyDown(event: ReactKeyboardEvent | KeyboardEvent): boolean;
}

const MENU_WIDTH = 260;
const MENU_MAX_HEIGHT = 320;
const GAP = 6;

const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(function SlashMenu(
  { editor, range, items, clientRect },
  ref,
) {
  const [selected, setSelected] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(clientRect?.() ?? null);

  useEffect(() => {
    setSelected(0);
  }, [items]);

  useEffect(() => {
    if (!clientRect) return;
    // Poll rect on every animation frame while mounted — cheap and avoids
    // wiring a ProseMirror plugin view for a prototype.
    let raf = 0;
    const tick = () => {
      setRect(clientRect());
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [clientRect]);

  const pick = (idx: number) => {
    const item = items[idx];
    if (!item) return;
    item.command({ editor, range });
  };

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown(event) {
        if (!items.length) return false;
        if (event.key === 'ArrowDown') {
          setSelected((s) => (s + 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowUp') {
          setSelected((s) => (s - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          pick(selected);
          return true;
        }
        return false;
      },
    }),
    // pick closes over selected + items, refresh handle when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, selected],
  );

  const style = useMemo<CSSProperties>(() => {
    if (!rect) return { display: 'none' };
    const top = Math.min(window.innerHeight - MENU_MAX_HEIGHT - GAP, rect.bottom + GAP);
    const left = Math.min(window.innerWidth - MENU_WIDTH - GAP, rect.left);
    return {
      position: 'fixed',
      top,
      left,
      width: MENU_WIDTH,
      maxHeight: MENU_MAX_HEIGHT,
      overflowY: 'auto',
      background: 'var(--kanso-bg, white)',
      border: '1px solid var(--kanso-border, #ddd)',
      borderRadius: 6,
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
      padding: 4,
      zIndex: 1000,
    };
  }, [rect]);

  if (!items.length) {
    return (
      <div style={style} role="listbox">
        <div style={{ padding: '8px 10px', opacity: 0.6 }}>No matches</div>
      </div>
    );
  }

  return (
    <div style={style} role="listbox">
      {items.map((item, idx) => {
        const active = idx === selected;
        return (
          <button
            type="button"
            key={item.title}
            role="option"
            aria-selected={active}
            onMouseEnter={() => setSelected(idx)}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(idx);
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              width: '100%',
              padding: '6px 10px',
              background: active ? 'var(--kanso-accent, #2563eb)' : 'transparent',
              color: active ? 'white' : 'inherit',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500 }}>{item.title}</span>
            {item.hint && (
              <span style={{ fontSize: 11, opacity: active ? 0.85 : 0.6 }}>{item.hint}</span>
            )}
          </button>
        );
      })}
    </div>
  );
});

export default SlashMenu;
