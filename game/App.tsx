import { Page } from './shared';
import { PlayPage } from './pages/PlayPage';
import { StatsPage } from './pages/StatsPage';
import { WinPage } from './pages/WinPage';
import { usePage } from './hooks/usePage';
import { Progress } from './components/progress';
import { useGame } from './hooks/useGame';
import { Logo } from './components/logo';
import { sendMessageToDevvit } from './utils';
import { useConfirmation } from './hooks/useConfirmation';
import { AnimatedNumber } from './components/timer';
import { HelpMenu } from './components/helpMenu';
import { useState } from 'react';
import { HowToPlayModal } from './components/howToPlayModal';
import { LoadingPage } from './pages/LoadingPage';

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
    default:
      throw new Error(`Invalid page: ${page satisfies never}`);
  }
};

export const App = () => {
  const page = usePage();
  const { challengeUserInfo, number } = useGame();
  const isActivelyPlaying =
    challengeUserInfo?.guesses &&
    challengeUserInfo?.guesses?.length > 0 &&
    !challengeUserInfo?.solvedAtMs &&
    !challengeUserInfo?.gaveUpAtMs;
  const { showConfirmation } = useConfirmation();
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col p-6">
      <div>
        <div className="flex h-4 items-center justify-between">
          {number && <p className="text-sm text-gray-500">Challenge #{number}</p>}

          {challengeUserInfo?.guesses && (
            <div className="flex gap-3">
              <div className="flex items-end">
                <p className="text-sm text-gray-500">Guesses:&nbsp;</p>
                <AnimatedNumber
                  className="text-gray-500"
                  size={12.25}
                  value={challengeUserInfo.guesses?.length}
                />
              </div>
              <HelpMenu
                items={[
                  { name: 'How to Play', action: () => setHowToPlayOpen(true) },
                  {
                    name: 'Hint',
                    disabled: !isActivelyPlaying,
                    action: async () => {
                      const response = await showConfirmation({
                        title: 'Are you sure?',
                        description: `Receiving a hint will reduce your final score. Please use them sparingly to stay competitive on the leaderboard.`,
                        confirmText: 'Request Hint',
                        cancelText: 'Cancel',
                      });

                      if (!response.confirmed) return;

                      sendMessageToDevvit({
                        type: 'HINT_REQUEST',
                      });
                    },
                  },
                  {
                    name: 'Give Up',
                    disabled: !isActivelyPlaying,
                    action: async () => {
                      const response = await showConfirmation({
                        title: 'Are you sure?',
                        description: `This will end the game and reveal the word. You won't receive a score for this game and your streak will be reset.`,
                        confirmText: 'Give Up',
                        cancelText: 'Cancel',
                      });

                      if (!response.confirmed) return;

                      sendMessageToDevvit({
                        type: 'GIVE_UP_REQUEST',
                      });
                    },
                  },
                ]}
              />
            </div>
          )}
        </div>
        <div className="-mt-4 mb-[10px] flex justify-center">
          <Logo />
        </div>
      </div>
      {getPage(page)}
      {page !== 'loading' && <Progress />}
      <HowToPlayModal isOpen={howToPlayOpen} onClose={() => setHowToPlayOpen(false)} />
    </div>
  );
};
