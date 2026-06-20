// Native <input type="date"> wired through the store. Stores the picked
// day as start-of-day in the local TZ, matching the badge logic.

import { useKanbanStore } from './hooks/useKanbanStore';
import type { CardDto } from './types';

interface Props {
  card: CardDto;
}

function millisToInputValue(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '';
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function inputValueToMillis(v: string): number | null {
  if (!v) return null;
  const [y, m, d] = v.split('-').map((x) => Number.parseInt(x, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

export default function DueDateEditor({ card }: Props) {
  const updateCard = useKanbanStore((s) => s.updateCard);
  const value = millisToInputValue(card.due_at);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const ms = inputValueToMillis(e.target.value);
    void updateCard(card.id, { due_at: ms });
  };

  const onClear = () => {
    void updateCard(card.id, { due_at: null });
  };

  return (
    <div className="kanso-due-editor">
      <input
        type="date"
        className="kanso-due-input"
        value={value}
        onChange={onChange}
        aria-label="Due date"
      />
      {card.due_at !== null && card.due_at !== undefined && (
        <button type="button" className="kanso-btn" onClick={onClear}>
          Clear
        </button>
      )}
    </div>
  );
}
