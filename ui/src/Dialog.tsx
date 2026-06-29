// Lightweight confirm / prompt dialogs that match the rest of the app's
// modal chrome (kanso-alert). Used to replace window.confirm / prompt so
// the look matches the rest of the UI and Esc / Enter / focus behave
// consistently.

import { useEffect, useId, useRef, useState } from 'react';

interface ShellProps {
  open: boolean;
  labelledBy: string;
  onCancel: () => void;
  children: React.ReactNode;
}

function DialogShell({ open, labelledBy, onCancel, children }: ShellProps) {
  useEffect(() => {
    if (!open) return;
    // Capture phase + stopImmediatePropagation: we run before any
    // ancestor drawer's bubble-phase Esc handler and prevent it from
    // firing, so closing a nested confirm doesn't also close its drawer.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="kanso-alert-backdrop"
      onClick={onCancel}
      role="presentation"
    >
      <section
        className="kanso-alert"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  return (
    <DialogShell open={open} labelledBy={titleId} onCancel={onCancel}>
      <h2 id={titleId}>{title}</h2>
      <p>{message}</p>
      <div className="kanso-alert-actions">
        <button
          type="button"
          className="kanso-secondary-btn"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          ref={confirmRef}
          type="button"
          className={destructive ? 'kanso-primary-btn kanso-primary-btn--danger' : 'kanso-primary-btn'}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </DialogShell>
  );
}

interface PromptProps {
  open: boolean;
  title: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
  cancelLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog(props: PromptProps) {
  // Mounting the body conditionally guarantees state resets to
  // initialValue on every open without a setState-in-effect dance.
  if (!props.open) return null;
  return <PromptDialogBody {...props} />;
}

function PromptDialogBody({
  title,
  label,
  initialValue = '',
  placeholder,
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  onSubmit,
  onCancel,
}: Omit<PromptProps, 'open'>) {
  const titleId = useId();
  const inputId = `${titleId}-input`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <DialogShell open={true} labelledBy={titleId} onCancel={onCancel}>
      <h2 id={titleId}>{title}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {label && <label className="kanso-label" htmlFor={inputId}>{label}</label>}
        <input
          ref={inputRef}
          id={inputId}
          className="kanso-dialog-input"
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="kanso-alert-actions">
          <button type="button" className="kanso-secondary-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="submit"
            className="kanso-primary-btn"
            disabled={value.trim().length === 0}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
