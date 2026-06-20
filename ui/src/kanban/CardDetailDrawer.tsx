import { useRef, useState } from 'react';
import { useKanbanStore } from './hooks/useKanbanStore';
import type { CardDto } from './types';

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
  const [body, setBody] = useState(card.body_text ?? '');
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

  const onBodyBlur = () => {
    const next = body.length === 0 ? null : body;
    if ((card.body_text ?? null) === next) return;
    void updateCard(card.id, { body_text: next }).then(flashSaved);
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
            <label className="kanso-label" htmlFor="kanso-card-body">
              Body
            </label>
            <textarea
              id="kanso-card-body"
              className="kanso-body-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={onBodyBlur}
              placeholder="Notes… (rich editor coming in Phase 2)"
            />
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
