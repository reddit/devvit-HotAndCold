import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import '../index.css';
import { createGuessEngine } from '../core/guessEngine';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { Header } from './header';
import { page, initNavigation } from './state/navigation';
import { WinPage } from './WinPage';
import { WinPageLoggedOut } from './WinPageLoggedOut';
import { Progress } from './Progress';
import { PlayPage } from './PlayPage';
import { HowToPlayModal } from './howToPlayModal';
import { ExperimentsModal } from './ExperimentsModal';
import { ArchiveModal } from './archiveModal';
import { ErrorBoundary } from '../shared/error';
import { isLoggedOut } from '../shared/user';
import type { GuessEngine } from '../core/guessEngine';
import { remountKey } from './state/experiments';
import { trpc } from '../trpc';

function AppContent({
  engine,
  challengeNumber,
  isAdmin,
}: {
  engine: GuessEngine;
  challengeNumber: number;
  isAdmin: boolean;
}) {
  return (
    <div className="h-[100dvh] min-h-[100dvh] w-full overflow-hidden">
      <div className="mx-auto flex h-full min-h-0 max-w-2xl flex-col overflow-hidden px-4 py-6 md:px-6">
        <Header engine={engine} isAdmin={isAdmin} />
        {page.value === 'win' ? (
          isLoggedOut() ? (
            <WinPageLoggedOut engine={engine} />
          ) : (
            <WinPage />
          )
        ) : (
          <PlayPage engine={engine} />
        )}
        <div className="relative mx-auto w-full max-w-xl">
          <Progress challengeNumber={Number(challengeNumber)} engine={engine} />
        </div>
        <HowToPlayModal />
        <ExperimentsModal />
        <ArchiveModal />
      </div>
    </div>
  );
}

export function App() {
  const [isAdmin, setIsAdmin] = useState(false);
  const challengeNumber = requireChallengeNumber();

  const engine = useMemo(() => {
    return createGuessEngine({ challengeNumber });
  }, [challengeNumber]);

  // Initialize navigation from cached state – non-blocking
  useEffect(() => {
    initNavigation();
  }, []);

  useEffect(() => {
    const fetchIsAdmin = async () => {
      try {
        const isAdmin = await trpc.user.isAdmin.query();

        setIsAdmin(isAdmin);
      } catch (error) {
        console.error('Error getting admin status', error);
      }
    };
    void fetchIsAdmin();
  }, [setIsAdmin]);

  return (
    <AppContent
      key={remountKey.value}
      engine={engine}
      challengeNumber={challengeNumber}
      isAdmin={isAdmin}
    />
  );
}

render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
  document.getElementById('root')!
);
