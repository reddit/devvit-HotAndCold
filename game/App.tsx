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
    case 'lose':
      return <WinPage />;
    default:
      throw new Error(`Unknown page: ${page satisfies never}`);
  }
};

export const App = () => {
  const page = usePage();

  return <div className="h-full p-2">{getPage(page)}</div>;
};
