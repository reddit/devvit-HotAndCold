import { render } from 'preact';
import { useEffect, useMemo } from 'preact/hooks';
import '../index.css';
import { createGuessEngine } from '../core/guessEngine';
// import { context } from '@devvit/web/client';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { Header } from './header';
import { page, initNavigation } from './state/navigation';
import { WinPage } from './WinPage';
import { Progress } from './Progress';
import { PlayPage } from './PlayPage';

export function App() {
  const challengeNumber = requireChallengeNumber();

  const engine = useMemo(() => {
    return createGuessEngine({ challengeNumber: Number(challengeNumber) });
  }, [challengeNumber]);

  // Initialize navigation from cached state – non-blocking
  useEffect(() => {
    initNavigation();
  }, []);

  return (
    <div className="h-[100dvh] min-h-[100dvh] w-full overflow-hidden">
      <div className="mx-auto flex max-w-2xl flex-col p-6 h-full min-h-0 overflow-hidden">
        <Header engine={engine} />
        {page.value === 'win' ? <WinPage /> : <PlayPage engine={engine} />}
        <div className="relative mx-auto w-full max-w-xl">
          <Progress challengeNumber={Number(challengeNumber)} engine={engine} />
        </div>
      </div>
    </div>
  );
}

render(<App />, document.getElementById('root')!);
