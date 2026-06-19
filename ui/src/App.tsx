import { lazy, Suspense } from 'react';

const EditorDemo = lazy(() => import('./editor/EditorDemo'));

export default function App() {
  return (
    <div>
      <h1>kanso</h1>
      <Suspense fallback={<p>Loading editor…</p>}>
        <EditorDemo />
      </Suspense>
    </div>
  );
}
