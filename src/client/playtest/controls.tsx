import { useRef, useState } from 'preact/hooks';
import { trpc } from '../trpc';
import { getActiveTestRun, notifyTestRunChanged, reloadTestRun } from './run';
import { exitExpandedMode } from '@devvit/web/client';
import { Modal } from '../shared/modal';

export function TestRunControls({ isSubmitting }: { isSubmitting: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const close = () => {
    if (!busyRef.current) setOpen(false);
  };
  if (!getActiveTestRun()) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Playtest Controls"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={isSubmitting}
        className="h-6 w-14 shrink-0 rounded-full border border-amber-300 bg-amber-50 text-[10px] font-semibold text-amber-950 focus-visible:outline-2 focus-visible:outline-amber-500 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        onClick={() => setOpen(true)}
      >
        Playtest
      </button>
      <Modal isOpen={open} onClose={close} closeDisabled={busy} labelledBy="playtest-title">
        <section className="w-[min(84vw,360px)] max-w-full space-y-3 rounded-2xl bg-white p-4 text-gray-900 shadow-xl dark:bg-gray-900 dark:text-gray-100">
          <h2 id="playtest-title" className="text-base font-bold">
            Playtest Controls
          </h2>
          <TestRunPanel
            onComplete={reloadTestRun}
            onBusyChange={(pending) => {
              busyRef.current = pending;
              setBusy(pending);
            }}
          />
        </section>
      </Modal>
    </>
  );
}

export function TestRunPanel({
  onComplete,
  onBusyChange,
}: {
  onComplete?: () => void;
  onBusyChange?: (busy: boolean) => void;
} = {}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const run = getActiveTestRun();
  if (!run) return null;
  const changeState = async (state: 'fresh' | 'solved') => {
    if (busyRef.current || done) return;
    busyRef.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      const next = await trpc.moderation.resetTestRun.mutate({
        state,
        expectedChallengeNumber: run.challengeNumber,
      });
      notifyTestRunChanged(next.challengeNumber);
      setDone(true);
      onComplete?.();
    } catch {
      setError('Could not change the test run. Reload and try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  };
  return (
    <section className="space-y-3 text-gray-900 dark:text-gray-100">
      <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm font-semibold text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
        Test Word: <span className="font-mono break-words">{run.word}</span>
      </p>
      <p className="text-xs text-gray-600 dark:text-gray-300">
        Disposable progress for your account. Daily puzzles and other testers are unaffected.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ['fresh', 'Reset Test Run'],
            ['solved', 'Jump to Solved'],
          ] as const
        ).map(([state, label]) => (
          <button
            type="button"
            key={state}
            className="min-h-10 min-w-0 rounded-lg border border-gray-300 px-2 py-2 text-xs font-semibold whitespace-nowrap disabled:opacity-50 dark:border-gray-600"
            disabled={busy || done}
            onClick={() => void changeState(state)}
          >
            {label}
          </button>
        ))}
      </div>
      {done && !onComplete && (
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
