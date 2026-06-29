// Keyboard shortcuts cheatsheet. Toggled by `?` (Shift+/) when the user
// isn't typing into an editor. Renders above every other overlay so it's
// always reachable.

import { useEffect, useId } from 'react';

interface Shortcut {
  keys: string[];
  description: string;
}

interface Group {
  title: string;
  items: Shortcut[];
}

const isMac =
  typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
const mod = isMac ? '⌘' : 'Ctrl';

const GROUPS: Group[] = [
  {
    title: 'Global',
    items: [
      { keys: [mod, 'K'], description: 'Search cards' },
      { keys: [mod, 'Shift', 'K'], description: 'Quick add (works system-wide)' },
      { keys: ['?'], description: 'Show this cheatsheet' },
      { keys: ['Esc'], description: 'Close dialog or overlay' },
    ],
  },
  {
    title: 'Board',
    items: [
      { keys: ['Tab'], description: 'Move focus between cards and controls' },
      { keys: ['Enter'], description: 'Open the focused card' },
      { keys: ['Space'], description: 'Start or drop a keyboard drag' },
      { keys: ['↑', '↓', '←', '→'], description: 'Move dragged card or column' },
    ],
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ShortcutsOverlay({ open, onClose }: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="kanso-shortcuts-backdrop" role="presentation" onClick={onClose}>
      <section
        className="kanso-shortcuts"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="kanso-shortcuts-header">
          <h2 id={titleId}>Keyboard shortcuts</h2>
          <p>Press <kbd className="kanso-kbd">Esc</kbd> or <kbd className="kanso-kbd">?</kbd> to close.</p>
        </header>
        <div className="kanso-shortcuts-grid">
          {GROUPS.map((group) => (
            <section key={group.title} className="kanso-shortcuts-group">
              <h3>{group.title}</h3>
              <dl>
                {group.items.map((item) => (
                  <div key={item.description} className="kanso-shortcuts-row">
                    <dt>
                      {item.keys.map((k, i) => (
                        <span key={i}>
                          {i > 0 && <span className="kanso-shortcuts-sep">+</span>}
                          <kbd className="kanso-kbd kanso-kbd--lg">{k}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd>{item.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
