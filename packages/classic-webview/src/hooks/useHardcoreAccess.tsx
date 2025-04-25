import { HardcoreAccessStatus } from '@hotandcold/classic-shared';
import { createContext, useContext, useEffect, useState } from 'react';
import { useDevvitListener } from './useDevvitListener';

type HardcoreAccessContext = {
  access: HardcoreAccessStatus;
  setAccess: (a: HardcoreAccessStatus) => void;
};

const hardcoreAccessContext = createContext<HardcoreAccessContext | null>(null);

export const HardcoreAccessContextProvider = (props: { children: React.ReactNode }) => {
  const [access, setAccess] = useState<HardcoreAccessStatus>({ status: 'inactive' });
  const initGameResponse = useDevvitListener('GAME_INIT_RESPONSE');
  const productPurchaseResponse = useDevvitListener('PURCHASE_PRODUCT_SUCCESS_RESPONSE');

  useEffect(() => {
    if (initGameResponse != null) {
      setAccess(initGameResponse.hardcoreModeAccess);
    }
  }, [initGameResponse, setAccess]);

  useEffect(() => {
    if (productPurchaseResponse != null) {
      setAccess(productPurchaseResponse.access);
    }
  }, [productPurchaseResponse, setAccess]);

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
