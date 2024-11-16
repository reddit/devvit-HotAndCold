import { Page } from './shared';
import { SplashPage } from './pages/SplashPage';
import { PlayPage } from './pages/PlayPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { StatsPage } from './pages/StatsPage';
import { WinPage } from './pages/WinPage';
import { usePage } from './hooks/usePage';

const getPage = (page: Page) => {
  switch (page) {
    case 'splash':
      return <SplashPage />;
    case 'play':
      return <PlayPage />;
    case 'leaderboard':
      return <LeaderboardPage />;
    case 'stats':
      return <StatsPage />;
    case 'win':
      return <WinPage />;
  }
};

export const App = () => {
  const page = usePage();

  return <div>{getPage(page)}</div>;
};
