// Quick-add card surface. Always targets the current board's Incoming
// column. Opened by ⌘N, tray menu, or the toolbar button. Two states:
// title + submitting + err. No board or column selectors.

import { useEffect, useMemo, useRef, useState } from 'react';
import { cardCreate, columnsList } from '../kanban/api/client';
import { useKanbanStore } from '../kanban/hooks/useKanbanStore';
import type { ColumnDto } from '../kanban/types';

interface Props {
  onClose: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const INCOMING = 'incoming';

function findIncoming(cols: readonly ColumnDto[]): ColumnDto | null {
  return cols.find((c) => c.name.trim().toLowerCase() === INCOMING) ?? null;
}

export default function QuickAddModal({ onClose }: Props) {
  const boards = useKanbanStore((s) => s.boards);
  const currentBoardId = useKanbanStore((s) => s.currentBoardId);
  const storeColumns = useKanbanStore((s) => s.columns);
  const addCard = useKanbanStore((s) => s.addCard);

  const targetBoard = useMemo(() => {
    if (currentBoardId) {
      const hit = boards.find((b) => b.id === currentBoardId);
      if (hit) return hit;
    }
    return boards[0] ?? null;
  }, [currentBoardId, boards]);

  // For the current board we already have columns in the store. For a
  // fallback board (e.g. currentBoardId cleared) we lazy-fetch once.
  const [fetchedColumns, setFetchedColumns] = useState<ColumnDto[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const columnsForTarget = useMemo<ColumnDto[] | null>(() => {
    if (!targetBoard) return null;
    if (targetBoard.id === currentBoardId) return storeColumns;
    return fetchedColumns;
  }, [targetBoard, currentBoardId, storeColumns, fetchedColumns]);

  useEffect(() => {
    if (!targetBoard) return;
    if (targetBoard.id === currentBoardId) return;
    let alive = true;
    void columnsList(targetBoard.id)
      .then((cols) => {
        if (!alive) return;
        setFetchedColumns(cols);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setFetchError(formatError(e));
      });
    return () => {
      alive = false;
    };
  }, [targetBoard, currentBoardId]);

  const incoming = useMemo(
    () => (columnsForTarget ? findIncoming(columnsForTarget) : null),
    [columnsForTarget],
  );

  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

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
    if (!trimmed || !targetBoard || !incoming || submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      if (targetBoard.id === currentBoardId) {
        await addCard(incoming.id, trimmed);
      } else {
        await cardCreate(incoming.id, trimmed);
      }
      onClose();
    } catch (e2) {
      setErr(formatError(e2));
      setSubmitting(false);
    }
  };

  const noBoard = !targetBoard;
  const columnsMissing = !!targetBoard && !!columnsForTarget && !incoming;
  const targetLabel = targetBoard ? `Adding to: ${targetBoard.name} · Incoming` : null;
  const stateError = noBoard
    ? 'No boards yet — create one first.'
    : columnsMissing
      ? 'No Incoming column found on this board.'
      : fetchError;
  const disabled =
    submitting || title.trim().length === 0 || !incoming || !!stateError;

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
          {targetLabel && (
            <p className="kanso-quick-add-target" aria-live="polite">
              {targetLabel}
            </p>
          )}
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
              disabled={!!stateError}
            />
          </div>
          {stateError && (
            <p className="kanso-modal-error" role="alert">
              {stateError}
            </p>
          )}
          {err && !stateError && (
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
