import { HardcoreAccessStatus } from '@hotandcold/classic-shared';
import { createContext, useContext } from 'react';
import { useAppState } from './useAppState';

type HardcoreAccessContext = {
  access: HardcoreAccessStatus;
  setAccess: (a: HardcoreAccessStatus) => void;
};

const hardcoreAccessContext = createContext<HardcoreAccessContext | null>(null);

export const HardcoreAccessContextProvider = (props: { children: React.ReactNode }) => {
  const { appState, setAccess } = useAppState();

  return (
    <hardcoreAccessContext.Provider
      value={{
        access: appState.hardcoreAccess,
        setAccess,
      }}
    >
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
