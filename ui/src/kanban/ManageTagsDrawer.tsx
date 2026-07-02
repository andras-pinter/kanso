// Right-side drawer for managing tags: rename, archive, delete.
// Mirrors `ManageBoardsDrawer` structure for visual consistency. Tag
// colors are derived from tag.id (see tagChipStyle), so this drawer no
// longer exposes a color picker.

import { useEffect, useRef, useState } from 'react';
import { useKanbanStore } from './hooks/useKanbanStore';
import { tagChipStyle } from './tagChipStyle';
import type { TagDto } from './types';
import { ConfirmDialog, PromptDialog } from '../Dialog';

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
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ tag: TagDto; archived: boolean } | null>(null);

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
          <button type="button" className="kanso-btn" onClick={() => setCreateOpen(true)}>
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
                onArchive={() => void tagArchive(t.id)}
                onDelete={() => setPendingDelete({ tag: t, archived: false })}
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
                  onUnarchive={() => void tagUnarchive(t.id)}
                  onDelete={() => setPendingDelete({ tag: t, archived: true })}
                />
              ))}
          </section>
        </div>
      </aside>
      <PromptDialog
        open={createOpen}
        title="New tag"
        label="Tag name"
        submitLabel="Create"
        onSubmit={(name) => {
          setCreateOpen(false);
          void tagCreate(name);
        }}
        onCancel={() => setCreateOpen(false)}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete tag"
        message={
          pendingDelete
            ? pendingDelete.archived
              ? `Delete tag "${pendingDelete.tag.name}"? This can't be undone.`
              : `Delete tag "${pendingDelete.tag.name}"? This removes it from all cards.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingDelete) void tagDelete(pendingDelete.tag.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}

interface RowProps {
  tag: TagDto;
  archived?: boolean;
  onRename: (name: string) => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onDelete: () => void;
}

function TagRow({
  tag,
  archived = false,
  onRename,
  onArchive,
  onUnarchive,
  onDelete,
}: RowProps) {
  const [name, setName] = useState(tag.name);
  const [lastTagName, setLastTagName] = useState(tag.name);
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
      <span
        className="kanso-tag-chip"
        style={tagChipStyle(tag.id)}
        aria-hidden="true"
        title={tag.name}
      >
        <span className="kanso-tag-chip-name">{tag.name}</span>
      </span>
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
    </div>
  );
}
