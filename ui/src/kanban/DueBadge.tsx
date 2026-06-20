// Small due-date badge for the card face. Renders "Today" / "Tomorrow" for
// near dates and goes red when overdue. Date-only semantics: due_at is a
// UTC midnight millis value, and the overdue check uses UTC midnight today
// so the same date renders the same label everywhere.

interface Props {
  dueAt: number;
}

function startOfTodayUtc(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatLabel(dueAt: number): string {
  const today = startOfTodayUtc();
  const diffDays = Math.round((dueAt - today) / DAY_MS);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  const d = new Date(dueAt);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default function DueBadge({ dueAt }: Props) {
  const overdue = dueAt < startOfTodayUtc();
  const cls = overdue ? 'kanso-due-badge kanso-due-badge--overdue' : 'kanso-due-badge';
  const label = formatLabel(dueAt);
  const title = new Date(dueAt).toLocaleDateString(undefined, { timeZone: 'UTC' });
  return (
    <span className={cls} title={title} aria-label={`Due ${label}`}>
      📅 {label}
    </span>
  );
}
