import { lazy, Suspense, useRef, useState } from 'react';
import { useKanbanStore } from './hooks/useKanbanStore';
import type { CardDto } from './types';

// Lazy boundary: keep ALL @blocksuite/* imports out of the entry chunk.
const CardBodyEditor = lazy(() => import('./CardBodyEditor'));

interface Props {
  card: CardDto;
}

// Parent passes `key={card.id}` so a different selection remounts this
// component — that avoids syncing prop->state in an effect (which the
// react-hooks lint rule disallows) and the drawer always starts fresh.
export default function CardDetailDrawer({ card }: Props) {
  const updateCard = useKanbanStore((s) => s.updateCard);
  const archiveCard = useKanbanStore((s) => s.archiveCard);
  const selectCard = useKanbanStore((s) => s.selectCard);

  const [title, setTitle] = useState(card.title);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);

  const flashSaved = () => {
    setSaved(true);
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1400);
  };

  const onTitleBlur = () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setTitle(card.title);
      return;
    }
    if (trimmed === card.title) return;
    void updateCard(card.id, { title: trimmed }).then(flashSaved);
  };

  const onArchive = () => {
    void archiveCard(card.id);
  };

  const close = () => selectCard(null);

  return (
    <>
      <div
        className="kanso-drawer-backdrop"
        onClick={close}
        aria-hidden="true"
        role="presentation"
      />
      <aside className="kanso-drawer" aria-label="Card detail">
        <header className="kanso-drawer-header">
          <h3 className="kanso-drawer-title">Card</h3>
          <span
            className={`kanso-saved-pill${saved ? ' kanso-saved-pill--visible' : ''}`}
            aria-live="polite"
          >
            Saved
          </span>
          <button type="button" className="kanso-btn" onClick={close}>
            Close
          </button>
        </header>
        <div className="kanso-drawer-body">
          <div className="kanso-field">
            <label className="kanso-label" htmlFor="kanso-card-title">
              Title
            </label>
            <input
              id="kanso-card-title"
              className="kanso-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={onTitleBlur}
            />
          </div>
          <div className="kanso-field">
            <span className="kanso-label">Body</span>
            <Suspense fallback={<div className="kanso-editor-loading">Loading editor…</div>}>
              <CardBodyEditor cardId={card.id} />
            </Suspense>
          </div>
        </div>
        <footer className="kanso-drawer-footer">
          <button type="button" className="kanso-btn kanso-btn--danger" onClick={onArchive}>
            Archive
          </button>
          <span />
        </footer>
      </aside>
    </>
  );
}
