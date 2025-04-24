import { Page } from '@hotandcold/classic-shared';
import { PlayPage } from './pages/PlayPage';
import { StatsPage } from './pages/StatsPage';
import { WinPage } from './pages/WinPage';
import { usePage } from './hooks/usePage';
import { Progress } from './components/progress';
import { useGame } from './hooks/useGame';
import { cn } from '@hotandcold/webview-common/utils';
import { Header } from './components/header';
import { LoadingPage } from './pages/LoadingPage';

import { Modal, useModal } from './hooks/useModal';
import { UnlockHardcoreModal } from './components/UnlockHardcoreModal';
import { HowToPlayModal } from './components/howToPlayModal';
import { ScoreBreakdownModal } from './components/scoreBreakdownModal';

const getPage = (page: Page) => {
  switch (page) {
    case 'play':
      return <PlayPage />;
    case 'stats':
      return <StatsPage />;
    case 'win':
      return <WinPage />;
    case 'loading':
      return <LoadingPage />;
    case 'unlock-hardcore':
      // TODO: Implement page for hardcore mode
      return <div>UNLOCK HARDCORD</div>;
    default:
      throw new Error(`Invalid page: ${String(page satisfies never)}`);
  }
};

const getModal = (modal: Modal) => {
  switch (modal) {
    case 'unlock-hardcore':
      return <UnlockHardcoreModal />;
    case 'how-to-play':
      return <HowToPlayModal isOpen={true} onClose={() => {}} />;
    case 'score-breakdown':
      return <ScoreBreakdownModal clickAnywhereToClose={false} isOpen={true} onClose={() => {}} />;
  }
};

export const App = () => {
  const page = usePage();
  const { mode } = useGame();
  const { modal } = useModal();

  if (modal != null) {
    return getModal(modal);
  }

  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 flex-1 flex-col p-6',
        mode === 'hardcore' &&
          'bg-[url(/assets/hardcore_background.png)] bg-cover bg-center bg-no-repeat bg-blend-multiply'
      )}
    >
      <div className="mb-4 sm:mb-6">
        <Header />
      </div>
      {getPage(page)}
      <Progress />
    </div>
  );
};
