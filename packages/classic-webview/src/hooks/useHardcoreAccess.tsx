import { HardcoreAccessStatus } from '@hotandcold/classic-shared';
import { createContext, useContext, useEffect, useState } from 'react';
import { useDevvitListener } from './useDevvitListener';
import { useModal } from './useModal';
import { useGame } from './useGame';
import { useSetPage } from './usePage';

type HardcoreAccessContext = {
  access: HardcoreAccessStatus;
  setAccess: (a: HardcoreAccessStatus) => void;
};

const hardcoreAccessContext = createContext<HardcoreAccessContext | null>(null);

export const HardcoreAccessContextProvider = (props: { children: React.ReactNode }) => {
  const game = useGame();
  const [access, setAccess] = useState<HardcoreAccessStatus>({ status: 'inactive' });
  const hardcoreAccessInitResponse = useDevvitListener('HARDCORE_ACCESS_INIT_RESPONSE');
  const productPurchaseResponse = useDevvitListener('PURCHASE_PRODUCT_SUCCESS_RESPONSE');
  const { closeModal } = useModal();
  const setPage = useSetPage();

  useEffect(() => {
    if (hardcoreAccessInitResponse?.hardcoreAccessStatus != null) {
      setAccess(hardcoreAccessInitResponse.hardcoreAccessStatus);
    }
  }, [hardcoreAccessInitResponse, setAccess]);

  // Callback for when a purchase is made
  useEffect(() => {
    if (productPurchaseResponse != null) {
      setAccess(productPurchaseResponse.access);

      // Unlock hardcore view is only shown as a modal for regular mode. For hardcore posts, just
      // set to the play page
      if (game.mode === 'regular') {
        closeModal();
      } else if (game.mode === 'hardcore') {
        setPage('play');
      }
    }
  }, [productPurchaseResponse, setAccess, closeModal, game]);

  return (
    <hardcoreAccessContext.Provider value={{ access, setAccess }}>
      {props.children}
    </hardcoreAccessContext.Provider>
  );
};

export const useHardcoreAccess = () => {
  const ctx = useContext(hardcoreAccessContext);
  if (ctx == null) {
    throw new Error('useHardcoreAccess must be used within a HardcoreAccessContextProvider');
  }
  return ctx;
};
