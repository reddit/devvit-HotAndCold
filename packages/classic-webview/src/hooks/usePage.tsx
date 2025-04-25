import { createContext, useContext, useState } from 'react';
import { Page } from '@hotandcold/classic-shared';
import { GAME_INIT_DATA } from '../utils/initListener';

const PageContext = createContext<Page | null>(null);
const PageUpdaterContext = createContext<React.Dispatch<React.SetStateAction<Page>> | null>(null);

export const PageContextProvider = ({ children }: { children: React.ReactNode }) => {
  const [page, setPage] = useState<Page>(() => {
    if (!GAME_INIT_DATA) {
      return 'loading';
    }

    // Keep in sync with useGame's use effect
    if (
      GAME_INIT_DATA.challengeUserInfo?.solvedAtMs ||
      GAME_INIT_DATA.challengeUserInfo?.gaveUpAtMs
    ) {
      return 'win';
    }

    if (
      GAME_INIT_DATA.mode === 'hardcore' &&
      GAME_INIT_DATA.hardcoreModeAccess.status === 'inactive'
    ) {
      return 'unlock-hardcore';
    }

    return 'play';
  });

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
