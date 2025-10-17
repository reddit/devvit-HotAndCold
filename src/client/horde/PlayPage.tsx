import { useMemo, useState } from 'preact/hooks';
import { WordInput } from '../shared/wordInput';
import { Guesses } from '../shared/guesses';
import type { GuessItem } from '../shared/guesses';
import type { GuessEngine, GuessHistoryItem } from '../core/guessEngine';
import { formatOrdinal } from '../../shared/ordinal';
import { formatCompactNumber } from '../../shared/formatCompactNumber';
import { context } from '@devvit/web/client';
import { openHowToPlay } from './state/howToPlay';
import posthog from 'posthog-js';
import { hordeTickerGuesses } from './state/realtime';

export function PlayPage({ engine }: { engine?: GuessEngine }) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const { items, latest } = useMemo(() => {
    const itemsSignal = engine ? engine.history : null;
    const arr = itemsSignal ? (itemsSignal.value ?? []) : [];
    const last = arr.length > 0 ? arr.reduce((a, b) => (a.timestamp > b.timestamp ? a : b)) : null;
    return { items: itemsSignal, latest: last } as const;
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
  const communityItems: GuessItem[] = useMemo(() => {
    return (hordeTickerGuesses.value ?? []).map((g) => ({
      word: g.username ? `${g.username}: ${g.word}` : g.word,
      similarity: g.similarity,
      rank: Number.isFinite(g.rank) ? (g.rank as number) : -1,
      timestamp: Number.isFinite(g.atMs) ? (g.atMs as number) : Date.now(),
    }));
  }, [hordeTickerGuesses.value]);

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="relative mx-auto w-full max-w-xl pb-4">
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
          className="mt-2"
        />
        {feedback && (
          <p className="pointer-events-none absolute left-0 bottom-[7px] text-[10px] dark:text-zinc-300">
            {feedback}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:gap-6 min-h-0 flex-1">
        <section className="flex min-h-0 flex-col flex-1">
          <h2 className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200">
            Your guesses
          </h2>
          <div className="flex-1 min-h-0 rounded-md">
            {items?.value?.length ? (
              <Guesses items={items as any} latest={latest} />
            ) : (
              <div className="flex h-full min-h-0 items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-center">
                  <p className="text-sm dark:text-gray-400 text-gray-600">
                    {totalPlayers > 0
                      ? `${solveRatePct}% of ${formatCompactNumber(totalPlayers)} players have succeeded`
                      : "You're the first to play!"}
                  </p>
                  <button
                    className={
                      'text-sm rounded-md px-4 py-2 cursor-pointer bg-gray-200 text-black hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600'
                    }
                    onClick={() => {
                      posthog.capture('Game Page How to Play Button Below Input Clicked');
                      openHowToPlay();
                    }}
                  >
                    How to Play
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col">
          <h2 className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200">
            Community stream
          </h2>
          <div className="flex-1 min-h-0 rounded-md">
            {communityItems.length > 0 ? (
              <Guesses items={communityItems} />
            ) : (
              <div className="flex h-full min-h-0 items-center justify-center">
                <p className="text-sm text-gray-600 dark:text-gray-400">Waiting for guesses…</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default PlayPage;
