// Popover for adding/removing tags on a single card. Renders the current
// tag chips inline (removable) and a "+ Add tag" trigger that opens a
// typeahead list. Archived tags are hidden from the picker — the backend
// rejects linking an archived tag with a 400, so the inline-create path
// uses the same `tagCreate` action and auto-links the result.

import { useEffect, useMemo, useRef, useState } from 'react';
import ColorPicker from './ColorPicker';
import { useKanbanStore } from './hooks/useKanbanStore';
import type { TagDto } from './types';

interface Props {
  cardId: string;
}

// Stable reference for cards that have no tags yet. Returning a fresh
// `[]` from a Zustand 5 selector would fail its strict-equality check
// and trigger a re-render loop -> "Maximum update depth exceeded" ->
// uncaught throw -> the whole app blanks (Wave 8b hot-fix).
const EMPTY_TAG_IDS: readonly string[] = [];

export default function TagPickerPopover({ cardId }: Props) {
  const tags = useKanbanStore((s) => s.tags);
  const tagsLoaded = useKanbanStore((s) => s.tagsLoaded);
  const loadTags = useKanbanStore((s) => s.loadTags);
  const addCardTag = useKanbanStore((s) => s.addCardTag);
  const removeCardTag = useKanbanStore((s) => s.removeCardTag);
  const createTag = useKanbanStore((s) => s.tagCreate);
  // Subscribe to the top-level cardTagMap reference (stable until any
  // tag link changes) and look up this card outside the selector so the
  // selector never has to mint a fresh fallback array. Returning a fresh
  // `?? []` from the selector tripped Zustand 5's strict-equality check
  // and triggered an infinite re-render loop -> blank app (Wave 8b).
  const cardTagMap = useKanbanStore((s) => s.cardTagMap);
  const cardTagIds = cardTagMap[cardId] ?? EMPTY_TAG_IDS;

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [creatingName, setCreatingName] = useState<string | null>(null);
  const [newColor, setNewColor] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!tagsLoaded) void loadTags();
  }, [tagsLoaded, loadTags]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const liveTags = useMemo(() => tags.filter((t) => t.archived_at === null), [tags]);

  const currentTags = useMemo(
    () =>
      cardTagIds
        .map((id) => tags.find((t) => t.id === id))
        .filter((t): t is TagDto => Boolean(t)),
    [cardTagIds, tags],
  );

  const filterLower = filter.trim().toLowerCase();
  const available = liveTags.filter(
    (t) =>
      !cardTagIds.includes(t.id) &&
      (filterLower === '' || t.name.toLowerCase().includes(filterLower)),
  );
  const exactMatch = liveTags.some((t) => t.name.toLowerCase() === filterLower);
  const showCreate = filterLower.length > 0 && !exactMatch;

  const onCreate = async () => {
    const name = creatingName ?? filter.trim();
    if (!name) return;
    const created = await createTag(name, newColor);
    if (created) {
      await addCardTag(cardId, created.id);
    }
    setCreatingName(null);
    setNewColor(null);
    setFilter('');
  };

  return (
    <div className="kanso-tag-picker">
      <div className="kanso-tag-chip-row" aria-label="Card tags">
        {currentTags.map((t) => (
          <span key={t.id} className="kanso-tag-chip kanso-tag-chip--removable">
            <span
              className="kanso-tag-dot"
              style={{ backgroundColor: t.color ?? 'var(--text-muted)' }}
              aria-hidden="true"
            />
            <span className="kanso-tag-chip-name">{t.name}</span>
            <button
              type="button"
              className="kanso-tag-chip-remove"
              aria-label={`Remove ${t.name}`}
              onClick={() => void removeCardTag(cardId, t.id)}
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          className="kanso-tag-add-btn"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          + Add tag
        </button>
      </div>
      {open && (
        <div ref={popoverRef} className="kanso-tag-popover" role="dialog" aria-label="Add tag">
          {creatingName !== null ? (
            <div className="kanso-tag-create">
              <input
                className="kanso-tag-filter"
                value={creatingName}
                onChange={(e) => setCreatingName(e.target.value)}
                placeholder="Tag name"
                autoFocus
              />
              <ColorPicker value={newColor} onChange={setNewColor} />
              <div className="kanso-tag-create-actions">
                <button type="button" className="kanso-btn" onClick={() => setCreatingName(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="kanso-btn kanso-btn--primary"
                  onClick={() => void onCreate()}
                >
                  Create
                </button>
              </div>
            </div>
          ) : (
            <>
              <input
                className="kanso-tag-filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter tags…"
                autoFocus
                aria-label="Filter tags"
              />
              <ul className="kanso-tag-list" role="listbox">
                {available.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="kanso-tag-list-item"
                      onClick={() => {
                        void addCardTag(cardId, t.id);
                        setFilter('');
                      }}
                    >
                      <span
                        className="kanso-tag-dot"
                        style={{ backgroundColor: t.color ?? 'var(--text-muted)' }}
                        aria-hidden="true"
                      />
                      <span>{t.name}</span>
                    </button>
                  </li>
                ))}
                {available.length === 0 && !showCreate && (
                  <li className="kanso-tag-empty">No matching tags.</li>
                )}
              </ul>
              {showCreate && (
                <button
                  type="button"
                  className="kanso-tag-create-trigger"
                  onClick={() => {
                    setCreatingName(filter.trim());
                    setNewColor(null);
                  }}
                >
                  ⊕ Create &quot;{filter.trim()}&quot;
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
