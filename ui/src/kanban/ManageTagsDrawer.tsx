// Right-side drawer for managing tags: rename, recolor, archive, delete.
// Mirrors `ManageBoardsDrawer` structure for visual consistency.

import { useEffect, useRef, useState } from 'react';
import ColorPicker from './ColorPicker';
import { useKanbanStore } from './hooks/useKanbanStore';
import type { TagDto } from './types';

interface Props {
  onClose: () => void;
}

export default function ManageTagsDrawer({ onClose }: Props) {
  const tags = useKanbanStore((s) => s.tags);
  const tagsLoaded = useKanbanStore((s) => s.tagsLoaded);
  const loadTags = useKanbanStore((s) => s.loadTags);
  const tagUpdate = useKanbanStore((s) => s.tagUpdate);
  const tagArchive = useKanbanStore((s) => s.tagArchive);
  const tagUnarchive = useKanbanStore((s) => s.tagUnarchive);
  const tagDelete = useKanbanStore((s) => s.tagDelete);
  const tagCreate = useKanbanStore((s) => s.tagCreate);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (!tagsLoaded) void loadTags();
  }, [tagsLoaded, loadTags]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const live = tags.filter((t) => t.archived_at === null);
  const archived = tags.filter((t) => t.archived_at !== null);

  const onCreate = () => {
    const name = window.prompt('Tag name');
    if (name && name.trim()) void tagCreate(name.trim());
  };

  return (
    <>
      <div
        className="kanso-drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
        role="presentation"
      />
      <aside className="kanso-drawer" aria-label="Manage tags">
        <header className="kanso-drawer-header">
          <h3 className="kanso-drawer-title">Tags</h3>
          <button type="button" className="kanso-btn" onClick={onCreate}>
            + New
          </button>
          <button type="button" className="kanso-btn" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="kanso-drawer-body">
          <section className="kanso-field">
            <span className="kanso-label">Live ({live.length})</span>
            {live.length === 0 && <p className="kanso-board-state">No live tags.</p>}
            {live.map((t) => (
              <TagRow
                key={t.id}
                tag={t}
                onRename={(name) => void tagUpdate(t.id, { name })}
                onColor={(c) => void tagUpdate(t.id, { color: c })}
                onArchive={() => void tagArchive(t.id)}
                onDelete={() => {
                  if (window.confirm(`Delete tag "${t.name}"? This removes it from all cards.`)) {
                    void tagDelete(t.id);
                  }
                }}
              />
            ))}
          </section>
          <section className="kanso-field">
            <button
              type="button"
              className="kanso-btn"
              onClick={() => setShowArchived((v) => !v)}
              aria-expanded={showArchived}
            >
              {showArchived ? '▾' : '▸'} Archived ({archived.length})
            </button>
            {showArchived &&
              archived.map((t) => (
                <TagRow
                  key={t.id}
                  tag={t}
                  archived
                  onRename={(name) => void tagUpdate(t.id, { name })}
                  onColor={(c) => void tagUpdate(t.id, { color: c })}
                  onUnarchive={() => void tagUnarchive(t.id)}
                  onDelete={() => {
                    if (window.confirm(`Delete tag "${t.name}"? This can't be undone.`)) {
                      void tagDelete(t.id);
                    }
                  }}
                />
              ))}
          </section>
        </div>
      </aside>
    </>
  );
}

interface RowProps {
  tag: TagDto;
  archived?: boolean;
  onRename: (name: string) => void;
  onColor: (c: string | null) => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onDelete: () => void;
}

function TagRow({
  tag,
  archived = false,
  onRename,
  onColor,
  onArchive,
  onUnarchive,
  onDelete,
}: RowProps) {
  const [name, setName] = useState(tag.name);
  const [lastTagName, setLastTagName] = useState(tag.name);
  const [showColors, setShowColors] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  if (tag.name !== lastTagName) {
    setLastTagName(tag.name);
    setName(tag.name);
  }

  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === tag.name) {
      setName(tag.name);
      return;
    }
    onRename(trimmed);
  };

  return (
    <div className={`kanso-board-row${archived ? ' kanso-board-row--archived' : ''}`}>
      <button
        type="button"
        className="kanso-swatch kanso-swatch--small"
        style={{ backgroundColor: tag.color ?? 'transparent' }}
        aria-label="Change color"
        onClick={() => setShowColors((v) => !v)}
      />
      <input
        ref={nameRef}
        className="kanso-board-row-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setName(tag.name);
            (e.target as HTMLInputElement).blur();
          }
        }}
        disabled={archived}
      />
      <div className="kanso-board-row-actions">
        {archived ? (
          <button type="button" className="kanso-btn" onClick={onUnarchive}>
            Unarchive
          </button>
        ) : (
          <button type="button" className="kanso-btn" onClick={onArchive}>
            Archive
          </button>
        )}
        <button type="button" className="kanso-btn kanso-btn--danger" onClick={onDelete}>
          Delete
        </button>
      </div>
      {showColors && (
        <div className="kanso-board-row-colors">
          <ColorPicker
            value={tag.color}
            onChange={(c) => {
              onColor(c);
              setShowColors(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
