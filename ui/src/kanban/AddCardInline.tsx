import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  onSubmit: (title: string) => void | Promise<void>;
  /** Column ID used as a focus-target hook for post-archive focus
   * placement in CardDetailModal. */
  columnId?: string;
}

export default function AddCardInline({ onSubmit, columnId }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Block onBlur from firing right after user submits via Enter — Submit
  // path already closes the editor, and a follow-up blur would re-submit.
  const submittingRef = useRef(false);

  useEffect(() => {
    if (open && ref.current) ref.current.focus();
  }, [open]);

  const reset = useCallback(() => {
    setValue('');
    setOpen(false);
    submittingRef.current = false;
  }, []);

  const commit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      reset();
      return;
    }
    submittingRef.current = true;
    try {
      await onSubmit(trimmed);
    } finally {
      reset();
    }
  }, [value, onSubmit, reset]);

  if (!open) {
    return (
      <button
        type="button"
        className="kanso-add-btn"
        data-column-add={columnId}
        onClick={() => setOpen(true)}
      >
        + Add task
      </button>
    );
  }

  return (
    <div className="kanso-add-form">
      <textarea
        ref={ref}
        className="kanso-add-textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            reset();
          }
        }}
        onBlur={() => {
          if (submittingRef.current) return;
          void commit();
        }}
        placeholder="Card title (Enter to add, Esc to cancel)"
      />
      <div className="kanso-add-actions">
        <button type="button" className="kanso-btn" onClick={reset}>
          Cancel
        </button>
        <button type="button" className="kanso-btn kanso-btn--primary" onClick={() => void commit()}>
          Add
        </button>
      </div>
    </div>
  );
}
