import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useKanbanStore } from './hooks/useKanbanStore';
import type { CardDto } from './types';
import CardBodyEditor, { type CardBodyEditorHandle } from './CardBodyEditor';
import TagPickerPopover from './TagPickerPopover';
import CardHeaderMenu from './CardHeaderMenu';

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
  const deleteCard = useKanbanStore((s) => s.deleteCard);
  const selectCard = useKanbanStore((s) => s.selectCard);

  const [title, setTitle] = useState(card.title);
  const [saved, setSaved] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Early-guard so a second Delete click during the pre-delete
  // commitTitle/flush window doesn't fire another deleteThis() in
  // parallel. `deleting` state alone is only true AFTER awaits, which
  // leaves a race window where the overflow item is still enabled.
  const deletingRef = useRef(false);
  const savedTimer = useRef<number | null>(null);
  const editorRef = useRef<CardBodyEditorHandle | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const closingRef = useRef(false);
  // Per-modal monotonic sequence for title commits. When multiple
  // commitTitle calls are in flight (blur then close) and their API
  // responses arrive out of order, only the latest one is allowed to
  // verify persistence / raise a stale-save error. The store already
  // gates its writes; this gate keeps the modal's post-check honest.
  const titleCommitSeqRef = useRef(0);

  const flashSaved = () => {
    setSaved(true);
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1400);
  };

  // Single source of truth for title persistence. Blur triggers it via a
  // fire-and-forget wrapper; close()/deleteThis() await it so a dirty title
  // can't vanish silently when the modal unmounts. The store's updateCard
  // swallows API failures (optimistic rollback + store.error), so we
  // verify persistence by reading state back and throwing on mismatch.
  const commitTitle = async (): Promise<void> => {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setTitle(card.title);
      return;
    }
    if (trimmed === card.title) return;
    const mySeq = ++titleCommitSeqRef.current;
    await updateCard(card.id, { title: trimmed });
    // A newer commitTitle has already fired for this modal — its outcome
    // is authoritative, so silently drop this one's post-check.
    if (mySeq !== titleCommitSeqRef.current) return;
    const fresh = useKanbanStore
      .getState()
      .cardsByColumn[card.column_id]?.find((c) => c.id === card.id);
    if (!fresh || fresh.title !== trimmed) {
      throw new Error('title save failed');
    }
    flashSaved();
  };

  const onTitleBlur = (): void => {
    commitTitle().catch(() => {
      // Blur-time failures surface through the same banner as close/delete.
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

  // Compute where focus should land after the deleted card unmounts.
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

  const focusAfterDelete = (nextCardId: string | null): void => {
    // queueMicrotask so the delete re-render / selectCard(null) has
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

  // Delete must await title AND body saves before tearing the modal
  // down — otherwise a dirty edit vanishes silently. Failure keeps the
  // modal open via the same closeBlocked banner as close(), or a
  // delete-specific banner when the delete API itself rejects.
  const deleteThis = async (): Promise<void> => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    const nextFocus = computeNextFocusTarget();
    try {
      await commitTitle();
      await editorRef.current?.flush();
    } catch {
      setCloseBlocked(true);
      deletingRef.current = false;
      return;
    }
    setDeleteFailed(false);
    setDeleting(true);
    const ok = await deleteCard(card.id);
    setDeleting(false);
    if (!ok) {
      setDeleteFailed(true);
      deletingRef.current = false;
      return;
    }
    focusAfterDelete(nextFocus);
  };

  const onDelete = (): void => {
    void deleteThis();
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
  // straight away. Title is the first focusable in DOM order, so this
  // matches the natural Tab entry point; being explicit keeps the intent
  // clear if the DOM order ever shifts.
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
        {/* DOM order: title (header) → body (tags, editor) → action row
            (saved pill, overflow menu, close). CSS grid places the action
            row visually on the top-right of the header. Natural Tab
            traversal reads title → tags → editor → overflow → close. */}
        <header className="kanso-modal-header">
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
        </header>
        <div className="kanso-modal-body">
          {closeBlocked && (
            <div className="kanso-editor-banner" role="alert">
              Can’t close yet — your last edit hasn’t saved. Retry above, then try again.
            </div>
          )}
          {deleteFailed && (
            <div className="kanso-editor-banner" role="alert">
              Couldn’t delete this card — the request failed. Try again.
            </div>
          )}
          <div className="kanso-doc-content">
            <div className="kanso-doc-props">
              <TagPickerPopover cardId={card.id} />
            </div>
            <CardBodyEditor
              cardId={card.id}
              ref={editorRef}
              onSaved={flashSaved}
            />
          </div>
        </div>
        <div className="kanso-modal-header-actions">
          <span
            className={`kanso-saved-pill${saved ? ' kanso-saved-pill--visible' : ''}`}
            aria-live="polite"
          >
            Saved
          </span>
          {/* TODO: promote Delete to a header Trash icon when undo toasts
              land (see DESIGN.md). Until then it stays behind the ⋯ so a
              single misclick can't nuke a card. */}
          <CardHeaderMenu
            items={[
              { label: 'Delete', onSelect: onDelete, danger: true, disabled: deleting },
            ]}
          />
          <button
            type="button"
            className="kanso-icon-btn"
            aria-label="Close card"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
