// Slim board-level meta strip: open + overdue counts.
// "Open" = cards not in the Done column. "Overdue" = open cards with
// a due_at strictly in the past. Uses only data already in the store.
//
// `now` ticks once a minute so cards flip to "overdue" without needing
// a manual reload. Kept as state so the memo below stays pure.

import { useEffect, useMemo, useState } from 'react';
import { useKanbanStore } from './hooks/useKanbanStore';

const MINUTE_MS = 60_000;

export default function BoardMetaStrip() {
  const columns = useKanbanStore((s) => s.columns);
  const cardsByColumn = useKanbanStore((s) => s.cardsByColumn);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => window.clearInterval(id);
  }, []);

  const { open, overdue } = useMemo(
    () =>
      columns
        .filter((col) => col.name !== 'Done')
        .flatMap((col) => cardsByColumn[col.id] ?? [])
        .reduce(
          (acc, card) => ({
            open: acc.open + 1,
            overdue:
              acc.overdue + (card.due_at !== null && card.due_at < now ? 1 : 0),
          }),
          { open: 0, overdue: 0 },
        ),
    [columns, cardsByColumn, now],
  );

  if (columns.length === 0) return null;

  return (
    <div className="kanso-board-meta" role="status" aria-live="polite">
      <span className="kanso-board-meta-item">
        <span className="kanso-board-meta-num">{open}</span> open
      </span>
      {overdue > 0 && (
        <span className="kanso-board-meta-item kanso-board-meta-item--warn">
          <span className="kanso-board-meta-num">{overdue}</span> overdue
        </span>
      )}
    </div>
  );
}

