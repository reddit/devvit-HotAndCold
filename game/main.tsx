// @ts-expect-error
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PageContextProvider } from './hooks/usePage';
import { GameContextProvider } from './hooks/useGame';
import { UserSettingsContextProvider } from './hooks/useUserSettings';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PageContextProvider>
      <UserSettingsContextProvider>
        <GameContextProvider>
          <App />
        </GameContextProvider>
      </UserSettingsContextProvider>
    </PageContextProvider>
  </StrictMode>
);
