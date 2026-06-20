// Single kanban column. The header is the drag handle (when the column is
// live) so the card list inside the body stays free for card drag.

import { useCallback, useEffect, useRef, useState } from 'react';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { CardDto, ColumnDto } from './types';
import Card from './Card';
import AddCardInline from './AddCardInline';
import ColumnHeaderMenu from './ColumnHeaderMenu';
import { columnDragId } from './columnDragEnd';
import { useKanbanStore } from './hooks/useKanbanStore';

interface Props {
  column: ColumnDto;
  cards: CardDto[];
}

export default function Column({ column, cards }: Props) {
  const addCard = useKanbanStore((s) => s.addCard);
  const renameColumn = useKanbanStore((s) => s.renameColumn);
  const unarchiveColumn = useKanbanStore((s) => s.unarchiveColumn);
  const unarchiveCard = useKanbanStore((s) => s.unarchiveCard);
  const showArchived = useKanbanStore((s) => s.showArchived);

  const isArchived = column.archived_at !== null;

  const {
    attributes,
    listeners,
    setNodeRef: setColumnRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: columnDragId(column.id),
    data: { type: 'column-sort', columnId: column.id },
    disabled: isArchived,
  });
  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  const onSubmitCard = useCallback(
    (title: string) => addCard(column.id, title),
    [addCard, column.id],
  );

  // Column body is a droppable so empty-list / end-of-list card drops resolve.
  const { setNodeRef: setBodyRef } = useDroppable({
    id: `column:${column.id}`,
    data: { type: 'column', columnId: column.id },
  });

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(column.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const commitRename = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === column.name) {
      setDraft(column.name);
      setRenaming(false);
      return;
    }
    void renameColumn(column.id, trimmed);
    setRenaming(false);
  };

  const liveCards = cards.filter((c) => c.archived_at === null);
  const archivedCards = cards.filter((c) => c.archived_at !== null);

  const stripeStyle = column.color
    ? { borderTopColor: column.color, borderTopWidth: 3 }
    : undefined;

  return (
    <section
      ref={setColumnRef}
      style={{ ...dragStyle, ...(stripeStyle ?? {}) }}
      className={`kanso-column${isArchived ? ' kanso-column--archived' : ''}${
        isDragging ? ' kanso-column--dragging' : ''
      }`}
      aria-label={column.name}
    >
      <header
        className="kanso-column-header"
        {...attributes}
        {...(isArchived ? {} : listeners)}
      >
        {isArchived && <span className="kanso-eyebrow">Archived</span>}
        {renaming ? (
          <input
            ref={inputRef}
            className="kanso-column-rename"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(column.name);
                setRenaming(false);
              }
            }}
            // Stop pointerdown so the drag listeners don't grab the input
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <h2
            className="kanso-column-name"
            onDoubleClick={() => {
              if (!isArchived) {
                setDraft(column.name);
                setRenaming(true);
              }
            }}
          >
            {column.name}
          </h2>
        )}
        <span className="kanso-column-count">{liveCards.length}</span>
        {isArchived ? (
          <button
            type="button"
            className="kanso-btn"
            onClick={() => void unarchiveColumn(column.id)}
          >
            Unarchive
          </button>
        ) : (
          <ColumnHeaderMenu
            column={column}
            onStartRename={() => {
              setDraft(column.name);
              setRenaming(true);
            }}
          />
        )}
      </header>
      <SortableContext items={liveCards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setBodyRef}
          className={`kanso-cards${liveCards.length === 0 ? ' kanso-cards--empty' : ''}`}
        >
          {liveCards.map((c) => (
            <Card key={c.id} card={c} />
          ))}
        </div>
      </SortableContext>
      {showArchived && archivedCards.length > 0 && (
        <details className="kanso-archived-cards">
          <summary>{archivedCards.length} archived</summary>
          {archivedCards.map((c) => (
            <div key={c.id} className="kanso-archived-card">
              <span className="kanso-archived-card-title">{c.title}</span>
              <button
                type="button"
                className="kanso-btn"
                onClick={() => void unarchiveCard(c.id)}
              >
                Unarchive
              </button>
            </div>
          ))}
        </details>
      )}
      {!isArchived && (
        <footer className="kanso-column-footer">
          <AddCardInline onSubmit={onSubmitCard} />
        </footer>
      )}
    </section>
  );
}
