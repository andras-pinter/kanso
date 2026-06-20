import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CardDto } from './types';
import { useKanbanStore } from './hooks/useKanbanStore';
import TagChips from './TagChips';
import DueBadge from './DueBadge';

interface Props {
  card: CardDto;
}

export default function Card({ card }: Props) {
  const selectCard = useKanbanStore((s) => s.selectCard);
  const selected = useKanbanStore((s) => s.selectedCardId === card.id);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', columnId: card.column_id },
  });

  const firstBodyLine = card.body_text?.split('\n').find((l) => l.trim().length > 0);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const cls = [
    'kanso-card',
    isDragging ? 'kanso-card--dragging' : '',
    selected ? 'kanso-card--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cls}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Suppress click triggered at drag-end (no movement = click).
        if (isDragging) return;
        e.stopPropagation();
        selectCard(card.id);
      }}
    >
      <div className="kanso-card-title">{card.title}</div>
      {firstBodyLine && <div className="kanso-card-body">{firstBodyLine}</div>}
      <TagChips cardId={card.id} />
      {card.due_at !== null && card.due_at !== undefined && <DueBadge dueAt={card.due_at} />}
    </div>
  );
}

// Visual-only twin used inside <DragOverlay>. Doesn't subscribe to
// useSortable — overlay manages its own transform/positioning.
export function CardOverlay({ card }: Props) {
  const firstBodyLine = card.body_text?.split('\n').find((l) => l.trim().length > 0);
  return (
    <div className="kanso-card kanso-card--overlay">
      <div className="kanso-card-title">{card.title}</div>
      {firstBodyLine && <div className="kanso-card-body">{firstBodyLine}</div>}
      <TagChips cardId={card.id} />
      {card.due_at !== null && card.due_at !== undefined && <DueBadge dueAt={card.due_at} />}
    </div>
  );
}
