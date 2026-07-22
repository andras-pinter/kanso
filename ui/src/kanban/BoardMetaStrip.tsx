// Slim board-level meta strip: open + overdue counts.
// "Open" = cards not in the Done column. "Overdue" = open cards whose
// due_at is strictly before UTC midnight today (matches DueBadge date-
// only semantics: a card due today is NOT overdue). Uses only data
// already in the store.
//
// `today` refreshes every minute so cards flip to "overdue" the moment
// the local date rolls over, without a manual reload.

import { useEffect, useMemo, useState } from 'react';
import { useKanbanStore } from './hooks/useKanbanStore';

const MINUTE_MS = 60_000;

function startOfTodayUtc(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

export default function BoardMetaStrip() {
  const columns = useKanbanStore((s) => s.columns);
  const cardsByColumn = useKanbanStore((s) => s.cardsByColumn);
  const [today, setToday] = useState(() => startOfTodayUtc());

  useEffect(() => {
    const id = window.setInterval(() => setToday(startOfTodayUtc()), MINUTE_MS);
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
              acc.overdue +
              (card.due_at !== null && card.due_at < today ? 1 : 0),
          }),
          { open: 0, overdue: 0 },
        ),
    [columns, cardsByColumn, today],
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


