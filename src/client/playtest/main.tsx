import { render } from 'preact';
import '../index.css';
import { trpc } from '../trpc';
import { reloadTestRun, setActiveTestRun, watchTestRunChanges } from './run';

async function start() {
  try {
    // Resolve this player's current run before importing navigation or the game
    // engine. Reloading after a reset cannot hydrate a previous run's caches.
    setActiveTestRun(await trpc.moderation.testRun.query());
    watchTestRunChanges(reloadTestRun);
    await import('../classic/main');
  } catch {
    render(
      <main className="flex h-[100dvh] flex-col items-center justify-center gap-3 p-6 text-center dark:bg-gray-950 dark:text-white">
        <h1 className="text-xl font-bold">Playtest Access Required</h1>
        <p className="max-w-sm text-sm">
          This disposable test post is available to community moderators using a playtest build.
        </p>
        <button className="rounded-lg border px-4 py-2" onClick={() => window.location.reload()}>
          Try Again
        </button>
      </main>,
      document.getElementById('root')!
    );
  }
}

void start();
