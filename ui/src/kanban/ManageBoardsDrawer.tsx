// Right-side drawer for managing boards: rename, recolor, archive, delete.
// Shares the `.kanso-drawer` chrome with `ManageTagsDrawer`. Archived
// boards are shown under a toggleable section.

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
  const archive = useKanbanStore((s) => s.boardArchive);
  const unarchive = useKanbanStore((s) => s.boardUnarchive);
  const remove = useKanbanStore((s) => s.boardDelete);
  const [showArchived, setShowArchived] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BoardDto | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const live = boards.filter((b) => b.archived_at === null);
  const archived = boards.filter((b) => b.archived_at !== null);

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
            <span className="kanso-label">Live ({live.length})</span>
            {live.length === 0 && (
              <p className="kanso-board-state">No live boards.</p>
            )}
            {live.map((b) => (
              <BoardRow
                key={b.id}
                board={b}
                onRename={(name) => void rename(b.id, name)}
                onColor={(c) => void setColor(b.id, c)}
                onArchive={() => void archive(b.id)}
                onDelete={() => setPendingDelete(b)}
              />
            ))}
          </section>
          <section className="kanso-field">
            <button
              type="button"
              className="kanso-btn"
              onClick={() => setShowArchived((v) => !v)}
              aria-expanded={showArchived}
            >
              {showArchived ? '▾' : '▸'} Archived ({archived.length})
            </button>
            {showArchived &&
              archived.map((b) => (
                <BoardRow
                  key={b.id}
                  board={b}
                  archived
                  onRename={(name) => void rename(b.id, name)}
                  onColor={(c) => void setColor(b.id, c)}
                  onUnarchive={() => void unarchive(b.id)}
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
  archived?: boolean;
  onRename: (name: string) => void;
  onColor: (c: string | null) => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onDelete: () => void;
}

function BoardRow({
  board,
  archived = false,
  onRename,
  onColor,
  onArchive,
  onUnarchive,
  onDelete,
}: RowProps) {
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
    <div className={`kanso-board-row${archived ? ' kanso-board-row--archived' : ''}`}>
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
        disabled={archived}
      />
      <div className="kanso-board-row-actions">
        {archived ? (
          <button type="button" className="kanso-btn" onClick={onUnarchive}>
            Unarchive
          </button>
        ) : (
          <button type="button" className="kanso-btn" onClick={onArchive}>
            Archive
          </button>
        )}
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
