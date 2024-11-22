import { createContext, useContext, useEffect, useState } from 'react';
import { Game } from '../shared';
import { sendMessageToDevvit } from '../utils';
import { useDevvitListener } from './useDevvitListener';
import { useSetPage } from './usePage';

const GameContext = createContext<Partial<Game>>({});
const GameUpdaterContext = createContext<React.Dispatch<
  React.SetStateAction<Partial<Game>>
> | null>(null);

export const GameContextProvider = ({ children }: { children: React.ReactNode }) => {
  const setPage = useSetPage();
  const [game, setGame] = useState<Partial<Game>>({});
  const initResponse = useDevvitListener('GAME_INIT_RESPONSE');
  const submissionResponse = useDevvitListener('WORD_SUBMITTED_RESPONSE');
  const hintResponse = useDevvitListener('HINT_RESPONSE');
  const giveUpResponse = useDevvitListener('GIVE_UP_RESPONSE');

  useEffect(() => {
    sendMessageToDevvit({
      type: 'GAME_INIT',
    });
  }, []);

  useEffect(() => {
    console.log('Init response: ', initResponse);
    if (initResponse) {
      setGame(initResponse);
    }
  }, [initResponse]);

  useEffect(() => {
    console.log('Submission response: ', submissionResponse);
    if (submissionResponse) {
      setGame(submissionResponse);
    }
  }, [submissionResponse]);

  useEffect(() => {
    console.log('Hint response: ', hintResponse);
    if (hintResponse) {
      setGame(hintResponse);
    }
  }, [hintResponse]);

  useEffect(() => {
    console.log('Give up response: ', giveUpResponse);
    if (giveUpResponse) {
      setGame(giveUpResponse);
    }
  }, [giveUpResponse]);

  useEffect(() => {
    console.log('New game info: ', game);
    if (game.challengeUserInfo?.solvedAtMs) {
      setPage('win');
      return;
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
