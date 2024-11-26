import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PageContextProvider } from './hooks/usePage';
import { GameContextProvider } from './hooks/useGame';
import { UserSettingsContextProvider } from './hooks/useUserSettings';
import { MockProvider } from './hooks/useMocks';
import { ConfirmationDialogProvider } from './hooks/useConfirmation';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MockProvider gameStatus="GAVE_UP">
      <ConfirmationDialogProvider>
        <PageContextProvider>
          <UserSettingsContextProvider>
            <GameContextProvider>
              <App />
            </GameContextProvider>
          </UserSettingsContextProvider>
        </PageContextProvider>
      </ConfirmationDialogProvider>
    </MockProvider>
  </StrictMode>
);
