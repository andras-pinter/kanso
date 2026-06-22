// Quick-add card surface: title + board + column → cardCreate → close.
// Mounted in KanbanBoard, opened by ⌘⇧K, tray menu, or button.

import { useEffect, useMemo, useRef, useState } from 'react';
import { cardCreate, columnsList } from '../kanban/api/client';
import { useKanbanStore } from '../kanban/hooks/useKanbanStore';
import type { ColumnDto } from '../kanban/types';

interface Props {
  onClose: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function QuickAddModal({ onClose }: Props) {
  const boards = useKanbanStore((s) => s.boards);
  const currentBoardId = useKanbanStore((s) => s.currentBoardId);
  const storeColumns = useKanbanStore((s) => s.columns);
  const addCard = useKanbanStore((s) => s.addCard);

  const liveBoards = useMemo(
    () => boards.filter((b) => b.archived_at === null),
    [boards],
  );

  const defaultBoardId = useMemo(() => {
    if (currentBoardId && liveBoards.some((b) => b.id === currentBoardId)) {
      return currentBoardId;
    }
    return liveBoards[0]?.id ?? '';
  }, [currentBoardId, liveBoards]);

  const [boardId, setBoardId] = useState(defaultBoardId);
  // Columns fetched for a board that isn't the current store board. Empty
  // when the current store board is selected (we derive from `storeColumns`).
  const [fetchedColumns, setFetchedColumns] = useState<ColumnDto[]>([]);
  const [fetchedColumnsBoardId, setFetchedColumnsBoardId] = useState<string | null>(null);
  const [columnId, setColumnId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  // Columns to render: live store columns when the chosen board matches the
  // current store board, otherwise whatever the fetch effect produced.
  const columns = useMemo<ColumnDto[]>(() => {
    if (!boardId) return [];
    if (boardId === currentBoardId) {
      return storeColumns.filter((c) => c.archived_at === null);
    }
    return boardId === fetchedColumnsBoardId ? fetchedColumns : [];
  }, [boardId, currentBoardId, storeColumns, fetchedColumns, fetchedColumnsBoardId]);

  // Keep columnId in sync with the available columns. Selection survives if
  // the previously-chosen column still exists in the new list. Adjusting
  // state during render (vs. in an effect) is the recommended pattern when
  // state depends on derived data.
  const desiredColumnId = columns.some((c) => c.id === columnId)
    ? columnId
    : columns[0]?.id ?? '';
  if (desiredColumnId !== columnId) {
    setColumnId(desiredColumnId);
  }

  // Fetch columns for foreign boards. No-op when the chosen board matches
  // the store's current board (derived synchronously above).
  useEffect(() => {
    if (!boardId || boardId === currentBoardId) return;
    let alive = true;
    void columnsList(boardId, false)
      .then((cols) => {
        if (!alive) return;
        setFetchedColumns(cols);
        setFetchedColumnsBoardId(boardId);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setErr(formatError(e));
      });
    return () => {
      alive = false;
    };
  }, [boardId, currentBoardId]);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = modalRef.current;
    if (!root) return;
    const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => !el.hasAttribute('disabled'),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || !columnId || submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      // For the current board, route through the store so the column
      // optimistically gains the new card. For other boards, write directly —
      // the user isn't looking at them so there's no UI to update.
      if (boardId === currentBoardId) {
        await addCard(columnId, trimmed);
      } else {
        await cardCreate(columnId, trimmed);
      }
      onClose();
    } catch (e2) {
      setErr(formatError(e2));
      setSubmitting(false);
    }
  };

  const disabled =
    submitting || title.trim().length === 0 || columnId === '' || boardId === '';

  return (
    <div className="kanso-modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={modalRef}
        className="kanso-modal kanso-quick-add"
        role="dialog"
        aria-modal="true"
        aria-label="Quick add card"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="kanso-modal-header">
          <h3 className="kanso-modal-title">Quick add</h3>
          <button type="button" className="kanso-btn" onClick={onClose}>
            Close
          </button>
        </header>
        <form className="kanso-modal-body" onSubmit={onSubmit}>
          {liveBoards.length === 0 ? (
            <p className="kanso-board-state">No boards yet — create one first.</p>
          ) : (
            <>
              <div className="kanso-field">
                <label className="kanso-label" htmlFor="kanso-quick-add-title">
                  Title
                </label>
                <input
                  id="kanso-quick-add-title"
                  ref={titleRef}
                  className="kanso-title-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What needs doing?"
                  autoComplete="off"
                />
              </div>
              <div className="kanso-field">
                <label className="kanso-label" htmlFor="kanso-quick-add-board">
                  Board
                </label>
                <select
                  id="kanso-quick-add-board"
                  className="kanso-select"
                  value={boardId}
                  onChange={(e) => setBoardId(e.target.value)}
                >
                  {liveBoards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="kanso-field">
                <label className="kanso-label" htmlFor="kanso-quick-add-column">
                  Column
                </label>
                <select
                  id="kanso-quick-add-column"
                  className="kanso-select"
                  value={columnId}
                  onChange={(e) => setColumnId(e.target.value)}
                  disabled={columns.length === 0}
                >
                  {columns.length === 0 ? (
                    <option value="">(no columns)</option>
                  ) : (
                    columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              {err && (
                <p className="kanso-modal-error" role="alert">
                  {err}
                </p>
              )}
              <div className="kanso-modal-footer">
                <span />
                <button
                  type="submit"
                  className="kanso-btn kanso-btn--primary"
                  disabled={disabled}
                >
                  Add card
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Failed to add card';
}
