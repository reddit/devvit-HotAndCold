import { useMemo, useState } from 'preact/hooks';
import { WordInput } from '../shared/wordInput';
import { Guesses } from '../shared/guesses';
import type { GuessEngine, GuessHistoryItem } from '../core/guessEngine';
import { formatOrdinal } from '../../shared/ordinal';
import { experiments } from '../../shared/experiments/experiments';
import { formatCompactNumber } from '../../shared/formatCompactNumber';
import { context } from '@devvit/web/client';
import { openHowToPlay } from './state/howToPlay';
import posthog from 'posthog-js';

export function PlayPage({ engine }: { engine?: GuessEngine }) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const useNewSplash =
    experiments.evaluate(context.userId ?? '', 'exp_new_splash').treatment === 'new';

  const { items, itemsArray, latest } = useMemo(() => {
    const itemsSignal = engine ? engine.history : null;
    const arr = itemsSignal ? (itemsSignal.value ?? []) : [];
    const last = arr.length > 0 ? arr.reduce((a, b) => (a.timestamp > b.timestamp ? a : b)) : null;
    return { items: itemsSignal, itemsArray: arr, latest: last } as const;
  }, [engine, engine?.history.value]);

  // const computeHeat = (rank: number) => {
  //   const pct = Math.round(rankToProgress(rank));
  //   if (pct >= 100) return 'CORRECT' as const;
  //   if (pct >= 80) return 'HOT' as const;
  //   if (pct >= 40) return 'WARM' as const;
  //   return 'COLD' as const;
  // };

  const generateOnboarding = (arr: GuessHistoryItem[]): string | null => {
    if (!arr || arr.length === 0) return null;
    const MESSAGES = [
      `"${arr[0]!.word}" is the ${formatOrdinal(arr[0]!.rank)} closest. Smaller number = closer.`,
      'Keep guessing! Try as many as you want.',
      "Try to get under 1000. That's when it gets interesting!",
      'Stuck? Grab a hint from the menu.',
    ] as const;

    // Show messages sequentially for first five guesses
    const idx = Math.min(arr.length, 5) - 1; // 0..4
    return MESSAGES[idx] ?? null;
  };

  const totalPlayers = Number(context.postData?.totalPlayers ?? 0);
  const totalSolves = Number(context.postData?.totalSolves ?? 0);
  const solveRatePct = totalPlayers > 0 ? Math.round((totalSolves / totalPlayers) * 100) : 0;

  return (
    <>
      {useNewSplash ? (
        <h1 className="text-center text-2xl font-bold">
          {useNewSplash ? 'Can you guess the secret word?' : `Guesses: ${itemsArray.length}`}
        </h1>
      ) : (
        <h1 className="text-center text-2xl font-bold">Guesses: {itemsArray.length}</h1>
      )}

      <div className="relative mx-auto w-full max-w-xl pb-6">
        <WordInput
          placeholders={['Try banana', 'Try apple', 'Try pizza']}
          isHighContrast
          submitGuess={async (word) => {
            if (!engine) return null;
            const res = await engine.submit(word);
            if (res.ok) {
              const historyNow = engine.history.value ?? [];
              const msg = generateOnboarding(historyNow as GuessHistoryItem[]);
              setFeedback(msg);
            } else {
              setFeedback(res.message);
            }
            return res;
          }}
          onFeedback={(msg) => setFeedback(msg)}
          className="mt-4"
        />
        {feedback && (
          <p className="pointer-events-none absolute left-0 bottom-[7px] text-[10px] dark:text-zinc-300">
            {feedback}
          </p>
        )}
      </div>
      {useNewSplash ? (
        items?.value?.length ? (
          <Guesses items={items as any} latest={latest} />
        ) : (
          <div className="flex flex-1 min-h-0 flex-col gap-4 items-center">
            <p className="text-sm text-gray-400">
              {totalPlayers > 0
                ? `${solveRatePct}% of ${formatCompactNumber(totalPlayers)} players have succeeded`
                : "You're the first to play!"}
            </p>
            <button
              className={'text-sm bg-gray-700 rounded-md px-4 py-2 cursor-pointer'}
              onClick={() => {
                posthog.capture('Game Page How to Play Button Below Input Clicked');

                openHowToPlay();
              }}
            >
              How to Play
            </button>
          </div>
        )
      ) : (
        items && <Guesses items={items as any} latest={latest} />
      )}
    </>
  );
}

export default PlayPage;
