import './utils/initListener';
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PageContextProvider } from './hooks/usePage';
import { GameContextProvider } from './hooks/useGame';
import { UserSettingsContextProvider } from './hooks/useUserSettings';
import { ConfirmationDialogProvider } from '@hotandcold/webview-common/hooks/useConfirmation';
import { IS_DETACHED } from './constants';
import { logger } from './utils/logger';

if (IS_DETACHED) {
  logger.debug(`Running in detached mode`);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmationDialogProvider>
      <PageContextProvider>
        <UserSettingsContextProvider>
          <GameContextProvider>
            <App />
          </GameContextProvider>
        </UserSettingsContextProvider>
      </PageContextProvider>
    </ConfirmationDialogProvider>
  </StrictMode>
);
