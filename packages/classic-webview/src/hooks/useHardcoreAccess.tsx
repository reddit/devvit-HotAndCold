import { HardcoreAccessStatus } from '@hotandcold/classic-shared';
import { createContext, useContext, useEffect, useState } from 'react';
import { useDevvitListener } from './useDevvitListener';
import { useModal } from './useModal';
import { useGame } from './useGame';

type HardcoreAccessContext = {
  access: HardcoreAccessStatus;
  setAccess: (a: HardcoreAccessStatus) => void;
};

const hardcoreAccessContext = createContext<HardcoreAccessContext | null>(null);

export const HardcoreAccessContextProvider = (props: { children: React.ReactNode }) => {
  const [access, setAccess] = useState<HardcoreAccessStatus>({ status: 'inactive' });
  const hardcoreAccessInitResponse = useDevvitListener('HARDCORE_ACCESS_INIT_RESPONSE');
  const productPurchaseResponse = useDevvitListener('PURCHASE_PRODUCT_SUCCESS_RESPONSE');
  const { closeModal } = useModal();
  const game = useGame();

  useEffect(() => {
    if (hardcoreAccessInitResponse?.hardcoreAccessStatus != null) {
      setAccess(hardcoreAccessInitResponse.hardcoreAccessStatus);
    }
  }, [hardcoreAccessInitResponse, setAccess]);

  // Callback for when a purchase is made
  useEffect(() => {
    if (productPurchaseResponse != null) {
      setAccess(productPurchaseResponse.access);
      // Close the "Unlock Hardcore" modal in regular mode.
      // For hardcore mode, we rely on the `pageContextProvider` to
      // listen for `access` changes and update the page accordingly
      if (game.mode === 'regular') {
        closeModal();
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
