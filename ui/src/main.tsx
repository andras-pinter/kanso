import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './ErrorBoundary';

// Ember typography — bundled via @fontsource so the app stays offline-first.
// Only the weights the design actually uses are imported to keep bundle small.
import '@fontsource/public-sans/400.css';
import '@fontsource/public-sans/500.css';
import '@fontsource/public-sans/600.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/newsreader/600.css';
import '@fontsource/ibm-plex-mono/400.css';

import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
