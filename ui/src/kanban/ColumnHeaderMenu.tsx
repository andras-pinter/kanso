// Per-column overflow menu: rename, set color, archive. Closes on outside
// click + Escape.

import { useEffect, useRef, useState } from 'react';
import ColorPicker from './ColorPicker';
import { useKanbanStore } from './hooks/useKanbanStore';
import type { ColumnDto } from './types';

interface Props {
  column: ColumnDto;
  onStartRename: () => void;
}

export default function ColumnHeaderMenu({ column, onStartRename }: Props) {
  const archive = useKanbanStore((s) => s.archiveColumn);
  const setColor = useKanbanStore((s) => s.setColumnColor);
  const [open, setOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setColorOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setColorOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="kanso-column-menu-root" ref={rootRef}>
      <button
        type="button"
        className="kanso-column-menu-btn"
        aria-label="Column menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="kanso-menu" role="menu">
          <button
            type="button"
            className="kanso-menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onStartRename();
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="kanso-menu-item"
            role="menuitem"
            aria-expanded={colorOpen}
            onClick={() => setColorOpen((v) => !v)}
          >
            Set color
          </button>
          {colorOpen && (
            <div className="kanso-menu-color">
              <ColorPicker
                value={column.color}
                onChange={(c) => {
                  void setColor(column.id, c);
                  setColorOpen(false);
                  setOpen(false);
                }}
              />
            </div>
          )}
          <div className="kanso-menu-divider" />
          <button
            type="button"
            className="kanso-menu-item kanso-menu-item--danger"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void archive(column.id);
            }}
          >
            Archive
          </button>
        </div>
      )}
    </div>
  );
}
