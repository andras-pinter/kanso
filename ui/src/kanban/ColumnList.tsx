import { useKanbanStore } from './hooks/useKanbanStore';
import Column from './Column';

export default function ColumnList() {
  const columns = useKanbanStore((s) => s.columns);
  const cardsByColumn = useKanbanStore((s) => s.cardsByColumn);

  return (
    <div className="kanso-columns">
      {columns.map((col) => (
        <Column key={col.id} column={col} cards={cardsByColumn[col.id] ?? []} />
      ))}
    </div>
  );
}
