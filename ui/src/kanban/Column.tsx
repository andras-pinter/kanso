import { useCallback } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import type { CardDto, ColumnDto } from './types';
import Card from './Card';
import AddCardInline from './AddCardInline';
import { useKanbanStore } from './hooks/useKanbanStore';

interface Props {
  column: ColumnDto;
  cards: CardDto[];
}

export default function Column({ column, cards }: Props) {
  const addCard = useKanbanStore((s) => s.addCard);

  const onSubmit = useCallback(
    (title: string) => addCard(column.id, title),
    [addCard, column.id],
  );

  // Column itself is a droppable so empty-list / end-of-list drops resolve.
  const { setNodeRef } = useDroppable({
    id: `column:${column.id}`,
    data: { type: 'column', columnId: column.id },
  });

  return (
    <section className="kanso-column" aria-label={column.name}>
      <header className="kanso-column-header">
        <h2 className="kanso-column-name">{column.name}</h2>
        <span className="kanso-column-count">{cards.length}</span>
      </header>
      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`kanso-cards${cards.length === 0 ? ' kanso-cards--empty' : ''}`}
        >
          {cards.map((c) => (
            <Card key={c.id} card={c} />
          ))}
        </div>
      </SortableContext>
      <footer className="kanso-column-footer">
        <AddCardInline onSubmit={onSubmit} />
      </footer>
    </section>
  );
}
