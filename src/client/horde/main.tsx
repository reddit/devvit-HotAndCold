import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import '../index.css';
import { createGuessEngine } from '../core/guessEngine';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { Header } from './header';
import { page, initNavigation } from './state/navigation';
// import { WinPage } from './WinPage';
import { PlayPage } from './PlayPage';
import { HowToPlayModal } from './howToPlayModal';
import { ExperimentsModal } from './ExperimentsModal';
import { ErrorBoundary } from '../shared/error';
// import { initPosthog } from '../shared/useInitPosthog';
import posthog from 'posthog-js';
import { GUESS_SAMPLE_RATE } from '../config';
import type { GuessEngine } from '../core/guessEngine';
import { remountKey } from './state/experiments';
import { trpc } from '../trpc';
import { GuessTicker } from './ticker';
import { useHordeRealtime } from './state/realtime';
import { hordeGameUpdate, hordeWaveClear } from './state/realtime';

// initPosthog({ mode: 'horde' });

function AppContent({
  engine,
  challengeNumber,
  isAdmin,
}: {
  engine: GuessEngine;
  challengeNumber: number;
  isAdmin: boolean;
}) {
  useHordeRealtime(challengeNumber);
  const status = hordeGameUpdate.value?.hordeStatus ?? 'running';
  const waveOverlay = hordeWaveClear.value;
  // Wave & timer moved to Header

  const renderStatusView = () => {
    if (status === 'running') return <PlayPage engine={engine} />;
    if (status === 'won')
      return (
        <div className="mx-auto my-8 flex w-full max-w-xl flex-col items-center gap-3 text-center">
          <p className="text-xl font-semibold">Horde Cleared!</p>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Great work. Waiting for the next horde challenge.
          </p>
        </div>
      );
    if (status === 'lost')
      return (
        <div className="mx-auto my-8 flex w-full max-w-xl flex-col items-center gap-3 text-center">
          <p className="text-xl font-semibold">Time’s Up</p>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            The horde fell this time. Try again soon.
          </p>
        </div>
      );
    return <PlayPage engine={engine} />;
  };
  return (
    <div className="h-[100dvh] min-h-[100dvh] w-full overflow-hidden">
      <div className="mx-auto flex max-w-2xl flex-col px-4 md:px-6 py-6 h-full min-h-0 overflow-hidden">
        {waveOverlay && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <div className="mx-auto w-full max-w-md rounded-lg bg-white p-4 text-center shadow-lg dark:bg-gray-800">
              <p className="text-lg font-semibold text-gray-900 dark:text-white">
                {waveOverlay.isFinalWave ? 'Horde Cleared!' : 'Wave Cleared!'}
              </p>
              <div className="mt-3 flex flex-col items-center gap-2">
                <img
                  src={waveOverlay.winnerSnoovatar || '/assets/default_snoovatar.png'}
                  className="h-12 w-12 rounded-full border border-gray-300 dark:border-gray-600 object-contain"
                />
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {waveOverlay.winner} found “{waveOverlay.word}”
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {waveOverlay.isFinalWave
                    ? 'All waves cleared! Claiming victory…'
                    : 'Next wave starting…'}
                </p>
              </div>
            </div>
          </div>
        )}
        <Header engine={engine} isAdmin={isAdmin} />
        <div className="relative mx-auto w-full max-w-xl mb-2">
          <GuessTicker />
        </div>
        {renderStatusView()}
        <HowToPlayModal />
        <ExperimentsModal />
      </div>
    </div>
  );
}

export function App() {
  const [isAdmin, setIsAdmin] = useState(false);
  const challengeNumber = requireChallengeNumber();
  const currentWave = hordeGameUpdate.value?.currentHordeWave ?? 1;

  const engine = useMemo(() => {
    return createGuessEngine({
      challengeNumber,
      mode: 'horde',
      waveId: currentWave,
    });
  }, [challengeNumber, currentWave]);

  // Initialize navigation from cached state – non-blocking
  useEffect(() => {
    initNavigation();
  }, []);

  useEffect(() => {
    posthog.capture('$pageview', {
      page: page.value,
    });
  }, [page.value]);

  useEffect(() => {
    const fetchIsAdmin = async () => {
      try {
        const isAdmin = await trpc.user.isAdmin.query();

        // Only set if true to save on event cost
        if (isAdmin) {
          posthog.setPersonProperties({
            is_admin: isAdmin,
          });
        }

        setIsAdmin(isAdmin);
      } catch (error) {
        console.error('Error getting admin status', error);
      }
    };
    void fetchIsAdmin();
  }, [setIsAdmin]);

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

  return (
    <AppContent
      key={remountKey.value}
      engine={engine}
      challengeNumber={challengeNumber}
      isAdmin={isAdmin}
    />
  );
}

render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
  document.getElementById('root')!
);
