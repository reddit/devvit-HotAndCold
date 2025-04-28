import { createContext, useContext } from 'react';
import { Game } from '@hotandcold/classic-shared';
import { useAppState } from './useAppState';

const GameContext = createContext<Partial<Game>>({});
// foo to trigger rebuild
export const GameContextProvider = ({ children }: { children: React.ReactNode }) => {
  const { appState } = useAppState();

  return <GameContext.Provider value={appState.game}>{children}</GameContext.Provider>;
};

export const useGame = () => {
  const context = useContext(GameContext);
  if (context === null) {
    throw new Error('useGame must be used within a GameContextProvider');
  }
  return context;
};
