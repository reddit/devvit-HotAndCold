import { createContext, useContext, useEffect, useState } from 'react';
import { Page } from '@hotandcold/classic-shared';
import { useGame } from './useGame';
import { useHardcoreAccess } from './useHardcoreAccess';
import { useModal } from './useModal';
import { useDevvitListener } from './useDevvitListener';

const PageContext = createContext<Page | null>(null);
const PageUpdaterContext = createContext<React.Dispatch<React.SetStateAction<Page>> | null>(null);

export const PageContextProvider = ({ children }: { children: React.ReactNode }) => {
  const { closeModal } = useModal();
  const [page, setPage] = useState<Page>('loading');
  const game = useGame();
  const { access, setAccess } = useHardcoreAccess();
  const productPurchaseResponse = useDevvitListener('PURCHASE_PRODUCT_SUCCESS_RESPONSE');

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

  // When a purchase is successful, update state and close the "Unlock Hardcore" modal
  useEffect(() => {
    if (productPurchaseResponse != null) {
      setAccess(productPurchaseResponse.access);

      if (game.mode === 'regular') {
        closeModal();
      } else if (game.mode === 'hardcore') {
        setPage('play');
      }
    }
  }, [productPurchaseResponse, setAccess, closeModal]);

  return (
    <PageUpdaterContext.Provider value={setPage}>
      <PageContext.Provider value={page}>{children}</PageContext.Provider>
    </PageUpdaterContext.Provider>
  );
};

export const usePage = () => {
  const context = useContext(PageContext);
  if (context === null) {
    throw new Error('usePage must be used within a PageContextProvider');
  }
  return context;
};

export const useSetPage = () => {
  const setPage = useContext(PageUpdaterContext);
  if (setPage === null) {
    throw new Error('useSetPage must be used within a PageContextProvider');
  }
  return setPage;
};
