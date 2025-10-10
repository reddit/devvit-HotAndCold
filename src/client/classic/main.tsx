import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import '../index.css';
import { createGuessEngine } from '../core/guessEngine';
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

initPosthog({ mode: 'classic' });

function AppContent({
  engine,
  challengeNumber,
  isAdmin,
}: {
  engine: GuessEngine;
  challengeNumber: number;
  isAdmin: boolean;
}) {
  return (
    <div className="h-[100dvh] min-h-[100dvh] w-full overflow-hidden">
      <div className="mx-auto flex max-w-2xl flex-col px-4 md:px-6 py-6 h-full min-h-0 overflow-hidden">
        <Header engine={engine} isAdmin={isAdmin} />
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
  const [isAdmin, setIsAdmin] = useState(false);
  const challengeNumber = requireChallengeNumber();

  const engine = useMemo(() => {
    return createGuessEngine({ challengeNumber });
  }, [challengeNumber]);

  // Initialize navigation from cached state – non-blocking
  useEffect(() => {
    initNavigation();
  }, []);

  useEffect(() => {
    posthog.capture('$pageview', {
      page: page.value,
    });
  }, [page.value]);

  // Register generic pointer down tracking (taps/clicks) relative to iframe viewport
  useEffect(() => {
    const handler = (event: PointerEvent) => {
      try {
        const viewportWidth =
          window.innerWidth ||
          document.documentElement.clientWidth ||
          document.body.clientWidth ||
          0;
        const viewportHeight =
          window.innerHeight ||
          document.documentElement.clientHeight ||
          document.body.clientHeight ||
          0;

        const xPixels = Math.max(0, Math.min(viewportWidth, event.clientX));
        const yPixels = Math.max(0, Math.min(viewportHeight, event.clientY));

        const xPercent = viewportWidth > 0 ? xPixels / viewportWidth : 0;
        const yPercent = viewportHeight > 0 ? yPixels / viewportHeight : 0;

        const target = event.target as HTMLElement | null;

        posthog.capture('Pointer Down', {
          page: page.value,
          x_px: xPixels,
          y_px: yPixels,
          width_px: viewportWidth,
          height_px: viewportHeight,
          x_pct: Math.round(xPercent * 1000) / 1000,
          y_pct: Math.round(yPercent * 1000) / 1000,
          pointer_type: event.pointerType,
          button: event.button,
          target_tag: target?.tagName?.toLowerCase() ?? null,
          target_id: target?.id || null,
        });
      } catch {
        // ignore
      }
    };
    window.addEventListener('pointerdown', handler, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', handler as any, { capture: true } as any);
    };
  }, []);

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
