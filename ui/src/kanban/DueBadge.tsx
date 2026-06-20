// Small due-date badge for the card face. Renders "Today" / "Tomorrow" for
// near dates and goes red when overdue.

interface Props {
  dueAt: number;
}

function startOfToday(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatLabel(dueAt: number): string {
  const today = startOfToday();
  const diffDays = Math.round((dueAt - today) / DAY_MS);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  const d = new Date(dueAt);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function DueBadge({ dueAt }: Props) {
  const overdue = dueAt < startOfToday();
  const cls = overdue ? 'kanso-due-badge kanso-due-badge--overdue' : 'kanso-due-badge';
  const label = formatLabel(dueAt);
  return (
    <span className={cls} title={new Date(dueAt).toLocaleDateString()} aria-label={`Due ${label}`}>
      📅 {label}
    </span>
  );
}
