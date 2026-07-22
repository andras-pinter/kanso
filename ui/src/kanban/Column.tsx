// Single kanban column. Fixed order + fixed name — the header just shows
// a color dot, the name, and a card count. The body is a droppable so
// cards can be moved between columns.

import { useCallback, useRef, useState } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import type { CardListDto, ColumnDto } from './types';
import Card from './Card';
import AddCardInline from './AddCardInline';
import { useKanbanStore } from './hooks/useKanbanStore';

interface Props {
  column: ColumnDto;
  cards: CardListDto[];
}

export default function Column({ column, cards }: Props) {
  const addCard = useKanbanStore((s) => s.addCard);
  const selectedTagIds = useKanbanStore((s) => s.selectedTagIds);
  const cardTagMap = useKanbanStore((s) => s.cardTagMap);
  const [adding, setAdding] = useState(false);

  const addBtnRef = useRef<HTMLButtonElement | null>(null);

  const closeAdd = useCallback(() => {
    setAdding(false);
    // Return focus to the trigger so keyboard flow doesn't fall to <body>.
    queueMicrotask(() => addBtnRef.current?.focus());
  }, []);

  const onSubmitCard = useCallback(
    (title: string) => addCard(column.id, title),
    [addCard, column.id],
  );

  const { setNodeRef: setBodyRef } = useDroppable({
    id: `column:${column.id}`,
    data: { type: 'column', columnId: column.id },
  });

  const filterActive = selectedTagIds.length > 0;
  const visibleCards = filterActive
    ? cards.filter((c) => {
        const tagIds = cardTagMap[c.id] ?? [];
        return selectedTagIds.every((tid) => tagIds.includes(tid));
      })
    : cards;
  const hiddenByFilter = filterActive && cards.length > 0 && visibleCards.length === 0;
  const trulyEmpty = cards.length === 0;

  return (
    <section
      className="kanso-column"
      aria-label={column.name}
    >
      <header className="kanso-column-header">
        <div className="kanso-column-title">
          {column.color && (
            <span
              className="kanso-column-dot"
              style={{ backgroundColor: column.color }}
              aria-hidden="true"
            />
          )}
          <h2 className="kanso-column-name">{column.name}</h2>
          <span
            className={`kanso-column-count${
              visibleCards.length === 0 ? ' kanso-column-count--empty' : ''
            }`}
          >
            {visibleCards.length}
          </span>
        </div>
        <button
          ref={addBtnRef}
          type="button"
          className="kanso-column-add-btn"
          data-column-add={column.id}
          aria-label={`Add task to ${column.name}`}
          title="Add task"
          onClick={() => setAdding(true)}
        >
          ＋
        </button>
      </header>
      {adding && (
        <div className="kanso-column-add-slot">
          <AddCardInline
            open={adding}
            onClose={closeAdd}
            onSubmit={onSubmitCard}
          />
        </div>
      )}
      <SortableContext
        items={visibleCards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setBodyRef}
          className={`kanso-cards${visibleCards.length === 0 ? ' kanso-cards--empty' : ''}`}
        >
          {visibleCards.map((c) => (
            <Card key={c.id} card={c} />
          ))}
          {trulyEmpty && !adding && <p className="kanso-column-empty">No cards yet</p>}
          {hiddenByFilter && (
            <p className="kanso-column-empty-filter">No cards match this filter</p>
          )}
        </div>
      </SortableContext>
    </section>
  );
}
