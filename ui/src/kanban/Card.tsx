import { GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CardListDto } from './types';
import { useKanbanStore } from './hooks/useKanbanStore';
import TagChips from './TagChips';

interface Props {
  card: CardListDto;
}

// Phase 1: the card face carries content only — title, tag chips, and a
// subtle "has notes" dot. The body text and any due-date affordance live
// inside the card modal, not on the face.
export default function Card({ card }: Props) {
  const selectCard = useKanbanStore((s) => s.selectCard);
  const selected = useKanbanStore((s) => s.selectedCardId === card.id);
  const columnColor = useKanbanStore(
    (s) => s.columns.find((c) => c.id === card.column_id)?.color ?? null,
  );
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', columnId: card.column_id },
  });

  const hasBody = card.has_body;

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

  const { onKeyDown: dndKeyDown, ...dragListeners } = listeners ?? {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cls}
      data-card-id={card.id}
      {...attributes}
      {...dragListeners}
      tabIndex={0}
      role="button"
      aria-roledescription="Draggable card"
      aria-label={card.title}
      aria-keyshortcuts="Space Enter Escape"
      onClick={(e) => {
        if (isDragging) return;
        e.stopPropagation();
        selectCard(card.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          selectCard(card.id);
          return;
        }
        // Hand everything else (Space-to-drag, arrows) to dnd-kit.
        dndKeyDown?.(e);
      }}
    >
      <GripVertical
        size={14}
        aria-hidden="true"
        className="kanso-card-grip"
      />
      {columnColor && (
        <span
          className="kanso-card-status-dot"
          style={{ backgroundColor: columnColor }}
          aria-hidden="true"
        />
      )}
      <div className="kanso-card-title">
        {card.title}
        {hasBody && (
          <span
            className="kanso-card-has-body"
            aria-label="Has notes"
            title="Has notes"
          />
        )}
      </div>
      <TagChips cardId={card.id} />
    </div>
  );
}

// Visual-only twin used inside <DragOverlay>. Doesn't subscribe to
// useSortable — overlay manages its own transform/positioning.
export function CardOverlay({ card }: Props) {
  const hasBody = card.has_body;
  const columnColor = useKanbanStore(
    (s) => s.columns.find((c) => c.id === card.column_id)?.color ?? null,
  );
  return (
    <div className="kanso-card kanso-card--overlay">
      {columnColor && (
        <span
          className="kanso-card-status-dot"
          style={{ backgroundColor: columnColor }}
          aria-hidden="true"
        />
      )}
      <div className="kanso-card-title">
        {card.title}
        {hasBody && (
          <span
            className="kanso-card-has-body"
            aria-label="Has notes"
            title="Has notes"
          />
        )}
      </div>
      <TagChips cardId={card.id} />
    </div>
  );
}
