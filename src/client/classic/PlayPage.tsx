import { useMemo, useRef, useState } from 'preact/hooks';
import { WordInput } from '../shared/wordInput';
import { Guesses } from '../shared/guesses';
import { rankToProgress } from '../../shared/progress';
import type { GuessEngine, GuessHistoryItem } from '../core/guessEngine';

export function PlayPage({ engine }: { engine?: GuessEngine }) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const { items, itemsArray, latest } = useMemo(() => {
    const itemsSignal = engine ? engine.history : null;
    const arr = itemsSignal ? (itemsSignal.value ?? []) : [];
    const last = arr.length > 0 ? arr.reduce((a, b) => (a.timestamp > b.timestamp ? a : b)) : null;
    return { items: itemsSignal, itemsArray: arr, latest: last } as const;
  }, [engine, engine?.history.value]);

  const shownTipsRef = useRef<Record<string, boolean>>({});

  const computeHeat = (rank: number) => {
    const pct = Math.round(rankToProgress(rank));
    if (pct >= 100) return 'CORRECT' as const;
    if (pct >= 80) return 'HOT' as const;
    if (pct >= 40) return 'WARM' as const;
    return 'COLD' as const;
  };

  const getStreak = (arr: GuessHistoryItem[], target: 'COLD' | 'WARM' | 'HOT') => {
    let count = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      const h = computeHeat(arr[i]!.rank);
      if (h === target || (target === 'WARM' && h === 'HOT')) count++;
      else break;
    }
    return count;
  };

  const generateOnboarding = (arr: GuessHistoryItem[]): string | null => {
    if (!arr || arr.length === 0) return null;
    const MESSAGES = [
      'Guess related words to the secret. Closer is better.',
      'Rank is compared to all possible words. Lower is better.',
      'Guess as many times as you need!',
    ] as const;

    // Show messages sequentially for first five guesses
    const idx = Math.min(arr.length, 5) - 1; // 0..4
    return MESSAGES[idx] ?? null;
  };

  return (
    <>
      <h1 className="text-center text-2xl font-bold">Guesses: {itemsArray.length}</h1>
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
          <p className="pointer-events-none absolute left-4 bottom-[7px] pr-24 text-xs dark:text-zinc-300">
            {feedback}
          </p>
        )}
      </div>
      {items && <Guesses items={items as any} latest={latest} />}
    </>
  );
}

export default PlayPage;
