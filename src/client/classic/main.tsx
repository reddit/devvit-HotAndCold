import { render } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import '../index.css';
import { createGuessEngine } from '../core/guessEngine';
// import { context } from '@devvit/web/client';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { Header } from './header';
import { page, initNavigation } from './state/navigation';
import { WinPage } from './WinPage';
import { Progress } from './Progress';
import { PlayPage } from './PlayPage';
import { HowToPlayModal } from './howToPlayModal';
import { ExperimentsModal } from './ExperimentsModal';
import { ErrorBoundary } from '../shared/error';
import { initPosthog } from './useInitPosthog';
import posthog from 'posthog-js';
import { GUESS_SAMPLE_RATE } from '../config';
import type { GuessEngine } from '../core/guessEngine';
import { remountKey } from './state/experiments';
import { trpc } from '../trpc';
import { setIsAdmin } from './state/admin';
import { context } from '@devvit/web/client';

function AppContent({ engine, challengeNumber }: { engine: GuessEngine; challengeNumber: number }) {
  return (
    <div className="h-[100dvh] min-h-[100dvh] w-full overflow-hidden">
      <div className="mx-auto flex max-w-2xl flex-col px-4 md:px-6 py-6 h-full min-h-0 overflow-hidden">
        <Header engine={engine} />
        {page.value === 'win' ? <WinPage /> : <PlayPage engine={engine} />}
        <div className="relative mx-auto w-full max-w-xl">
          <Progress challengeNumber={Number(challengeNumber)} engine={engine} />
        </div>
        <HowToPlayModal />
        <ExperimentsModal />
      </div>
    </div>
  );
}

export function App() {
  const challengeNumber = requireChallengeNumber();

  const engine = useMemo(() => {
    return createGuessEngine({ challengeNumber });
  }, [challengeNumber]);

  // Initialize navigation from cached state – non-blocking
  useEffect(() => {
    initNavigation();
  }, []);

  // Initialize PostHog on first guess to avoid tracking page impressions
  const previousGuessCount = useRef(0);

  useEffect(() => {
    if (!engine?.history.value) return;

    const historyLength = engine.history.value.length;
    // Only initialize PostHog when going from 0 to 1 guess (first guess only)
    if (historyLength > 0 && previousGuessCount.current === 0) {
      console.log('Initializing Posthog due to first guess or reloading a page with guesses');
      initPosthog({ mode: 'classic' });
    }
    previousGuessCount.current = historyLength;
  }, [engine?.history.value]);

  // Capture every 10th guess, based solely on history length changes.
  // Edge cases respected:
  // 1) If the user refreshes at a multiple of 10, do nothing (no transition detected).
  // 2) First ever guess (transition 0 -> 1) is ignored here; PostHog init already handled.
  // 3) If the user already won, do not capture.
  const previousLengthForSample = useRef<number | null>(null);
  useEffect(() => {
    const historyLength = engine?.history.value?.length ?? 0;
    const prev = previousLengthForSample.current;

    // Skip initial mount: set baseline and exit
    if (prev === null) {
      previousLengthForSample.current = historyLength;
      return;
    }

    // Only react to single-increment transitions to avoid firing on hydration (e.g., 0 -> N)
    if (historyLength === prev + 1) {
      try {
        const last = engine?.history.value?.[engine.history.value.length - 1];
        if (last && last.similarity === 1) {
          // Win captured exactly when the winning guess is appended to history
          posthog.capture('Solved Word', {
            challengeNumber,
            word: last.word,
            rank: Number.isFinite(last.rank) ? last.rank : null,
            totalGuesses: historyLength,
          });
        }
      } catch {
        // swallow
      }

      const solvedAt = engine?.solvedAtMs?.value ?? null;
      if (!solvedAt && historyLength > 0 && historyLength % GUESS_SAMPLE_RATE === 0) {
        try {
          console.log('Sampling guess!');
          const last = engine?.history.value?.[engine.history.value.length - 1];
          // Compute rank stats
          const allHistory = engine?.history.value ?? [];
          const allRanks = allHistory
            .map((i) => i.rank)
            .filter((r) => Number.isFinite(r) && (r as number) > 0) as number[];
          const averageRank = allRanks.length
            ? allRanks.reduce((sum, r) => sum + r, 0) / allRanks.length
            : null;
          const medianOf = (sorted: number[]): number | null => {
            const len = sorted.length;
            if (len === 0) return null;
            const mid = Math.floor(len / 2);
            return len % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
          };
          const medianRank = medianOf([...allRanks].sort((a, b) => a - b));

          const lastNWindow = allHistory.slice(Math.max(0, allHistory.length - GUESS_SAMPLE_RATE));
          const lastNRanks = lastNWindow
            .map((i) => i.rank)
            .filter((r) => Number.isFinite(r) && (r as number) > 0) as number[];
          const averageRankLastN = lastNRanks.length
            ? lastNRanks.reduce((sum, r) => sum + r, 0) / lastNRanks.length
            : null;
          const medianRankLastN = medianOf([...lastNRanks].sort((a, b) => a - b));
          posthog.capture('Guessed Word', {
            challengeNumber,
            word: last?.word,
            similarity: last?.similarity,
            rank: last?.rank ?? null,
            currentGuessCount: historyLength,
            sampleRate: GUESS_SAMPLE_RATE,
            medianRank,
            averageRank,
            medianRankLastN,
            averageRankLastN,
          });
        } catch {
          // swallow
        }
      }
    }

    previousLengthForSample.current = historyLength;
  }, [engine?.history.value, engine?.solvedAtMs?.value, challengeNumber]);

  useEffect(() => {
    const fetchIsAdmin = async () => {
      if (context.userId) {
        const value = await trpc.isAdmin.query();
        setIsAdmin(value);
      }
    };
    void fetchIsAdmin();
  }, []);

  return <AppContent key={remountKey.value} engine={engine} challengeNumber={challengeNumber} />;
}

render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
  document.getElementById('root')!
);
