import { Page } from '@hotandcold/raid-shared';
import { PlayPage } from './pages/PlayPage';
import { WinPage } from './pages/WinPage';
import { usePage } from './hooks/usePage';
import { useGame } from './hooks/useGame';
import { sendMessageToDevvit } from './utils';
import { prettyNumber } from '@hotandcold/webview-common/utils';
import { AnimatedNumber } from '@hotandcold/webview-common/components/timer';
import { HelpMenu } from '@hotandcold/webview-common/components/helpMenu';
import { useEffect, useState } from 'react';
import { HowToPlayModal } from './components/howToPlayModal';
import { LoadingPage } from './pages/LoadingPage';
import { useSetUserSettings, useUserSettings } from './hooks/useUserSettings';
import { useDevvitListener } from './hooks/useDevvitListener';
import { TOTAL_WORDS_IN_DICTIONARY } from '@hotandcold/shared';

const getPage = (page: Page) => {
  switch (page) {
    case 'play':
      return <PlayPage />;
    case 'win':
      return <WinPage />;
    case 'loading':
      return <LoadingPage />;
    default:
      throw new Error(`Invalid page: ${page satisfies never}`);
  }
};

const CurrentPlayers = () => {
  const { challengeInfo } = useGame();
  const data = useDevvitListener('NEW_PLAYER_COUNT');

  return (
    <p className="text-sm text-gray-500">
      Players:&nbsp;
      {/* 1 since the person viewing it could be the first and we don't count until there's a guess */}
      {data?.playerCount ?? prettyNumber(challengeInfo?.totalPlayers ?? 1)}
    </p>
  );
};

const CurrentGuesses = () => {
  const [guesses, setGuesses] = useState(0);
  const { userAvailableGuesses } = useGame();
  const faucetResponse = useDevvitListener('FAUCET_REPLENISH');

  useEffect(() => {
    if (faucetResponse) {
      setGuesses(faucetResponse.availableGuesses);
    }
  }, [faucetResponse]);

  useEffect(() => {
    if (userAvailableGuesses) {
      setGuesses(userAvailableGuesses);
    }
  }, [userAvailableGuesses]);

  return (
    <div className="flex items-end">
      <p className="text-sm text-gray-500">Guesses:&nbsp;</p>
      <AnimatedNumber className="text-gray-500" size={12.25} value={guesses >= 0 ? guesses : 0} />
    </div>
  );
};

export const App = () => {
  const page = usePage();
  const { layout, sortType, isUserOptedIntoReminders } = useUserSettings();
  const setUserSettings = useSetUserSettings();
  const { challengeUserInfo, challengeInfo } = useGame();
  const isActivelyPlaying = challengeUserInfo?.guesses && challengeUserInfo?.guesses?.length > 0;
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);

  const computePercentOfDictionaryGuessed = () => {
    const raw = (challengeInfo?.totalUniqueGuesses ?? 0) / TOTAL_WORDS_IN_DICTIONARY;

    return `${(raw * 100).toFixed(2)}%`;
  };

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col p-6">
      <div>
        <div className="flex h-4 items-center justify-between">
          <CurrentPlayers />
          <div className="flex gap-3">
            <CurrentGuesses />
            <HelpMenu
              items={[
                { name: 'How to Play', action: () => setHowToPlayOpen(true) },
                {
                  name: 'Toggle Size',
                  action: () =>
                    setUserSettings((x) => ({
                      ...x,
                      layout: layout === 'CONDENSED' ? 'EXPANDED' : 'CONDENSED',
                    })),
                },
                {
                  name: isUserOptedIntoReminders ? 'Unsubscribe' : 'Subscribe',
                  action: () => {
                    sendMessageToDevvit({
                      type: 'TOGGLE_USER_REMINDER',
                      payload: {},
                    });
                  },
                },
                {
                  name: `Sort by ${sortType === 'TIMESTAMP' ? 'Similarity' : 'Time'}`,
                  disabled: !isActivelyPlaying,
                  action: async () => {
                    setUserSettings((x) => ({
                      ...x,
                      sortType: x.sortType === 'SIMILARITY' ? 'TIMESTAMP' : 'SIMILARITY',
                    }));
                  },
                },
              ]}
            />
          </div>
        </div>
        <div className="-mt-4 mb-[10px] flex justify-center">
          <img src="assets/logo.jpg" className="w-[120px] object-contain" />
        </div>
      </div>
      {getPage(page)}
      <div className="pt-3 text-center">
        % of dictionary guessed: {computePercentOfDictionaryGuessed()}
      </div>
      <HowToPlayModal isOpen={howToPlayOpen} onClose={() => setHowToPlayOpen(false)} />
    </div>
  );
};
