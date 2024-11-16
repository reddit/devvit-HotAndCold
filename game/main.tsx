// @ts-expect-error
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PageContextProvider } from './hooks/usePage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PageContextProvider>
      <App />
    </PageContextProvider>
  </StrictMode>
);
