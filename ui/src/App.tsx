import { lazy, Suspense } from 'react';
import CardsPanel from './CardsPanel';

const EditorDemo = lazy(() => import('./editor/EditorDemo'));

export default function App() {
  return (
    <div>
      <h1>kanso</h1>
      <CardsPanel />
      <Suspense fallback={<p>Loading editor…</p>}>
        <EditorDemo />
      </Suspense>
    </div>
  );
}
