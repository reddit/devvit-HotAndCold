import { createContext, useContext, useState } from 'react';
import { Page } from '../shared';

const PageContext = createContext<Page | null>(null);
const PageUpdaterContext = createContext<React.Dispatch<React.SetStateAction<Page>> | null>(null);

export const PageContextProvider = ({ children }: { children: React.ReactNode }) => {
  const [page, setPage] = useState<Page>('play');

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
