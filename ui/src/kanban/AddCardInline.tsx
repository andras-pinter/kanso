import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (title: string) => void | Promise<void>;
}

export default function AddCardInline({ open, onClose, onSubmit }: Props) {
  const [value, setValue] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Suppress the blur→commit path once submit or cancel is already in
  // flight, so button clicks and Enter don't double-fire commit.
  const submittingRef = useRef(false);

  useEffect(() => {
    if (open && ref.current) ref.current.focus();
  }, [open]);

  const cancel = useCallback(() => {
    submittingRef.current = true;
    setValue('');
    onClose();
  }, [onClose]);

  const commit = useCallback(async () => {
    if (submittingRef.current) return;
    const trimmed = value.trim();
    if (!trimmed) {
      cancel();
      return;
    }
    submittingRef.current = true;
    try {
      await onSubmit(trimmed);
    } finally {
      setValue('');
      onClose();
    }
  }, [value, onSubmit, onClose, cancel]);

  if (!open) return null;

  return (
    <div ref={rootRef} className="kanso-card kanso-card--draft">
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
            cancel();
          }
        }}
        onBlur={(e) => {
          // Ignore blurs into our own Cancel/Add buttons — they own
          // the resulting action and would otherwise race with commit.
          const next = e.relatedTarget as Node | null;
          if (next && rootRef.current?.contains(next)) return;
          if (submittingRef.current) return;
          void commit();
        }}
        rows={1}
        placeholder="New card title…"
      />
      <div className="kanso-add-actions">
        <button type="button" className="kanso-btn" onClick={cancel}>
          Cancel
        </button>
        <button type="button" className="kanso-btn kanso-btn--primary" onClick={() => void commit()}>
          Add
        </button>
      </div>
    </div>
  );
}
