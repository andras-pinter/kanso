// Chip-picker toolbar above the columns. Multi-select AND filter: a card
// is only visible when it carries every selected tag. Filter state lives in
// the store (`selectedTagIds`) and is not persisted across app restarts.

import { useKanbanStore } from './hooks/useKanbanStore';
import { tagChipStyle } from './tagChipStyle';

export default function BoardFilterBar() {
  const tags = useKanbanStore((s) => s.tags);
  const selectedTagIds = useKanbanStore((s) => s.selectedTagIds);
  const toggleTagFilter = useKanbanStore((s) => s.toggleTagFilter);
  const clearTagFilters = useKanbanStore((s) => s.clearTagFilters);

  const liveTags = tags.filter((t) => t.archived_at === null);
  if (liveTags.length === 0) return null;

  const hasFilter = selectedTagIds.length > 0;

  return (
    <nav className="kanso-filter-bar" aria-label="Filter cards by tag">
      <div className="kanso-filter-chips" role="group" aria-label="Tag filter">
        {liveTags.map((t) => {
          const pressed = selectedTagIds.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={pressed}
              className={`kanso-tag-chip kanso-tag-chip--filter${
                pressed ? ' kanso-tag-chip--selected' : ''
              }`}
              style={tagChipStyle(t.id)}
              onClick={() => toggleTagFilter(t.id)}
              title={t.name}
            >
              <span className="kanso-tag-chip-name">{t.name}</span>
            </button>
          );
        })}
      </div>
      {hasFilter && (
        <button
          type="button"
          className="kanso-btn kanso-btn--ghost kanso-filter-clear"
          onClick={clearTagFilters}
        >
          Clear filter
        </button>
      )}
    </nav>
  );
}
