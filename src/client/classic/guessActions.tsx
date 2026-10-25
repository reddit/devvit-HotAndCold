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
  if (!engine || engine.solvedAtMs.value || count < HINT_GUESS_THRESHOLD) return null;
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
          title="Add a Hint Word · Each Hint Reduces Your Score by 30%"
          disabled={blocked}
          onClick={() => void requestHint()}
        >
          Hint
        </IconButton>
        {count >= GIVE_UP_GUESS_THRESHOLD && (
          <button
            type="button"
            className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-gray-50 px-3 text-xs font-medium transition-colors hover:bg-gray-200 focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:outline-none dark:bg-black dark:hover:bg-gray-800"
            aria-label="Give Up"
            title="Give Up and Reveal the Answer"
            disabled={blocked}
            onClick={(event) => openPopup(event, 'give-up')}
          >
            <GiveUpIcon />
            <span>Give Up</span>
          </button>
        )}
      </div>
    </>
  );
}
