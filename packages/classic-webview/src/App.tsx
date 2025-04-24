import { PlayPage } from './pages/PlayPage';
import { StatsPage } from './pages/StatsPage';
import { WinPage } from './pages/WinPage';
import { usePage } from './hooks/usePage';
import { Progress } from './components/progress';
import { useGame } from './hooks/useGame';
import { cn } from '@hotandcold/webview-common/utils';
import { Header } from './components/header';
import { LoadingPage } from './pages/LoadingPage';
import { UnlockHardcorePage } from './pages/UnlockHardcorePage';

export const App = () => {
  const page = usePage();
  const { mode } = useGame();

  switch (page) {
    case 'play':
      return (
        <BasePageLayout hardcore={mode === 'hardcore'}>
          <PlayPage />
        </BasePageLayout>
      );
    case 'stats':
      return (
        <BasePageLayout hardcore={mode === 'hardcore'}>
          <StatsPage />
        </BasePageLayout>
      );
    case 'win':
      return (
        <BasePageLayout hardcore={mode === 'hardcore'}>
          <WinPage />
        </BasePageLayout>
      );
    case 'loading':
      return (
        <BasePageLayout hardcore={mode === 'hardcore'}>
          <LoadingPage />;
        </BasePageLayout>
      );
    case 'unlock-hardcore':
      return <UnlockHardcorePage />;
    default:
      throw new Error(`Invalid page: ${String(page satisfies never)}`);
  }
};

type BasePageLayoutProps = {
  hardcore: boolean;
  children: React.ReactNode;
};

const BasePageLayout = (props: BasePageLayoutProps) => {
  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 flex-1 flex-col p-6',
        props.hardcore &&
          'bg-[url(/assets/hardcore_background.png)] bg-cover bg-center bg-no-repeat bg-blend-multiply'
      )}
    >
      <div className="mb-4 sm:mb-6">
        <Header />
      </div>
      {props.children}
      <Progress />
    </div>
  );
};
