import { createContext, useContext, useState } from 'react';
import { Game } from '@hotandcold/shared';
import {
  CHALLENGE_LEADERBOARD_RESPONSE,
  generateMockProgressData,
  generateTestScenarios,
  GIVE_UP_GAME,
  PLAYING_GAME,
  WINNING_GAME,
} from '../mocks';
import { IS_DETACHED } from '../constants';

export type MockConfig = {
  meta?: {
    gameStatus: 'PLAYING' | 'WON' | 'GAVE_UP';
    progressTestScenario: keyof ReturnType<typeof generateTestScenarios>;
  };
  mocks?: {
    game?: Partial<Game>;
    challengeLeaderboardResponse?: any;
    generateMockProgressData?: ReturnType<typeof generateMockProgressData>;
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
  progressTestScenario,
}: { children: React.ReactNode } & MockConfig['meta']) => {
  const meta = {
    gameStatus,
    progressTestScenario,
  };
  const [mockState, setMockState] = useState<MockConfig>(
    // For tree shaking!
    IS_DETACHED
      ? {
          meta,
          mocks: {
            game:
              meta?.gameStatus === 'GAVE_UP'
                ? GIVE_UP_GAME
                : meta?.gameStatus === 'WON'
                  ? WINNING_GAME
                  : PLAYING_GAME,
            generateMockProgressData:
              generateTestScenarios()[meta?.progressTestScenario ?? 'earlyProgress'],
            challengeLeaderboardResponse: CHALLENGE_LEADERBOARD_RESPONSE,
          },
        }
      : {}
  );

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
