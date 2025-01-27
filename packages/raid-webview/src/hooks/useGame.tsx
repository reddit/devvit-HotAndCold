import { createContext, useContext, useEffect, useState } from 'react';
import { Game } from '@hotandcold/raid-shared';
import { sendMessageToDevvit } from '../utils';
import { useDevvitListener } from './useDevvitListener';
import { useSetPage } from './usePage';
import { logger } from '../utils/logger';
import { GAME_INIT_DATA } from '../utils/initListener';

const isEmpty = (obj: object): boolean => {
  return Object.keys(obj).length === 0;
};

const GameContext = createContext<Partial<Game>>({});
const GameUpdaterContext = createContext<React.Dispatch<
  React.SetStateAction<Partial<Game>>
> | null>(null);
// foo to trigger rebuild
export const GameContextProvider = ({ children }: { children: React.ReactNode }) => {
  const setPage = useSetPage();
  const [game, setGame] = useState<Partial<Game>>(GAME_INIT_DATA ?? {});
  const initResponse = useDevvitListener('GAME_INIT_RESPONSE');
  const submissionResponse = useDevvitListener('WORD_SUBMITTED_RESPONSE');
  const raidSolvedResponse = useDevvitListener('RAID_SOLVED');

  // Just in case the game is not initialized
  // This is old code left in for safety
  useEffect(() => {
    sendMessageToDevvit({
      type: 'GAME_INIT',
    });
  }, []);

  useEffect(() => {
    logger.log('Init response: ', initResponse);
    if (initResponse) {
      setGame(initResponse);
    }
  }, [initResponse]);

  useEffect(() => {
    logger.log('Submission response: ', submissionResponse);
    if (submissionResponse) {
      setGame(submissionResponse);
    }
  }, [submissionResponse]);

  useEffect(() => {
    console.log('raid solved effect', raidSolvedResponse);
    if (raidSolvedResponse) {
      setGame((x) => ({
        ...x,
        challengeInfo: raidSolvedResponse.challengeInfo,
        challengeStatus: 'COMPLETED',
      }));
    }
  }, [raidSolvedResponse]);

  useEffect(() => {
    logger.log('New game info: ', game);

    if (isEmpty(game)) return;

    // Keep in sync with usePage's initializer
    if (game.challengeInfo?.solvedAtMs) {
      setPage('win');
    } else {
      setPage('play');
    }
  }, [game, setPage]);

  return (
    <GameUpdaterContext.Provider value={setGame}>
      <GameContext.Provider value={game}>{children}</GameContext.Provider>
    </GameUpdaterContext.Provider>
  );
};

export const useGame = () => {
  const context = useContext(GameContext);
  if (context === null) {
    throw new Error('useGame must be used within a GameContextProvider');
  }
  return context;
};

export const useSetGame = () => {
  const setGame = useContext(GameUpdaterContext);
  if (setGame === null) {
    throw new Error('useSetGame must be used within a GameContextProvider');
  }
  return setGame;
};
