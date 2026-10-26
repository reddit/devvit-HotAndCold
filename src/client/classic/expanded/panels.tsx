import { exitExpandedMode } from '@devvit/web/client';
import { useEffect, useRef, useState } from 'preact/hooks';
import { trpc } from '../../trpc';
import { requireChallengeNumber } from '../../requireChallengeNumber';
import { isLoggedOut } from '../../shared/user';
import { navigate } from '../state/navigation';
import { GiveUpIcon } from '../icons';
import { ScoreBreakdownDetails } from '../scoreBreakdownModal';
import { posthog } from '../../posthog';
import { flushPendingGuesses } from '../../core/guessEngine';

const button =
  'min-h-10 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-50 dark:border-gray-600';
const giveUpButton =
  'inline-flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-gray-300 px-2 py-2 text-sm font-semibold whitespace-nowrap disabled:opacity-50 dark:border-gray-600 [&>svg]:h-4 [&>svg]:w-4';

export function GiveUpPanel({
  onCancel = exitExpandedMode,
  onComplete,
  onBusyChange,
}: {
  onCancel?: (event: MouseEvent) => void;
  onComplete?: () => void;
  onBusyChange?: (busy: boolean) => void;
} = {}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const challengeNumber = requireChallengeNumber();
  return (
    <section className="space-y-4 text-sm">
      <p className="text-gray-600 dark:text-gray-300">
        This reveals the answer and records a Give Up. Your existing guesses stay in your history.
      </p>
      {done ? (
        <>
          <p role="status">Your results are ready.</p>
          <button className={button} onClick={exitExpandedMode}>
            View Results
          </button>
        </>
      ) : (
        <div className="grid grid-cols-2 items-stretch gap-2">
          <button disabled={busy} className={giveUpButton} onClick={onCancel}>
            Keep Playing
          </button>
          <button
            disabled={busy}
            aria-label="Give Up and Reveal"
            className={`${giveUpButton} bg-gray-900 text-white dark:bg-white dark:text-gray-900`}
            onClick={async () => {
              if (busyRef.current) return;
              busyRef.current = true;
              setBusy(true);
              onBusyChange?.(true);
              setError('');
              try {
                if (!isLoggedOut()) {
                  await flushPendingGuesses(challengeNumber);
                  await trpc.guess.giveUp.mutate({ challengeNumber });
                }
                // Navigation is shared through localStorage with the inline game.
                navigate('win');
                if (onComplete) onComplete();
                else setDone(true);
              } catch {
                setError('Could not give up right now. Please try again.');
              } finally {
                busyRef.current = false;
                setBusy(false);
                onBusyChange?.(false);
              }
            }}
          >
            {!busy && <GiveUpIcon />} {busy ? 'Revealing…' : 'Give Up'}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}

export function ScorePanel() {
  const [result, setResult] = useState<Awaited<ReturnType<typeof trpc.game.get.query>> | null>(
    null
  );
  const [error, setError] = useState('');
  useEffect(() => {
    void trpc.game.get
      .query({ challengeNumber: requireChallengeNumber() })
      .then(setResult)
      .catch(() => setError('Could not load your score. Close this view and try again.'));
  }, []);
  if (error) return <p role="alert">{error}</p>;
  if (!result) return <p role="status">Loading Your Score…</p>;
  if (!result.challengeUserInfo?.score) return <p>No score is available for this puzzle yet.</p>;
  return <ScoreBreakdownDetails score={result.challengeUserInfo.score} />;
}

export function CommentPanel() {
  const [comment, setComment] = useState('');
  const [suffix, setSuffix] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const challengeNumber = requireChallengeNumber();
  useEffect(() => {
    void trpc.cta.getCommentSuffix
      .query({ challengeNumber })
      .then((result) => setSuffix(result.suffix))
      .catch(() => {});
  }, [challengeNumber]);
  return (
    <section className="space-y-4 text-sm">
      {done ? (
        <>
          <p role="status">Your comment was posted.</p>
          <button className={button} onClick={exitExpandedMode}>
            Return to Game
          </button>
        </>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!comment.trim() || busy) return;
            setBusy(true);
            setError('');
            try {
              await trpc.cta.submitComment.mutate({ challengeNumber, comment: comment.trim() });
              posthog.capture('Win Page Comment Submit Clicked', { challengeNumber });
              setDone(true);
            } catch {
              setError('Could not post your comment. Your draft is still here; please try again.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-gray-600 dark:text-gray-300">
            Say something about your game. We'll post this as a comment on your behalf.
          </p>
          <label className="block font-semibold">
            Your Comment
            <textarea
              className="mt-2 min-h-36 w-full resize-y rounded-lg border border-gray-300 bg-white p-3 font-normal text-black focus:ring-2 focus:ring-cyan-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              value={comment}
              onInput={(event) => setComment(event.currentTarget.value)}
              placeholder="Share your word journey or strategy!"
              disabled={busy}
            />
          </label>
          {suffix && <p className="text-xs text-gray-500 dark:text-gray-400">{suffix}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={button} disabled={busy} onClick={exitExpandedMode}>
              Cancel
            </button>
            <button
              type="submit"
              className={`${button} bg-cyan-700 text-white`}
              disabled={!comment.trim() || busy}
            >
              {busy ? 'Posting…' : 'Post Comment'}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
