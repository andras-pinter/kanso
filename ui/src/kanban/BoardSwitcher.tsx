// Header dropdown for switching boards. Lists live boards, a divider, and
// shortcuts for creating a new board and opening the manage drawer.

import { useEffect, useRef, useState } from 'react';
import { useKanbanStore } from './hooks/useKanbanStore';

interface Props {
  onOpenManage: () => void;
}

export default function BoardSwitcher({ onOpenManage }: Props) {
  const boards = useKanbanStore((s) => s.boards);
  const currentId = useKanbanStore((s) => s.currentBoardId);
  const switchBoard = useKanbanStore((s) => s.switchBoard);
  const createBoard = useKanbanStore((s) => s.boardCreate);

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setDraft('');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setCreating(false);
        setDraft('');
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const live = boards.filter((b) => b.archived_at === null);
  const current = boards.find((b) => b.id === currentId) ?? null;

  const commitCreate = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setCreating(false);
      setDraft('');
      return;
    }
    const created = await createBoard(trimmed);
    setCreating(false);
    setDraft('');
    setOpen(false);
    if (!created) return;
  };

  return (
    <div className="kanso-switcher-root" ref={rootRef}>
      <button
        type="button"
        className="kanso-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="kanso-wordmark">kanso</span>
        <span className="kanso-switcher-sep" aria-hidden="true">
          ·
        </span>
        <span className="kanso-switcher-current">
          {current?.name ?? (live.length === 0 ? 'No boards' : 'Pick a board')}
        </span>
        <span className="kanso-switcher-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="kanso-menu kanso-switcher-menu" role="menu">
          {live.length === 0 && (
            <div className="kanso-menu-empty">No live boards</div>
          )}
          {live.map((b) => (
            <button
              key={b.id}
              type="button"
              role="menuitem"
              className={`kanso-menu-item${
                b.id === currentId ? ' kanso-menu-item--active' : ''
              }`}
              onClick={() => {
                void switchBoard(b.id);
                setOpen(false);
              }}
            >
              {b.color && (
                <span
                  className="kanso-board-dot"
                  style={{ backgroundColor: b.color }}
                  aria-hidden="true"
                />
              )}
              <span>{b.name}</span>
            </button>
          ))}
          <div className="kanso-menu-divider" />
          {creating ? (
            <div className="kanso-menu-create">
              <input
                ref={inputRef}
                className="kanso-add-column-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void commitCreate();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setCreating(false);
                    setDraft('');
                  }
                }}
                placeholder="Board name"
              />
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="kanso-menu-item"
              onClick={() => setCreating(true)}
            >
              ⊕ New board…
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="kanso-menu-item"
            onClick={() => {
              setOpen(false);
              onOpenManage();
            }}
          >
            ⚙ Manage boards…
          </button>
        </div>
      )}
    </div>
  );
}
