import { useEffect, useRef } from 'preact/hooks';
import { Modal } from '../shared/modal';
import { SecondaryButton } from '../shared/button';
import { trpc } from '../trpc';
import type { ArchiveChallengeStatus, ArchiveChallengeSummary } from '../../shared/archive';
import {
  archiveOpen,
  closeArchive,
  archiveEntries,
  archiveNextCursor,
  archiveInitialized,
  archiveLoading,
  archiveError,
  archiveShowUnsolvedOnly,
  toggleArchiveShowUnsolved,
} from './state/archive';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { cn } from '../utils/cn';
import { formatCompactNumber } from '../../shared/formatCompactNumber';
import posthog from 'posthog-js';
import { navigateTo } from '@devvit/web/client';

const STATUS_LABEL: Record<ArchiveChallengeStatus, string> = {
  playing: 'Playing',
  solved: 'Solved',
  not_played: 'Not played',
};

const STATUS_CLASS: Record<ArchiveChallengeStatus, string> = {
  playing:
    'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200 border border-sky-200 dark:border-sky-800',
  solved:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800',
  not_played:
    'bg-zinc-100 text-zinc-600 dark:bg-zinc-900/60 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800',
};

function resolveActionLabel(status: ArchiveChallengeStatus): string {
  if (status === 'solved') return 'View';
  if (status === 'playing') return 'Continue';
  return 'Play';
}

function mergeByChallengeNumber(
  existing: ArchiveChallengeSummary[],
  incoming: ArchiveChallengeSummary[]
): ArchiveChallengeSummary[] {
  const map = new Map<number, ArchiveChallengeSummary>();
  for (const item of existing) {
    map.set(item.challengeNumber, item);
  }
  for (const item of incoming) {
    map.set(item.challengeNumber, item);
  }
  return [...map.values()].sort((a, b) => b.challengeNumber - a.challengeNumber);
}

export function ArchiveModal() {
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const entries = archiveEntries.value;
  const showUnsolvedOnly = archiveShowUnsolvedOnly.value;
  const displayedEntries = showUnsolvedOnly
    ? entries.filter((entry) => entry.status !== 'solved')
    : entries;
  const isLoading = archiveLoading.value;
  const errorMessage = archiveError.value;
  const hasMore = archiveNextCursor.value !== null;

  const fetchPage = async ({ reset }: { reset?: boolean } = {}) => {
    if (archiveLoading.value) return;

    let cursor: number | undefined;
    if (reset) {
      archiveEntries.value = [];
      archiveNextCursor.value = null;
      archiveInitialized.value = false;
      archiveError.value = null;
      cursor = undefined;
    } else if (!archiveInitialized.value) {
      cursor = undefined;
    } else {
      if (archiveNextCursor.value === null) {
        return;
      }
      cursor = archiveNextCursor.value ?? undefined;
    }

    archiveLoading.value = true;
    archiveError.value = null;

    try {
      const response = await trpc.archive.list.query({
        cursor,
        limit: 50,
      });

      archiveEntries.value = mergeByChallengeNumber(
        reset ? [] : archiveEntries.value,
        response.items
      );
      archiveNextCursor.value = response.nextCursor;
    } catch (error) {
      archiveError.value =
        error instanceof Error ? error.message : 'Failed to load archive challenges.';
    } finally {
      archiveInitialized.value = true;
      archiveLoading.value = false;
    }
  };

  useEffect(() => {
    if (!archiveOpen.value) {
      return;
    }
    if (archiveLoading.value) {
      return;
    }
    if (archiveInitialized.value && archiveEntries.value.length > 0) {
      return;
    }
    void fetchPage();
  }, [
    archiveOpen.value,
    archiveInitialized.value,
    archiveEntries.value.length,
    archiveLoading.value,
  ]);

  useEffect(() => {
    if (!archiveOpen.value) return;
    const listEl = listRef.current;
    const sentinelEl = sentinelRef.current;
    if (!listEl || !sentinelEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!archiveOpen.value) return;
        const isIntersecting = entries.some((entry) => entry.isIntersecting);
        if (!isIntersecting) return;
        if (archiveLoading.value) return;
        if (archiveNextCursor.value === null) return;
        void fetchPage();
      },
      {
        root: listEl,
        rootMargin: '200px',
        threshold: 0,
      }
    );

    observer.observe(sentinelEl);
    return () => observer.disconnect();
  }, [
    archiveOpen.value,
    archiveEntries.value.length,
    archiveNextCursor.value,
    archiveLoading.value,
  ]);

  useEffect(() => {
    if (!archiveOpen.value) return;
    if (!showUnsolvedOnly) return;
    if (displayedEntries.length > 0) return;
    if (archiveLoading.value) return;
    if (archiveNextCursor.value === null) return;
    void fetchPage();
  }, [
    archiveOpen.value,
    showUnsolvedOnly,
    displayedEntries.length,
    archiveNextCursor.value,
    archiveLoading.value,
  ]);

  const currentChallengeNumber = requireChallengeNumber();

  const handleNavigate = async (entry: ArchiveChallengeSummary) => {
    if (!entry.postUrl) return;
    posthog.capture('Archive Challenge Selected', {
      challengeNumber: entry.challengeNumber,
      status: entry.status,
    });
    closeArchive();
    await navigateTo(entry.postUrl);
  };

  return (
    <Modal isOpen={archiveOpen.value} onClose={closeArchive}>
      <div className="w-[min(92vw,600px)] max-w-2xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-950 dark:text-white md:p-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold md:text-xl">Play the archive</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Jump into a previous Hot and Cold challenge.
            </p>
          </div>
          <button
            type="button"
            onClick={() => toggleArchiveShowUnsolved()}
            className={cn(
              'self-start rounded-full border px-4 py-2 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400 dark:focus:ring-sky-600',
              showUnsolvedOnly
                ? 'border-gray-900 bg-gray-900 text-white hover:bg-gray-800 dark:border-white dark:bg-white dark:text-black dark:hover:bg-zinc-100'
                : 'border-gray-300 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
            )}
          >
            {showUnsolvedOnly ? 'Show all challenges' : 'Show unsolved'}
          </button>
        </div>

        <div
          ref={listRef}
          className="mt-6 flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1 text-sm"
        >
          {displayedEntries.map((entry) => {
            const statusClass = STATUS_CLASS[entry.status];
            const statusLabel = STATUS_LABEL[entry.status];
            const actionLabel = resolveActionLabel(entry.status);
            const isCurrent = entry.challengeNumber === currentChallengeNumber;
            const scoreDisplay =
              entry.score != null && Number.isFinite(entry.score) ? entry.score : '—';
            return (
              <div
                key={entry.challengeNumber}
                className={cn(
                  'flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm transition hover:shadow-md dark:bg-zinc-900/70',
                  isCurrent && 'bg-sky-50/90 dark:bg-sky-900/40'
                )}
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold md:text-lg">
                        Challenge #{entry.challengeNumber}
                      </span>
                      {isCurrent ? (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/50 dark:text-sky-200">
                          Current
                        </span>
                      ) : null}
                      <span
                        className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusClass)}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                      <span className="rounded-full bg-zinc-100 px-2 py-1 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                        Score {scoreDisplay}
                      </span>
                      <span className="rounded-full bg-teal-100 px-2 py-1 font-medium text-teal-700 dark:bg-teal-900/40 dark:text-teal-200">
                        Players {formatCompactNumber(entry.totalPlayers)}
                      </span>
                      <span className="rounded-full bg-indigo-100 px-2 py-1 font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">
                        Solves {formatCompactNumber(entry.totalSolves)}
                      </span>
                    </div>
                  </div>
                  <SecondaryButton
                    onClick={() => {
                      void handleNavigate(entry);
                    }}
                    disabled={!entry.postUrl}
                    className={cn(
                      'rounded-full bg-black px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-black/80 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:bg-white dark:text-black dark:hover:bg-zinc-200 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400'
                    )}
                  >
                    {entry.postUrl ? actionLabel : 'Unavailable'}
                  </SecondaryButton>
                </div>
              </div>
            );
          })}

          {displayedEntries.length === 0 && !isLoading && !errorMessage ? (
            <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              {showUnsolvedOnly
                ? 'No unsolved challenges yet. Keep checking back!'
                : 'No past challenges found yet. Check back soon!'}
            </div>
          ) : null}

          {errorMessage ? (
            <div className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200">
              <p>{errorMessage}</p>
              <SecondaryButton
                disabled={isLoading}
                onClick={() => {
                  void fetchPage({ reset: true });
                }}
                className="self-start rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 dark:bg-rose-500 dark:hover:bg-rose-400"
              >
                Try again
              </SecondaryButton>
            </div>
          ) : null}

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Loading…
            </div>
          ) : null}

          {!hasMore && entries.length > 0 && !isLoading ? (
            <div className="py-4 text-center text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              You’ve reached the beginning of the archive.
            </div>
          ) : null}

          <div ref={sentinelRef} className="h-1 w-full" />
        </div>
      </div>
    </Modal>
  );
}
