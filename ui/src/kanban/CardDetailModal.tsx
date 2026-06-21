import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useKanbanStore } from './hooks/useKanbanStore';
import type { CardDto } from './types';
import type { CardBodyEditorHandle } from './CardBodyEditor';
import TagPickerPopover from './TagPickerPopover';
import DueDateEditor from './DueDateEditor';

// Lazy boundary: keep ALL @blocksuite/* imports out of the entry chunk.
const CardBodyEditor = lazy(() => import('./CardBodyEditor'));

interface Props {
  card: CardDto;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Parent passes `key={card.id}` so a different selection remounts this
// component — that avoids syncing prop->state in an effect (which the
// react-hooks lint rule disallows) and the modal always starts fresh.
export default function CardDetailModal({ card }: Props) {
  const updateCard = useKanbanStore((s) => s.updateCard);
  const archiveCard = useKanbanStore((s) => s.archiveCard);
  const selectCard = useKanbanStore((s) => s.selectCard);

  const [title, setTitle] = useState(card.title);
  const [saved, setSaved] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const savedTimer = useRef<number | null>(null);
  const editorRef = useRef<CardBodyEditorHandle | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef(false);

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

  const onArchive = (): void => {
    void archive();
  };

  // M4: Archive must await pending editor saves like Close does — otherwise
  // the modal unmounts mid-flush and a failed cleanup save would silently
  // lose edits.
  const archive = async (): Promise<void> => {
    try {
      await editorRef.current?.flush();
    } catch {
      setCloseBlocked(true);
      return;
    }
    await archiveCard(card.id);
  };

  // H4: Close must await the editor's pending save. If the save fails the
  // editor surfaces a "Save failed — retry" pill; we keep the modal open
  // (and show a brief banner) so the user can resolve it.
  const close = async (): Promise<void> => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      await editorRef.current?.flush();
    } catch {
      setCloseBlocked(true);
      closingRef.current = false;
      return;
    }
    selectCard(null);
  };

  // Sync wrapper for JSX onClick handlers (React ignores the returned promise).
  const onClose = (): void => {
    void close();
  };

  useEffect(() => {
    const root = modalRef.current;
    if (!root) return;
    // Focus first focusable so Esc/Tab work without a manual click.
    const first = root.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }, []);

  // Esc closes (subject to closeBlocked retry) + Tab focus trap.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = modalRef.current;
    if (!root) return;
    const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => !el.hasAttribute('disabled'),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="kanso-modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={modalRef}
        className="kanso-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Card detail"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="kanso-modal-header">
          <h3 className="kanso-modal-title">Card</h3>
          <span
            className={`kanso-saved-pill${saved ? ' kanso-saved-pill--visible' : ''}`}
            aria-live="polite"
          >
            Saved
          </span>
          <button type="button" className="kanso-btn" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="kanso-modal-body">
          {closeBlocked && (
            <div className="kanso-editor-banner" role="alert">
              Can’t close yet — your last edit hasn’t saved. Retry above, then try again.
            </div>
          )}
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
            <span className="kanso-label">Tags</span>
            <TagPickerPopover cardId={card.id} />
          </div>
          <div className="kanso-field">
            <span className="kanso-label">Due date</span>
            <DueDateEditor card={card} />
          </div>
          <div className="kanso-field">
            <span className="kanso-label">Body</span>
            <Suspense fallback={<div className="kanso-editor-loading">Loading editor…</div>}>
              <CardBodyEditor cardId={card.id} ref={editorRef} />
            </Suspense>
          </div>
        </div>
        <footer className="kanso-modal-footer">
          <button type="button" className="kanso-btn kanso-btn--danger" onClick={onArchive}>
            Archive
          </button>
          <span />
        </footer>
      </div>
    </div>
  );
}
