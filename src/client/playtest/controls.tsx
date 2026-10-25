import { useState } from 'preact/hooks';
import { trpc } from '../trpc';
import { getActiveTestRun } from './run';

export function TestRunControls({ isSubmitting }: { isSubmitting: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = getActiveTestRun();
  if (!run) return null;
  const changeState = async (state: 'fresh' | 'solved') => {
    setBusy(true);
    setError('');
    try {
      await trpc.moderation.resetTestRun.mutate({
        state,
        expectedChallengeNumber: run.challengeNumber,
      });
      window.location.reload();
    } catch {
      setError('Could not change the test run. Reload and try again.');
      setBusy(false);
    }
  };
  return (
    <aside className="mb-3 shrink-0 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          Playtest Only · Test Word: <span className="font-mono">{run.word}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['fresh', 'Reset My Test Run'],
              ['solved', 'Jump to Solved'],
            ] as const
          ).map(([state, label]) => (
            <button
              key={state}
              className="rounded-lg border border-amber-400 px-3 py-1.5 font-semibold disabled:opacity-50 dark:border-amber-700"
              disabled={busy || isSubmitting}
              onClick={() => void changeState(state)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2">
        Disposable progress for your account. Daily puzzles and other testers are unaffected.
      </p>
      {error && (
        <p role="alert" className="mt-2">
          {error}
        </p>
      )}
    </aside>
  );
}
