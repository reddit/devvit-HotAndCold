import { Game, HardcoreAccessStatus } from '@hotandcold/classic-shared';
import { createContext, useContext, useEffect, useState } from 'react';
import { useMocks } from './useMocks';
import { useDevvitListener } from './useDevvitListener';
import { sendMessageToDevvit } from '../utils';
import { logger } from '../utils/logger';
import { useModal } from './useModal';
import { useSetPage } from './usePage';

type AppState = {
  game: Partial<Game>;
  hardcoreAccess: HardcoreAccessStatus;
};

type AppStateContext = {
  appState: AppState;
  setGame: (game: Partial<Game>) => void;
  setAccess: (access: HardcoreAccessStatus) => void;
};

const appStateContext = createContext<AppStateContext | null>(null);

export const AppStateContextProvider = ({ children }: { children: React.ReactNode }) => {
  const mocks = useMocks();
  const { closeModal } = useModal();
  const setPage = useSetPage();

  const [game, setGame] = useState<Partial<Game>>(mocks.getMock('mocks')?.game ?? {});
  const [access, setAccess] = useState<HardcoreAccessStatus>({ status: 'inactive' });

  const initResponse = useDevvitListener('GAME_INIT_RESPONSE');
  const submissionResponse = useDevvitListener('WORD_SUBMITTED_RESPONSE');
  const hintResponse = useDevvitListener('HINT_RESPONSE');
  const giveUpResponse = useDevvitListener('GIVE_UP_RESPONSE');
  const hardcoreAccessInitResponse = useDevvitListener('HARDCORE_ACCESS_INIT_RESPONSE');
  const productPurchaseResponse = useDevvitListener('PURCHASE_PRODUCT_SUCCESS_RESPONSE');

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

  useEffect(() => {
    logger.log('Hardcore access init response: ', hardcoreAccessInitResponse);
    if (hardcoreAccessInitResponse?.hardcoreAccessStatus != null) {
      setAccess(hardcoreAccessInitResponse.hardcoreAccessStatus);
    }
  }, [hardcoreAccessInitResponse, setAccess]);

  // When a purchase is successful, update state and close the "Unlock Hardcore" modal
  useEffect(() => {
    logger.log('Product purchase response: ', productPurchaseResponse);
    if (productPurchaseResponse != null) {
      setAccess(productPurchaseResponse.access);
      closeModal();
    }
  }, [productPurchaseResponse, setAccess, closeModal]);

  useEffect(() => {
    if (
      // Keep in sync with usePage's initializer
      game.challengeUserInfo?.solvedAtMs ||
      game.challengeUserInfo?.gaveUpAtMs
    ) {
      setPage('win');
    } else if (game.mode === 'hardcore' && access.status === 'inactive') {
      setPage('unlock-hardcore');
    } else {
      setPage('play');
    }
  }, [game, access, setPage]);

  const value: AppStateContext = {
    appState: { game, hardcoreAccess: access },
    setGame,
    setAccess,
  };

  return <appStateContext.Provider value={value}>{children}</appStateContext.Provider>;
};

export const useAppState = () => {
  const context = useContext(appStateContext);
  if (context === null) {
    throw new Error('useAppState must be used within an AppStateContextProvider');
  }
  return context;
};
