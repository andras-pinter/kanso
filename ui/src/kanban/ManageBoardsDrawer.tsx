// Right-side drawer for managing boards: rename, recolor, delete.
// Shares the `.kanso-drawer` chrome with `ManageTagsDrawer`.

import { useEffect, useRef, useState } from 'react';
import ColorPicker from './ColorPicker';
import { useKanbanStore } from './hooks/useKanbanStore';
import type { BoardDto } from './types';
import { ConfirmDialog } from '../Dialog';

interface Props {
  onClose: () => void;
}

export default function ManageBoardsDrawer({ onClose }: Props) {
  const boards = useKanbanStore((s) => s.boards);
  const rename = useKanbanStore((s) => s.boardRename);
  const setColor = useKanbanStore((s) => s.boardSetColor);
  const remove = useKanbanStore((s) => s.boardDelete);
  const [pendingDelete, setPendingDelete] = useState<BoardDto | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="kanso-drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
        role="presentation"
      />
      <aside className="kanso-drawer" aria-label="Manage boards">
        <header className="kanso-drawer-header">
          <h3 className="kanso-drawer-title">Boards</h3>
          <button type="button" className="kanso-btn" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="kanso-drawer-body">
          <section className="kanso-field">
            <span className="kanso-label">Boards ({boards.length})</span>
            {boards.length === 0 && (
              <p className="kanso-board-state">No boards yet.</p>
            )}
            {boards.map((b) => (
              <BoardRow
                key={b.id}
                board={b}
                onRename={(name) => void rename(b.id, name)}
                onColor={(c) => void setColor(b.id, c)}
                onDelete={() => setPendingDelete(b)}
              />
            ))}
          </section>
        </div>
      </aside>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete board"
        message={
          pendingDelete
            ? `Delete board "${pendingDelete.name}" and all its data? This can't be undone.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}

interface RowProps {
  board: BoardDto;
  onRename: (name: string) => void;
  onColor: (c: string | null) => void;
  onDelete: () => void;
}

function BoardRow({ board, onRename, onColor, onDelete }: RowProps) {
  const [name, setName] = useState(board.name);
  const [lastBoardName, setLastBoardName] = useState(board.name);
  const [showColors, setShowColors] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  if (board.name !== lastBoardName) {
    setLastBoardName(board.name);
    setName(board.name);
  }

  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === board.name) {
      setName(board.name);
      return;
    }
    onRename(trimmed);
  };

  return (
    <div className="kanso-board-row">
      <button
        type="button"
        className="kanso-swatch kanso-swatch--small"
        style={{ backgroundColor: board.color ?? 'transparent' }}
        aria-label="Change color"
        onClick={() => setShowColors((v) => !v)}
      />
      <input
        ref={nameRef}
        className="kanso-board-row-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setName(board.name);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <div className="kanso-board-row-actions">
        <button type="button" className="kanso-btn kanso-btn--danger" onClick={onDelete}>
          Delete
        </button>
      </div>
      {showColors && (
        <div className="kanso-board-row-colors">
          <ColorPicker
            value={board.color}
            onChange={(c) => {
              onColor(c);
              setShowColors(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
