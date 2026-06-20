import {
  SortableContext,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useKanbanStore } from './hooks/useKanbanStore';
import Column from './Column';
import AddColumnTile from './AddColumnTile';
import { columnDragId } from './columnDragEnd';

export default function ColumnList() {
  const columns = useKanbanStore((s) => s.columns);
  const cardsByColumn = useKanbanStore((s) => s.cardsByColumn);

  const liveColumns = columns.filter((c) => c.archived_at === null);
  const archivedColumns = columns.filter((c) => c.archived_at !== null);

  return (
    <div className="kanso-columns">
      <SortableContext
        items={liveColumns.map((c) => columnDragId(c.id))}
        strategy={horizontalListSortingStrategy}
      >
        {liveColumns.map((col) => (
          <Column key={col.id} column={col} cards={cardsByColumn[col.id] ?? []} />
        ))}
      </SortableContext>
      {archivedColumns.map((col) => (
        <Column key={col.id} column={col} cards={cardsByColumn[col.id] ?? []} />
      ))}
      <AddColumnTile />
    </div>
  );
}
