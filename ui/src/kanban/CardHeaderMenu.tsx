// Overflow menu for the card-as-doc modal header. Mirrors ColumnHeaderMenu
// in structure but scoped to a single item (Archive) today; kept as its
// own component so tests can drive it, and so structural actions can grow
// without bloating CardDetailModal.

import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

interface Item {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

interface Props {
  items: Item[];
}

export default function CardHeaderMenu({ items }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Escape inside the menu closes the menu only — the modal's Esc handler
  // sees open=false on next dispatch and doesn't fire. React's onKeyDown
  // fires before document-level listeners in event order, but the modal
  // also uses React's onKeyDown; stopPropagation keeps the modal's handler
  // off entirely while the menu is open.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      className="kanso-card-menu-root"
      onKeyDown={onKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className="kanso-icon-btn"
        aria-label="Card menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="kanso-menu" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={
                item.danger
                  ? 'kanso-menu-item kanso-menu-item--danger'
                  : 'kanso-menu-item'
              }
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
