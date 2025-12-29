import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Tablist } from '../shared/tablist';
import { GradientBorder } from '../shared/gradientBorder';
// import { RightChevronIcon } from '../shared/icons';
import { cn } from '../utils/cn';
import { trpc } from '../trpc';
import { Modal } from '../shared/modal';
import { posthog } from '../posthog';
// import { context } from '@devvit/web/client';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { getPrettyDuration } from '../../shared/prettyDuration';
import { ScoreBreakdownModal } from './scoreBreakdownModal';
import { loadHintsForChallenge, type HintWord } from '../core/hints';
import { context } from '@devvit/web/client';
import { getBrowserIanaTimeZone } from '../../shared/timezones';
import { formatCompactNumber } from '../../shared/formatCompactNumber';

type LeaderboardEntry = { member: string; score: number };

const prettyNumber = (num: number): string => num.toLocaleString('en-US');

const StatCard = ({
  title,
  value,
  valueSubtext,
}: {
  title: ComponentChildren;
  value: string | number;
  valueSubtext?: string;
}) => (
  <div className="rounded-lg bg-gray-200 px-4 py-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
    <div className="pb-1">{title}</div>
    <div>
      <span className="truncate text-2xl font-bold text-black dark:text-white">{value}</span>
      {valueSubtext && <> {valueSubtext}</>}
    </div>
  </div>
);

type CallToActionType = 'JOIN_SUBREDDIT' | 'REMIND_ME_TO_PLAY' | 'COMMENT' | null;

const CallToAction = ({
  didWin,
  challengeNumber,
}: {
  didWin: boolean;
  challengeNumber: number;
  stats: { score?: number | null; rank?: number | null; timeToSolve?: string | null };
}) => {
  const [cta, setCta] = useState<CallToActionType>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCommentOpen, setIsCommentOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [serverSuffix, setServerSuffix] = useState<string | null>(null);

  useEffect(() => {
    if (!cta) return;
    posthog.capture('Win Page Call To Action Shown', {
      didWin,
      challengeNumber,
      cta,
    });
  }, [cta]);

  useEffect(() => {
    // Always fetch the CTA for this challenge so users can comment even before winning
    void (async () => {
      try {
        const next = await trpc.cta.getCallToAction.query({ challengeNumber });
        setCta(next);
      } catch {
        setCta(null);
      }
    })();
  }, [challengeNumber]);

  // Temporary backfill shim: for ~1 week, whenever a user reaches the win page
  // and already has reminders enabled, send their timezone so we can populate
  // missing data for users who opted in before we collected timezones.
  // Use a reliable tRPC check instead of CTA to determine opt-in state.
  // TODO: Remove this after the backfill window ends.
  useEffect(() => {
    void (async () => {
      try {
        if (!context.userId) return;
        const isOptedIn = await trpc.cta.isOptedIntoReminders.query();
        if (!isOptedIn) return;
        const timezone = getBrowserIanaTimeZone();
        await trpc.cta.setReminder.mutate({ timezone });
      } catch (err) {
        console.error('Error backfilling timezone', err);
        // ignore
      }
    })();
  }, []);

  if (cta === null) return null;

  const doAction = async () => {
    setIsLoading(true);

    posthog.capture('Win Page Call To Action Clicked', {
      cta,
    });

    try {
      if (cta === 'JOIN_SUBREDDIT') {
        posthog.setPersonProperties({
          joined_subreddit: true,
        });
        await trpc.cta.joinSubreddit.mutate({});
      } else if (cta === 'REMIND_ME_TO_PLAY') {
        posthog.setPersonProperties({
          opted_into_reminders: true,
        });
        const timezone = getBrowserIanaTimeZone();
        await trpc.cta.setReminder.mutate({ timezone });
      } else if (cta === 'COMMENT') {
        // Preload the server-computed suffix before opening modal
        try {
          const res = await trpc.cta.getCommentSuffix.query({ challengeNumber });
          setServerSuffix(res.suffix);
        } catch {
          setServerSuffix(null);
        }
        setIsCommentOpen(true);
        return;
      }
      const next = await trpc.cta.getCallToAction.query({ challengeNumber });
      setCta(next);
    } finally {
      setIsLoading(false);
    }
  };

  const submitComment = async () => {
    posthog.capture('Win Page Comment Submit Clicked', {
      challengeNumber,
      comment,
    });

    if (!comment.trim()) return;
    setIsLoading(true);
    try {
      const text = comment.trim();
      await trpc.cta.submitComment.mutate({ challengeNumber, comment: text });
      setIsCommentOpen(false);
      setComment('');
      const next = await trpc.cta.getCallToAction.query({ challengeNumber });
      setCta(next);
    } finally {
      setIsLoading(false);
    }
  };

  const label =
    cta === 'JOIN_SUBREDDIT'
      ? `Join r/${context.subredditName}`
      : cta === 'REMIND_ME_TO_PLAY'
        ? 'Remind me to play every day'
        : 'Share your journey in the thread';

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={doAction}
        disabled={isLoading}
        className="w-full cursor-pointer rounded-full bg-zinc-100 text-black focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-50 dark:bg-zinc-800 dark:text-white"
      >
        <GradientBorder isHidden={isLoading}>
          <span className="inline-block px-4 py-3">{isLoading ? 'Working…' : label}</span>
        </GradientBorder>
      </button>

      <Modal isOpen={isCommentOpen} onClose={() => setIsCommentOpen(false)}>
        <div className="w-[90vw] max-w-md rounded-xl border border-gray-200 bg-white p-4 text-black shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-white">
          <h2 className="mb-2 text-lg font-bold">Share your results</h2>
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
            Say something about your game. We'll post this as a comment on your behalf.
          </p>
          <textarea
            className="mb-3 h-28 w-full resize-none rounded-md border border-gray-300 bg-white p-2 text-sm text-black outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            value={comment}
            onInput={(e) => setComment((e.target as HTMLTextAreaElement).value)}
            placeholder={`Share your word journey or details about your strategy!`}
          />
          {serverSuffix && (
            <p className="-mt-2 mb-3 text-[10px] leading-4 text-gray-500 dark:text-gray-400">
              {serverSuffix}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              onClick={() => {
                posthog.capture('Win Page Comment Cancel Clicked', {
                  challengeNumber,
                });
                setIsCommentOpen(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              onClick={submitComment}
              disabled={!comment.trim() || isLoading}
            >
              Post comment
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export function WinPage() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [isScoreOpen, setIsScoreOpen] = useState(false);
  const [hints, setHints] = useState<HintWord[] | null>(null);
  const [isHintsLoading, setIsHintsLoading] = useState(false);

  const challengeNumber = useMemo(() => requireChallengeNumber(), []);

  const [challengeInfo, setChallengeInfo] = useState<any | null>(null);
  const [challengeUserInfo, setChallengeUserInfo] = useState<any | null>(null);

  useEffect(() => {
    // Fire-and-forget fetch; do not block first paint
    void (async () => {
      try {
        const res = await trpc.game.get.query({ challengeNumber });
        setChallengeInfo(res.challengeInfo);
        setChallengeUserInfo(res.challengeUserInfo);
      } catch {
        // ignore
      }
    })();
  }, [challengeNumber]);

  useEffect(() => {
    // Load leaderboard lazily when page mounts
    void (async () => {
      try {
        const res = await trpc.leaderboard.get.query({ challengeNumber, start: 0, stop: 50 });
        setLeaderboard(res.leaderboardByScore ?? []);
        const myRank = res.userRank?.score ?? null;
        setUserRank(typeof myRank === 'number' ? myRank : null);
      } catch {
        // ignore
      }
    })();
  }, [challengeNumber]);

  useEffect(() => {
    // Load closest words (hints) once per challenge
    void (async () => {
      setIsHintsLoading(true);
      try {
        const words = await loadHintsForChallenge(challengeNumber);
        // Sort by ascending rank (0 is closest); fallback to similarity desc
        const sorted = words
          .slice(0)
          .sort(
            (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.similarity - a.similarity
          );
        setHints(sorted);
      } catch {
        setHints([]);
      } finally {
        setIsHintsLoading(false);
      }
    })();
  }, [challengeNumber]);

  if (!challengeUserInfo || !challengeInfo) {
    // optimistic skeleton
    return (
      <div className="flex flex-1 flex-col gap-4 px-4">
        <div className="mx-auto h-10 w-64 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        <div className="mx-auto h-24 w-full max-w-xl animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      </div>
    );
  }

  const didWin = !!challengeUserInfo.solvedAtMs;
  const word = challengeUserInfo.guesses?.find((x: any) => x.similarity === 1);

  const calculatePercentageOutperformed = (rank: number, totalPlayers: number): number => {
    if (rank === 1) return 100;
    if (totalPlayers <= 1 || rank <= 0) return 0;
    const playersBeaten = totalPlayers - rank;
    const percentage = (playersBeaten / (totalPlayers - 1)) * 100;
    return Math.round(percentage);
  };

  const playerRank = userRank ?? 0;
  const totalPlayers = challengeInfo?.totalPlayers ?? 0;
  const percentageOutperformed = calculatePercentageOutperformed(
    playerRank,
    Math.max(totalPlayers, 1)
  );
  const totalSolves = challengeInfo?.totalSolves ?? 0;
  const totalGuesses = challengeInfo?.totalGuesses ?? 0;
  const totalHints = challengeInfo?.totalHints ?? 0;
  const totalGiveUps = challengeInfo?.totalGiveUps ?? 0;
  const averageGuessesRaw = totalPlayers > 0 ? totalGuesses / totalPlayers : 0;
  const averageGuessesRounded = Math.round(averageGuessesRaw * 10) / 10;

  const tabList = [
    { name: 'Me' },
    { name: 'Global' },
    { name: 'Closest' },
    { name: 'Guesses' },
    { name: 'Standings' },
  ];

  return (
    <div className={cn('flex flex-1 flex-col gap-6 md:px-4')}>
      <div className="mx-auto">
        <Tablist
          activeIndex={activeIndex}
          onChange={(index) => {
            const tabClicked = tabList[index]!.name;
            posthog.capture('Win Page Tab Clicked', {
              index,
              tabClicked,
            });
            setActiveIndex(index);
          }}
          items={tabList}
        />
      </div>

      <div className="mx-auto w-full max-w-xl flex-auto px-4">
        {activeIndex === 0 && (
          <div className="flex h-full flex-col items-center justify-start gap-8">
            <h1 className="text-center text-2xl font-bold text-gray-900 dark:text-white">
              {didWin ? 'Congratulations!' : 'Nice Try!'} The word was:{' '}
              <span className="text-[#dd4c4c]">{word?.word ?? '—'}</span>
            </h1>

            <div className="flex gap-2 md:gap-4">
              {didWin && (
                <StatCard
                  title={
                    <>
                      Score{' '}
                      <span className="whitespace-nowrap">
                        (
                        <button
                          type="button"
                          className="cursor-pointer text-inherit underline"
                          onClick={() => {
                            posthog.capture('Win Page Score Breakdown Clicked');
                            setIsScoreOpen(true);
                          }}
                        >
                          breakdown
                        </button>
                        )
                      </span>
                    </>
                  }
                  value={challengeUserInfo.score?.finalScore ?? 0}
                  valueSubtext={
                    playerRank > 0 ? (`Top ${percentageOutperformed}%` as any) : (undefined as any)
                  }
                />
              )}
              <StatCard
                title="Time to Solve"
                value={
                  getPrettyDuration(
                    new Date(challengeUserInfo.startedPlayingAtMs!),
                    new Date(challengeUserInfo.solvedAtMs ?? challengeUserInfo.gaveUpAtMs!)
                  ) ?? '--'
                }
              />
              <StatCard title="Rank" value={didWin ? `#${userRank ?? '--'}` : '--'} />
            </div>
            <CallToAction
              didWin={didWin}
              challengeNumber={challengeNumber}
              stats={{
                score: challengeUserInfo.score?.finalScore ?? null,
                rank: userRank ?? null,
                timeToSolve: getPrettyDuration(
                  new Date(challengeUserInfo.startedPlayingAtMs!),
                  new Date(challengeUserInfo.solvedAtMs ?? challengeUserInfo.gaveUpAtMs!)
                ),
              }}
            />
          </div>
        )}

        {activeIndex === 1 && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <StatCard title="Total Players" value={formatCompactNumber(totalPlayers)} />
              <StatCard title="Total Solves" value={formatCompactNumber(totalSolves)} />
              <StatCard title="Total Guesses" value={formatCompactNumber(totalGuesses)} />
              <StatCard title="Total Hints" value={formatCompactNumber(totalHints)} />
              <StatCard title="Give Ups" value={formatCompactNumber(totalGiveUps)} />
              <StatCard
                title="Solve Rate"
                value={`${Math.round(((challengeInfo?.totalSolves ?? 0) / (challengeInfo?.totalPlayers ?? 1)) * 100)}%`}
              />
              <StatCard
                title="Average Guesses"
                value={formatCompactNumber(averageGuessesRounded)}
              />
            </div>
          </div>
        )}

        {activeIndex === 2 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Closest words
              </h2>
              {hints && hints.length > 0 && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {hints.length} words
                </span>
              )}
            </div>
            <div className="overflow-y-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 max-h-[50vh]">
              {isHintsLoading ? (
                <div className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading…</div>
              ) : !hints || hints.length === 0 ? (
                <div className="p-4 text-sm text-gray-700 dark:text-gray-300">
                  No hints available.
                </div>
              ) : (
                hints.map((h, index) => (
                  <div
                    key={`${h.word}-${index}`}
                    className={cn(
                      'flex items-center px-4 py-1 transition-colors duration-150',
                      index % 2 === 0
                        ? 'bg-gray-50 dark:bg-gray-800/50'
                        : 'bg-gray-100 dark:bg-gray-900/50'
                    )}
                  >
                    <div className="flex flex-1 items-center gap-3">
                      <span className="min-w-[2rem] font-mono text-sm text-gray-600 dark:text-gray-400">
                        #{h.rank ?? index}
                      </span>
                      <span className="truncate font-medium text-gray-900 dark:text-white">
                        {h.word}
                      </span>
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {(h.similarity * 100).toFixed(1)}%
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeIndex === 3 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Your guesses
              </h2>
              {challengeUserInfo.guesses?.length ? (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {challengeUserInfo.guesses.length} total
                </span>
              ) : null}
            </div>
            <div className="overflow-y-auto max-h-[50vh] rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
              {!challengeUserInfo.guesses || challengeUserInfo.guesses.length === 0 ? (
                <div className="p-4 text-sm text-gray-700 dark:text-gray-300">No guesses yet.</div>
              ) : (
                [...challengeUserInfo.guesses]
                  .sort((a: any, b: any) => Number(b.timestampMs ?? 0) - Number(a.timestampMs ?? 0))
                  .map((g: any, index: number) => (
                    <div
                      key={`${g.word}-${g.timestampMs ?? index}`}
                      className={cn(
                        'flex items-center px-4 py-1 transition-colors duration-150',
                        index % 2 === 0
                          ? 'bg-gray-50 dark:bg-gray-800/50'
                          : 'bg-gray-100 dark:bg-gray-900/50'
                      )}
                    >
                      <div className="flex flex-1 items-center gap-3">
                        <span className="min-w-[2.25rem] font-mono text-sm text-gray-600 dark:text-gray-400">
                          #{typeof g.rank === 'number' && g.rank >= 0 ? g.rank : '—'}
                        </span>
                        <span className="truncate font-medium text-gray-900 dark:text-white">
                          {g.word}
                        </span>
                        {g.isHint ? (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                            Hint
                          </span>
                        ) : null}
                      </div>
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {typeof g.similarity === 'number'
                          ? (g.similarity * 100).toFixed(1) + '%'
                          : '—'}
                      </span>
                    </div>
                  ))
              )}
            </div>
          </div>
        )}

        {activeIndex === 4 && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 text-center">
              {userRank && (
                <p className="text-gray-400">
                  Your Rank: <span className="font-bold text-blue-400">#{userRank}</span>
                </p>
              )}
            </div>

            {leaderboard?.length ? (
              <div className="overflow-y-auto max-h-[50vh] rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
                {leaderboard.map((entry, index) => {
                  const isCurrentUser = entry.member === challengeUserInfo.username;
                  const rank = index + 1;
                  const isTopThree = rank <= 3;
                  return (
                    <div
                      key={`${entry.member}-${index}`}
                      className={cn(
                        'flex items-center px-4 py-1 transition-colors duration-150',
                        index % 2 === 0
                          ? 'bg-gray-50 dark:bg-gray-800/50'
                          : 'bg-gray-100 dark:bg-gray-900/50',
                        isCurrentUser && 'bg-blue-100 dark:bg-blue-900/20'
                      )}
                    >
                      <div className="flex flex-1 items-center gap-3">
                        <span
                          className={cn(
                            'min-w-[2rem] font-mono text-sm',
                            isTopThree
                              ? 'font-bold text-yellow-600 dark:text-yellow-400'
                              : 'text-gray-600 dark:text-gray-400'
                          )}
                        >
                          #{rank}
                        </span>
                        <span
                          className={cn(
                            'truncate font-medium',
                            isCurrentUser
                              ? 'text-blue-700 dark:text-blue-500'
                              : 'text-gray-900 dark:text-white'
                          )}
                        >
                          {entry.member} {isCurrentUser && '(you)'}
                        </span>
                      </div>
                      <span className="font-bold text-gray-900 dark:text-gray-200">
                        {prettyNumber(entry.score)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center text-gray-700 dark:text-gray-300">
                No one has completed today's challenge. Check back soon!
              </p>
            )}
          </div>
        )}
      </div>
      <ScoreBreakdownModal
        isOpen={isScoreOpen}
        onClose={() => setIsScoreOpen(false)}
        score={challengeUserInfo.score ?? null}
      />
    </div>
  );
}
