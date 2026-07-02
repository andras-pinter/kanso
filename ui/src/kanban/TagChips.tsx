// Read-only chip strip rendered on the card face. Truncates past 3 with a
// "+N" overflow chip so dense cards stay compact.

import { useKanbanStore } from './hooks/useKanbanStore';
import { tagChipStyle } from './tagChipStyle';

interface Props {
  cardId: string;
  max?: number;
}

const DEFAULT_MAX = 3;

export default function TagChips({ cardId, max = DEFAULT_MAX }: Props) {
  const tagIds = useKanbanStore((s) => s.cardTagMap[cardId]);
  const tags = useKanbanStore((s) => s.tags);
  if (!tagIds || tagIds.length === 0) return null;

  const resolved = tagIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t) && t!.archived_at === null);
  if (resolved.length === 0) return null;

  const visible = resolved.slice(0, max);
  const overflow = resolved.length - visible.length;

  return (
    <div className="kanso-card-tags" aria-label="Tags">
      {visible.map((t) => (
        <span key={t.id} className="kanso-tag-chip" title={t.name} style={tagChipStyle(t.id)}>
          <span className="kanso-tag-chip-name">{t.name}</span>
        </span>
      ))}
      {overflow > 0 && (
        <span className="kanso-tag-chip kanso-tag-chip--overflow">+{overflow}</span>
      )}
    </div>
  );
}
