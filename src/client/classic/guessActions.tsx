import { useState } from 'preact/hooks';
import { showToast } from '@devvit/web/client';
import type { ClientGuessResult, GuessEngine } from '../core/guessEngine';
import { loadHintsForChallenge, selectNextHint } from '../core/hints';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { IconButton } from '../shared/button';
import { openPopup } from './expanded/launch';
import { GiveUpIcon, HintIcon } from './icons';

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
        <button
          type="button"
          className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-gray-50 px-3 text-xs font-medium transition-colors hover:bg-gray-200 focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:outline-none dark:bg-black dark:hover:bg-gray-800"
          aria-label="Give Up"
          title={
            count < GIVE_UP_GUESS_THRESHOLD
              ? `Give Up Unlocks After ${GIVE_UP_GUESS_THRESHOLD} Guesses`
              : 'Give Up and Reveal the Answer'
          }
          disabled={blocked || count < GIVE_UP_GUESS_THRESHOLD}
          onClick={(event) => openPopup(event, 'give-up')}
        >
          <GiveUpIcon />
          <span>Give Up</span>
        </button>
      </div>
    </>
  );
}
