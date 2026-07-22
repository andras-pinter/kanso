import { useEffect, useState } from 'react';
import KanbanBoard from './kanban/KanbanBoard';
import BoardSwitcher from './kanban/BoardSwitcher';
import ManageBoardsDrawer from './kanban/ManageBoardsDrawer';
import CliExtConsentModal from './CliExtConsentModal';
import { cliExtStatus, isTauri } from './kanban/api/client';
import ConnectAppsPanel from './connect/ConnectAppsPanel';
import ThemeToggle from './theme/ThemeToggle';
import StatusBar from './StatusBar';

type View = 'board' | 'connect';

export default function App() {
  const [manageOpen, setManageOpen] = useState(false);
  const [showCliExtConsent, setShowCliExtConsent] = useState(false);
  const [view, setView] = useState<View>('board');

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
        <div className="kanso-header-main">
          <BoardSwitcher onOpenManage={() => setManageOpen(true)} />
          <nav className="kanso-top-nav" aria-label="Primary">
            <button
              type="button"
              className={`kanso-nav-btn${view === 'board' ? ' kanso-nav-btn--active' : ''}`}
              onClick={() => setView('board')}
            >
              Board
            </button>
            <button
              type="button"
              className={`kanso-nav-btn${view === 'connect' ? ' kanso-nav-btn--active' : ''}`}
              onClick={() => setView('connect')}
            >
              Connect apps
            </button>
          </nav>
        </div>
        <div className="kanso-header-actions">
          <ThemeToggle />
        </div>
      </header>
      {view === 'connect' ? <ConnectAppsPanel /> : <KanbanBoard />}
      <StatusBar />
      {manageOpen && <ManageBoardsDrawer onClose={() => setManageOpen(false)} />}
      {showCliExtConsent && <CliExtConsentModal onDone={() => setShowCliExtConsent(false)} />}
    </div>
  );
}
