import './utils/initListener';
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PageContextProvider } from './hooks/usePage';
import { GameContextProvider } from './hooks/useGame';
import { UserSettingsContextProvider } from './hooks/useUserSettings';
import { MockProvider } from './hooks/useMocks';
import { ConfirmationDialogProvider } from '@hotandcold/webview-common/hooks/useConfirmation';
import { IS_DETACHED } from './constants';
import { logger } from './utils/logger';

console.log('webview main called');

if (IS_DETACHED) {
  logger.debug(`Running in detached mode`);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MockProvider gameStatus="PLAYING" progressTestScenario="earlyProgress">
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
