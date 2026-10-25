import { useState } from 'preact/hooks';
import { showToast } from '@devvit/web/client';
import type { ClientGuessResult, GuessEngine } from '../core/guessEngine';
import { loadHintsForChallenge, selectNextHint } from '../core/hints';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { IconButton } from '../shared/button';
import { Modal } from '../shared/modal';
import { isLoggedOut } from '../shared/user';
import { trpc } from '../trpc';
import { navigate } from './state/navigation';
import { FlagIcon, HintIcon } from './icons';

export const HINT_GUESS_THRESHOLD = 5;
export const GIVE_UP_GUESS_THRESHOLD = 10;

export function GuessActions({
  engine,
  onHint,
}: {
  engine: GuessEngine | undefined;
  onHint: (
    result: Extract<ClientGuessResult, { ok: true }>,
    previousRank: number | undefined
  ) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [error, setError] = useState('');
  const count = engine?.history.value?.length ?? 0;
  const blocked = !engine || busy || engine.isSubmitting.value || Boolean(engine.solvedAtMs.value);
  const challengeNumber = requireChallengeNumber();
  const requestHint = async () => {
    if (!engine || blocked || count < HINT_GUESS_THRESHOLD) return;
    setBusy(true);
    try {
      const hints = await loadHintsForChallenge(challengeNumber);
      const history = engine.history.value ?? [];
      const next = selectNextHint({
        hintWords: hints,
        previousGuesses: history.map(({ word, rank }) => ({ word, rank })),
      });
      if (!next) {
        showToast({ text: 'No unused hints are available right now.' });
        return;
      }
      const previous = history.reduce<(typeof history)[number] | undefined>(
        (latest, guess) => (!latest || guess.timestamp >= latest.timestamp ? guess : latest),
        undefined
      );
      const result = await engine.submitHint(next.word);
      if (result.ok) onHint(result, previous?.rank);
      else showToast({ text: result.message });
    } catch {
      showToast({ text: 'Could not load a hint. Please try again.' });
    } finally {
      setBusy(false);
    }
  };
  const giveUp = async () => {
    if (blocked || count < GIVE_UP_GUESS_THRESHOLD) return;
    setBusy(true);
    setError('');
    try {
      if (!isLoggedOut()) await trpc.guess.giveUp.mutate({ challengeNumber });
      navigate('win');
    } catch {
      setError('Could not give up right now. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div
        className="mx-auto mb-1 flex w-full max-w-xl shrink-0 items-center justify-between gap-2"
        aria-label="Puzzle Help"
      >
        <IconButton
          iconOnly
          icon={<HintIcon />}
          aria-label="Hint"
          title={
            count < HINT_GUESS_THRESHOLD
              ? `Hint Unlocks After ${HINT_GUESS_THRESHOLD} Guesses`
              : 'Add a Hint Word · Each Hint Reduces Your Score by 30%'
          }
          disabled={blocked || count < HINT_GUESS_THRESHOLD}
          onClick={() => void requestHint()}
        >
          Hint
        </IconButton>
        <p className="text-center text-[10px] leading-snug text-gray-500 dark:text-gray-400">
          {count < HINT_GUESS_THRESHOLD
            ? `Hint After ${HINT_GUESS_THRESHOLD} Guesses`
            : 'Hint: −30% Score'}
          {count < GIVE_UP_GUESS_THRESHOLD && (
            <>
              <br />
              Give Up After {GIVE_UP_GUESS_THRESHOLD} Guesses
            </>
          )}
        </p>
        <IconButton
          iconOnly
          icon={<FlagIcon />}
          aria-label="Give Up"
          title={
            count < GIVE_UP_GUESS_THRESHOLD
              ? `Give Up Unlocks After ${GIVE_UP_GUESS_THRESHOLD} Guesses`
              : 'Give Up and Reveal the Answer'
          }
          disabled={blocked || count < GIVE_UP_GUESS_THRESHOLD}
          onClick={() => {
            setError('');
            setConfirmGiveUp(true);
          }}
        >
          Give Up
        </IconButton>
      </div>
      <Modal
        isOpen={confirmGiveUp}
        onClose={() => {
          if (!busy) setConfirmGiveUp(false);
        }}
        labelledBy="give-up-title"
      >
        <section className="w-[min(80vw,360px)] space-y-4 bg-white p-5 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
          <h2 id="give-up-title" className="text-lg font-bold">
            Give Up This Puzzle?
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            This reveals the answer and records a Give Up. Your existing guesses stay in your
            history.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold dark:border-gray-600"
              onClick={() => setConfirmGiveUp(false)}
            >
              Keep Playing
            </button>
            <button
              type="button"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-gray-900"
              onClick={() => void giveUp()}
            >
              <FlagIcon />
              {busy ? 'Revealing…' : 'Give Up and Reveal'}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          )}
        </section>
      </Modal>
    </>
  );
}
