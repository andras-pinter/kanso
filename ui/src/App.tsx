import { lazy, Suspense, useState } from 'react';
import KanbanBoard from './kanban/KanbanBoard';

const EditorDemo = lazy(() => import('./editor/EditorDemo'));

// Phase 2 will re-mount BlockSuite inside the card detail panel. We keep
// the lazy-import wiring exercised behind a debug flag so the editor chunk
// path doesn't bit-rot.
const DEBUG_EDITOR = false;

export default function App() {
  const [showEditor, setShowEditor] = useState(false);

  return (
    <div className="kanso-app">
      <header className="kanso-header">
        <h1 className="kanso-wordmark">kanso</h1>
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
    </div>
  );
}
