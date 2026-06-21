import { lazy, Suspense, useEffect, useState } from 'react';
import KanbanBoard from './kanban/KanbanBoard';
import BoardSwitcher from './kanban/BoardSwitcher';
import ManageBoardsDrawer from './kanban/ManageBoardsDrawer';
import CliExtConsentModal from './CliExtConsentModal';
import { cliExtStatus, isTauri } from './kanban/api/client';

const EditorDemo = lazy(() => import('./editor/EditorDemo'));

// Phase 2 wired BlockSuite into the card drawer. We keep the lazy-import
// boundary exercised behind a debug flag so the editor chunk path doesn't
// bit-rot if no card is opened during a session.
const DEBUG_EDITOR = false;

export default function App() {
  const [showEditor, setShowEditor] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [showCliExtConsent, setShowCliExtConsent] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;

    let alive = true;
    cliExtStatus()
      .then((status) => {
        if (alive) setShowCliExtConsent(status.show_consent);
      })
      .catch((err: unknown) => {
        console.warn('cli extension status failed', err);
      });

    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="kanso-app">
      <header className="kanso-header">
        <BoardSwitcher onOpenManage={() => setManageOpen(true)} />
        {DEBUG_EDITOR && (
          <button
            type="button"
            className="kanso-debug-btn"
            onClick={() => setShowEditor((v) => !v)}
          >
            {showEditor ? 'Hide editor demo' : 'Show editor demo'}
          </button>
        )}
      </header>
      {showEditor ? (
        <Suspense fallback={<p>Loading editor…</p>}>
          <EditorDemo />
        </Suspense>
      ) : (
        <KanbanBoard />
      )}
      {manageOpen && <ManageBoardsDrawer onClose={() => setManageOpen(false)} />}
      {showCliExtConsent && <CliExtConsentModal onDone={() => setShowCliExtConsent(false)} />}
    </div>
  );
}
