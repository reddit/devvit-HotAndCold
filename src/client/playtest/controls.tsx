import { useState } from 'preact/hooks';
import { trpc } from '../trpc';
import { getActiveTestRun } from './run';
import { exitExpandedMode } from '@devvit/web/client';
import { openPopup } from '../classic/expanded/launch';
import { notifyTestRunChanged } from './run';

export function TestRunControls({ isSubmitting }: { isSubmitting: boolean }) {
  if (!getActiveTestRun()) return null;
  return (
    <button
      type="button"
      aria-label="Playtest Controls"
      aria-haspopup="dialog"
      disabled={isSubmitting}
      className="h-6 w-14 shrink-0 rounded-full border border-amber-300 bg-amber-50 text-[10px] font-semibold text-amber-950 focus-visible:outline-2 focus-visible:outline-amber-500 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
      onClick={(event) => openPopup(event, 'playtest-controls')}
    >
      Playtest
    </button>
  );
}

export function TestRunPanel() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const run = getActiveTestRun();
  if (!run) return null;
  const changeState = async (state: 'fresh' | 'solved') => {
    setBusy(true);
    setError('');
    try {
      const next = await trpc.moderation.resetTestRun.mutate({
        state,
        expectedChallengeNumber: run.challengeNumber,
      });
      notifyTestRunChanged(next.challengeNumber);
      setDone(true);
      setBusy(false);
    } catch {
      setError('Could not change the test run. Reload and try again.');
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4 bg-white p-4 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
        Test Word: <span className="font-mono">{run.word}</span>
      </p>
      <p className="text-xs text-gray-600 dark:text-gray-300">
        Disposable progress for your account. Daily puzzles and other testers are unaffected.
      </p>
      <div className="grid gap-2">
        {(
          [
            ['fresh', 'Reset My Test Run'],
            ['solved', 'Jump to Solved'],
          ] as const
        ).map(([state, label]) => (
          <button
            type="button"
            key={state}
            className="min-h-10 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold disabled:opacity-50 dark:border-gray-600"
            disabled={busy || done}
            onClick={() => void changeState(state)}
          >
            {label}
          </button>
        ))}
      </div>
      {done && (
        <div className="space-y-3">
          <p role="status">Your test run is ready. Return to the game to continue.</p>
          <button
            className="rounded-lg border px-4 py-2 text-sm font-semibold"
            onClick={exitExpandedMode}
          >
            Return to Game
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
