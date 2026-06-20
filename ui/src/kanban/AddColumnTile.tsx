// "+ Add column" tile rendered at the right end of the column strip.
// Same UX shape as `AddCardInline`: click to open, Enter to submit, Esc to
// cancel, blur commits.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useKanbanStore } from './hooks/useKanbanStore';

export default function AddColumnTile() {
  const addColumn = useKanbanStore((s) => s.addColumn);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
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
      await addColumn(trimmed);
    } finally {
      reset();
    }
  }, [value, addColumn, reset]);

  if (!open) {
    return (
      <button
        type="button"
        className="kanso-add-column-tile"
        onClick={() => setOpen(true)}
        aria-label="Add column"
      >
        + Add column
      </button>
    );
  }

  return (
    <div className="kanso-add-column-tile kanso-add-column-tile--editing">
      <input
        ref={inputRef}
        className="kanso-add-column-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
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
        placeholder="Column name"
      />
    </div>
  );
}
