import { createContext, useContext, useEffect, useState } from 'react';
import { Game } from '@hotandcold/classic-shared';
import { sendMessageToDevvit } from '../utils';
import { useDevvitListener } from './useDevvitListener';
import { logger } from '../utils/logger';
import { useMocks } from './useMocks';

type WordSubmissionStateContext = {
  isSubmitting: boolean;
  setIsSubmitting: (isSubmitting: boolean) => void;
};
const WordSubmissionContext = createContext<WordSubmissionStateContext | null>(null);

const GameContext = createContext<Partial<Game>>({});
const GameUpdaterContext = createContext<React.Dispatch<
  React.SetStateAction<Partial<Game>>
> | null>(null);
// foo to trigger rebuild
export const GameContextProvider = ({ children }: { children: React.ReactNode }) => {
  const mocks = useMocks();
  const [game, setGame] = useState<Partial<Game>>(mocks.getMock('mocks')?.game ?? {});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const initResponse = useDevvitListener('GAME_INIT_RESPONSE');
  const submissionResponse = useDevvitListener('WORD_SUBMITTED_RESPONSE');
  const hintResponse = useDevvitListener('HINT_RESPONSE');
  const giveUpResponse = useDevvitListener('GIVE_UP_RESPONSE');

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
      setIsSubmitting(false);
    }
  }, [submissionResponse]);

  useEffect(() => {
    logger.log('Hint response: ', hintResponse);
    if (hintResponse) {
      setGame(hintResponse);
    }
  }, [hintResponse]);

  useEffect(() => {
    logger.log('Give up response: ', giveUpResponse);
    if (giveUpResponse) {
      setGame(giveUpResponse);
    }
  }, [giveUpResponse]);

  return (
    <GameUpdaterContext.Provider value={setGame}>
      <WordSubmissionContext.Provider value={{ isSubmitting, setIsSubmitting }}>
        <GameContext.Provider value={game}>{children}</GameContext.Provider>
      </WordSubmissionContext.Provider>
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

export const useWordSubmission = () => {
  const context = useContext(WordSubmissionContext);
  if (context === null) {
    throw new Error('useWordSubmission must be used within a WordSubmissionProvider');
  }
  return context;
};
