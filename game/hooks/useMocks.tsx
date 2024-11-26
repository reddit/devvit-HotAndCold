import { createContext, useContext, useState } from 'react';
import { Game } from '../shared';
import { GIVE_UP_GAME, PLAYING_GAME, WINNING_GAME } from '../mocks';

export type MockConfig = {
  meta: {
    gameStatus: 'PLAYING' | 'WON' | 'GAVE_UP';
  };
  mocks: {
    game?: Partial<Game>;
    challengeLeaderboardResponse?: any;
  };
};

type MockContextType = {
  getMock: <K extends keyof MockConfig>(key: K) => MockConfig[K];
  setMock: <K extends keyof MockConfig>(key: K, value: Partial<MockConfig[K]>) => void;
};

const MockContext = createContext<MockContextType | null>(null);

export const MockProvider = ({
  children,
  gameStatus,
}: { children: React.ReactNode } & MockConfig['meta']) => {
  const [mockState, setMockState] = useState<MockConfig>({
    meta: {
      gameStatus,
    },
    mocks: {
      game:
        gameStatus === 'GAVE_UP'
          ? GIVE_UP_GAME
          : gameStatus === 'WON'
            ? WINNING_GAME
            : PLAYING_GAME,
      challengeLeaderboardResponse: {
        'userStreak': 6,
        'leaderboardByScore': [
          {
            'score': 451,
            'member': 'mwood230',
          },
          {
            'score': 394,
            'member': 'UnluckyHuckleberry53',
          },
        ],
        'leaderboardByFastest': [
          {
            'score': 34219,
            'member': 'UnluckyHuckleberry53',
          },
          {
            'score': 6844,
            'member': 'mwood230',
          },
        ],
        'userRank': {
          'score': 2,
          'timeToSolve': 1,
        },
      },
    },
  });

  const value: MockContextType = {
    getMock: (key) => mockState[key],
    setMock: (key, value) => {
      setMockState((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          ...value,
        },
      }));
    },
  };

  return <MockContext.Provider value={value}>{children}</MockContext.Provider>;
};

export const useMocks = () => {
  const context = useContext(MockContext);

  if (!context) {
    throw new Error('useMocks must be used within a MockProvider');
  }

  return context;
};
