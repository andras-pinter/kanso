import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useKanbanStore } from './hooks/useKanbanStore';
import type { CardDto } from './types';
import type { CardBodyEditorHandle } from './CardBodyEditor';
import TagPickerPopover from './TagPickerPopover';
import CardHeaderMenu from './CardHeaderMenu';

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
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const closingRef = useRef(false);

  const flashSaved = () => {
    setSaved(true);
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1400);
  };

  // Single source of truth for title persistence. Blur triggers it via a
  // fire-and-forget wrapper; close()/archive() await it so a dirty title
  // can't vanish silently when the modal unmounts.
  const commitTitle = async (): Promise<void> => {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setTitle(card.title);
      return;
    }
    if (trimmed === card.title) return;
    await updateCard(card.id, { title: trimmed });
    flashSaved();
  };

  const onTitleBlur = (): void => {
    commitTitle().catch(() => {
      // Blur-time failures surface through the same banner as close/archive.
      setCloseBlocked(true);
    });
  };

  // Autosize the title textarea to fit its content (capped by CSS at 3
  // lines; beyond that the textarea scrolls internally).
  const autosize = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    if (titleRef.current) autosize(titleRef.current);
  }, [title]);

  // Compute where focus should land after the archived card unmounts.
  // Prefers the next card in the same column; falls back to the previous
  // card, then to the column's "add card" affordance, then document.
  const computeNextFocusTarget = (): string | null => {
    const state = useKanbanStore.getState();
    const list = state.cardsByColumn[card.column_id];
    if (!list) return null;
    const idx = list.findIndex((c) => c.id === card.id);
    if (idx === -1) return null;
    const next = list[idx + 1] ?? list[idx - 1];
    return next ? next.id : null;
  };

  const focusAfterArchive = (nextCardId: string | null): void => {
    // queueMicrotask so the archive re-render / selectCard(null) has
    // committed and the card node (or add-card control) exists.
    queueMicrotask(() => {
      const doc = typeof document !== 'undefined' ? document : null;
      if (!doc) return;
      if (nextCardId) {
        const el = doc.querySelector<HTMLElement>(
          `[data-card-id="${CSS.escape(nextCardId)}"]`,
        );
        if (el) {
          el.focus();
          return;
        }
      }
      const addBtn = doc.querySelector<HTMLElement>(
        `[data-column-add="${CSS.escape(card.column_id)}"]`,
      );
      addBtn?.focus();
    });
  };

  // Archive must await title AND body saves before tearing the modal
  // down — otherwise a dirty edit vanishes silently. Failure keeps the
  // modal open via the same closeBlocked banner as close().
  const archive = async (): Promise<void> => {
    const nextFocus = computeNextFocusTarget();
    try {
      await commitTitle();
      await editorRef.current?.flush();
    } catch {
      setCloseBlocked(true);
      return;
    }
    await archiveCard(card.id);
    focusAfterArchive(nextFocus);
  };

  const onArchive = (): void => {
    void archive();
  };

  // Close awaits pending saves. On failure the editor's own retry
  // affordance is already visible; we surface a banner so the user knows
  // why the modal didn't close.
  const close = async (): Promise<void> => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      await commitTitle();
      await editorRef.current?.flush();
    } catch {
      setCloseBlocked(true);
      closingRef.current = false;
      return;
    }
    selectCard(null);
  };

  const onClose = (): void => {
    void close();
  };

  // Initial focus is the doc title, cursor at the end so users can type
  // straight away. Not "first focusable in DOM" — Tab flow (body →
  // header) means the natural first focusable is the title anyway, but
  // being explicit keeps this correct if the DOM order ever shifts.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  // Modal-level keydown: Esc closes (or retries after closeBlocked); Tab
  // wraps focus inside the dialog. The title textarea handles its own
  // Enter/Esc and stopPropagation'es them so this handler never sees
  // them while the title is focused. Same for the overflow menu.
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

  // Title-scoped keys. Enter → blur (titles don't have line breaks).
  // Esc → revert local state and blur, without closing the modal.
  const onTitleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      setTitle(card.title);
      e.currentTarget.blur();
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
        className="kanso-modal kanso-modal--doc"
        role="dialog"
        aria-modal="true"
        aria-label="Card detail"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* Body first in DOM so Tab flows title → tags → editor → header
            controls (overflow, close). .kanso-modal--doc flips flex order
            visually to keep the header on top. */}
        <div className="kanso-modal-body">
          {closeBlocked && (
            <div className="kanso-editor-banner" role="alert">
              Can’t close yet — your last edit hasn’t saved. Retry above, then try again.
            </div>
          )}
          <div className="kanso-doc-content">
            <textarea
              ref={titleRef}
              className="kanso-doc-title"
              aria-label="Card title"
              placeholder="Untitled"
              value={title}
              rows={1}
              spellCheck={false}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={onTitleBlur}
              onKeyDown={onTitleKeyDown}
            />
            <div className="kanso-doc-props">
              <TagPickerPopover cardId={card.id} />
            </div>
            <Suspense fallback={<div className="kanso-editor-loading">Loading editor…</div>}>
              <CardBodyEditor
                cardId={card.id}
                ref={editorRef}
                onSaved={flashSaved}
              />
            </Suspense>
          </div>
        </div>
        <header className="kanso-modal-header">
          <span
            className={`kanso-saved-pill${saved ? ' kanso-saved-pill--visible' : ''}`}
            aria-live="polite"
          >
            Saved
          </span>
          <CardHeaderMenu
            items={[{ label: 'Archive', onSelect: onArchive, danger: true }]}
          />
          <button
            type="button"
            className="kanso-icon-btn"
            aria-label="Close card"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
      </div>
    </div>
  );
}
