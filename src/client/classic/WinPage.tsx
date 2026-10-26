import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Tablist } from '../shared/tablist';
import { GradientBorder } from '../shared/gradientBorder';
// import { RightChevronIcon } from '../shared/icons';
import { trpc } from '../trpc';
import { openPopup } from './expanded/launch';
import { posthog } from '../posthog';
// import { context } from '@devvit/web/client';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { getPrettyDuration } from '../../shared/prettyDuration';
import { loadHintsForChallenge, type HintWord } from '../core/hints';
import { context, showShareSheet, showToast } from '@devvit/web/client';
import { formatCompactNumber } from '../../shared/formatCompactNumber';
import { ShareIcon } from './icons';
import { ReminderButton } from './reminders';
import { ScrollPanel } from '../shared/scrollNavigation';
import { userSettings } from './state/userSettings';
import { InlineResults, InlineResultButtons } from './inlineResults';
import { GuessJourney, CommunityProgress, StandingsScores } from './resultsCharts';
import { ResultsTable, ResultsTableRow } from './resultsTable';
import { ResultTemperature } from './feedback/temperature';

type LeaderboardEntry = { member: string; score: number };

const prettyNumber = (num: number): string => num.toLocaleString('en-US');
const similarityPercent = (value: unknown): string =>
  typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';

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

export const ResultsActions = ({
  didWin,
  challengeNumber,
  stats,
  compact = false,
}: {
  compact?: boolean;
  didWin: boolean;
  challengeNumber: number;
  stats: { score?: number | null; rank?: number | null; timeToSolve?: string | null };
}) => {
  const [cta, setCta] = useState<CallToActionType>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!cta) return;
    posthog.capture('Win Page Call To Action Shown', {
      didWin,
      challengeNumber,
      cta,
    });
  }, [cta]);

  useEffect(() => {
    if (compact) return;
    // Secondary actions stay in the expanded results.
    void (async () => {
      try {
        const next = await trpc.cta.getCallToAction.query({ challengeNumber });
        setCta(next);
      } catch {
        setCta(null);
      }
    })();
  }, [challengeNumber, compact, userSettings.value.isUserOptedIntoReminders]);

  const doAction = async (event: MouseEvent) => {
    if (cta === 'COMMENT') {
      openPopup(event, 'comment-composer');
      return;
    }
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
      }
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
        ? 'Remind Me to Play Daily'
        : 'Share Your Journey in the Thread';

  const shareResults = async () => {
    posthog.capture('Win Page Share Clicked', {
      challengeNumber,
      didWin,
      score: stats.score ?? null,
      rank: stats.rank ?? null,
    });

    const shareText = didWin
      ? `I solved Hot & Cold #${challengeNumber} in ${stats.timeToSolve}. Can you beat my time?`
      : `Can you solve Hot & Cold #${challengeNumber}?`;

    try {
      await showShareSheet({
        title: 'Hot & Cold',
        text: shareText,
        data: JSON.stringify({ challengeNumber }),
      });
    } catch (e) {
      console.error('Failed to open share sheet', e);
      showToast({ text: 'Share is unavailable right now' });
    }
  };

  if (compact)
    return (
      <div className="inline-result-actions-stack">
        <InlineResultButtons onShare={() => void shareResults()} />
        {didWin && <ReminderButton prominent compact />}
      </div>
    );

  return (
    <div className="text-sm">
      <div className="flex w-full flex-col items-center gap-2">
        {didWin && <ReminderButton prominent />}
        {cta && cta !== 'REMIND_ME_TO_PLAY' && (
          <button
            type="button"
            onClick={doAction}
            disabled={isLoading}
            className="w-full max-w-sm cursor-pointer rounded-full bg-zinc-100 text-black focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-50 focus:outline-none dark:bg-zinc-800 dark:text-white"
          >
            <GradientBorder isHidden={isLoading}>
              <span className="inline-flex min-h-10 items-center justify-center px-4 py-2 text-center leading-snug font-semibold">
                {isLoading ? 'Working…' : label}
              </span>
            </GradientBorder>
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            void shareResults();
          }}
          className="inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-full bg-zinc-100 px-4 py-2.5 leading-snug font-semibold text-black focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-50 focus:outline-none dark:bg-zinc-800 dark:text-white"
        >
          <ShareIcon /> Share Results
        </button>
      </div>
    </div>
  );
};

export function WinPage({ expanded = false }: { expanded?: boolean }) {
  const [activeIndex, setActiveIndex] = useState(() => {
    if (!expanded) return 0;
    const saved = Number(localStorage.getItem(`results-tab:${requireChallengeNumber()}`));
    return Number.isInteger(saved) && saved >= 0 && saved <= 4 ? saved : 0;
  });
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState(false);
  const [leaderboardAttempt, setLeaderboardAttempt] = useState(0);
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
    let active = true;
    setLeaderboardLoading(true);
    setLeaderboardError(false);
    // Load the larger page only for Standings; both its graph and table share it.
    void (async () => {
      try {
        const res = await trpc.leaderboard.get.query({
          challengeNumber,
          start: 0,
          stop: expanded && activeIndex === 4 ? 49 : 0,
        });
        if (!active) return;
        setLeaderboard(res.leaderboardByScore ?? []);
        const myRank = res.userRank?.score ?? null;
        setUserRank(typeof myRank === 'number' ? myRank : null);
      } catch {
        if (active) setLeaderboardError(true);
      } finally {
        if (active) setLeaderboardLoading(false);
      }
    })();
    // A slower summary request must not replace the full page after switching tabs.
    return () => {
      active = false;
    };
  }, [challengeNumber, expanded && activeIndex === 4, leaderboardAttempt]);

  useEffect(() => {
    if (!expanded || activeIndex !== 2 || hints !== null) return;
    // Load closest words only when their expanded tab is selected.
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
  }, [challengeNumber, expanded, activeIndex, hints]);

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

  const journeyGuesses = (challengeUserInfo.guesses ?? []).filter(
    (guess: any) => didWin || guess.similarity !== 1
  );
  const endAt = challengeUserInfo.solvedAtMs ?? challengeUserInfo.gaveUpAtMs;
  const timeToSolve =
    Number.isFinite(challengeUserInfo.startedPlayingAtMs) && Number.isFinite(endAt)
      ? getPrettyDuration(new Date(challengeUserInfo.startedPlayingAtMs), new Date(endAt))
      : '--';

  if (!expanded)
    return (
      <InlineResults
        didWin={didWin}
        word={word?.word ?? '—'}
        stats={[
          ...(didWin
            ? [
                {
                  label: 'Score',
                  value: challengeUserInfo.score?.finalScore ?? 0,
                  onClick: (event: MouseEvent) => openPopup(event, 'score-breakdown'),
                },
              ]
            : [{ label: 'Guesses', value: journeyGuesses.length }]),
          { label: 'Time', value: timeToSolve.split(' ').slice(0, 2).join(' ') },
          { label: 'Rank', value: didWin && userRank ? `#${userRank}` : '—' },
        ]}
        guesses={journeyGuesses}
        actions={
          <ResultsActions
            compact
            didWin={didWin}
            challengeNumber={challengeNumber}
            stats={{
              score: challengeUserInfo.score?.finalScore ?? null,
              rank: userRank,
              timeToSolve,
            }}
          />
        }
      />
    );

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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ResultTemperature didWin={didWin} />
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

      <ScrollPanel key={activeIndex} label="Results">
        <div className="mx-auto w-full max-w-xl px-1 pb-3">
          {activeIndex === 0 && (
            <div className="flex flex-col items-center justify-start gap-4">
              <h1 className="text-center text-2xl font-bold text-gray-900 dark:text-white">
                {didWin ? 'Congratulations!' : 'Nice Try!'} The word was:{' '}
                <span
                  className={
                    didWin
                      ? 'text-orange-800 dark:text-orange-200'
                      : 'text-sky-800 dark:text-sky-200'
                  }
                >
                  {word?.word ?? '—'}
                </span>
              </h1>

              <div className="flex flex-wrap justify-center gap-2">
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
                            onClick={(event) => {
                              posthog.capture('Win Page Score Breakdown Clicked');
                              openPopup(event, 'score-breakdown');
                            }}
                          >
                            Breakdown
                          </button>
                          )
                        </span>
                      </>
                    }
                    value={challengeUserInfo.score?.finalScore ?? 0}
                    valueSubtext={
                      playerRank > 0
                        ? (`Top ${percentageOutperformed}%` as any)
                        : (undefined as any)
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
              <div className="w-full">
                <GuessJourney guesses={journeyGuesses} />
              </div>
              <ResultsActions
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
              <CommunityProgress
                players={totalPlayers}
                solves={totalSolves}
                giveUps={totalGiveUps}
              />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <StatCard title="Total Players" value={formatCompactNumber(totalPlayers)} />
                <StatCard title="Total Solves" value={formatCompactNumber(totalSolves)} />
                <StatCard title="Total Guesses" value={formatCompactNumber(totalGuesses)} />
                <StatCard title="Total Hints" value={formatCompactNumber(totalHints)} />
                <StatCard title="Give Ups" value={formatCompactNumber(totalGiveUps)} />
                <StatCard
                  title="Average Guesses"
                  value={formatCompactNumber(averageGuessesRounded)}
                />
              </div>
            </div>
          )}

          {activeIndex === 2 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  Closest Words
                </h2>
                {hints && hints.length > 0 && (
                  <span className="text-xs text-gray-600 tabular-nums dark:text-gray-300">
                    {prettyNumber(hints.length)} Words
                  </span>
                )}
              </div>
              {isHintsLoading ? (
                <p role="status" className="text-sm text-gray-600 dark:text-gray-300">
                  Loading…
                </p>
              ) : !hints?.length ? (
                <p className="text-sm text-gray-700 dark:text-gray-300">No hints available.</p>
              ) : (
                <ResultsTable label="Closest Words" nameHeading="Word" valueHeading="Similarity">
                  {hints.map((hint, index) => (
                    <ResultsTableRow
                      key={`${hint.word}-${index}`}
                      rank={hint.rank ?? index}
                      name={hint.word}
                      value={similarityPercent(hint.similarity)}
                    />
                  ))}
                </ResultsTable>
              )}
            </div>
          )}

          {activeIndex === 3 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  Your Guesses
                </h2>
                {challengeUserInfo.guesses?.length ? (
                  <span className="text-xs text-gray-600 tabular-nums dark:text-gray-300">
                    {prettyNumber(challengeUserInfo.guesses.length)} Total
                  </span>
                ) : null}
              </div>
              {!challengeUserInfo.guesses?.length ? (
                <p className="text-sm text-gray-700 dark:text-gray-300">No guesses yet.</p>
              ) : (
                <ResultsTable label="Your Guesses" nameHeading="Word" valueHeading="Similarity">
                  {[...challengeUserInfo.guesses]
                    .sort(
                      (a: any, b: any) => Number(b.timestampMs ?? 0) - Number(a.timestampMs ?? 0)
                    )
                    .map((guess: any, index: number) => (
                      <ResultsTableRow
                        key={`${guess.word}-${guess.timestampMs ?? index}`}
                        rank={typeof guess.rank === 'number' ? guess.rank : null}
                        name={guess.word}
                        value={similarityPercent(guess.similarity)}
                        isHint={!!guess.isHint}
                      />
                    ))}
                </ResultsTable>
              )}
            </div>
          )}

          {activeIndex === 4 && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Standings</h2>
                {userRank && (
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    Your Rank:{' '}
                    <span className="font-semibold whitespace-nowrap text-cyan-800 tabular-nums dark:text-cyan-200">
                      #{prettyNumber(userRank)}
                    </span>
                  </p>
                )}
              </div>
              {leaderboardLoading ? (
                <p role="status" className="text-sm text-gray-600 dark:text-gray-300">
                  Loading Standings…
                </p>
              ) : leaderboardError ? (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <p role="alert">Could not load standings.</p>
                  <button
                    type="button"
                    className="rounded-lg border border-gray-300 px-3 py-2 font-semibold dark:border-gray-600"
                    onClick={() => setLeaderboardAttempt((attempt) => attempt + 1)}
                  >
                    Try Again
                  </button>
                </div>
              ) : leaderboard.length ? (
                <>
                  <StandingsScores
                    entries={leaderboard}
                    currentUsername={challengeUserInfo.username ?? null}
                  />
                  <ResultsTable label="Standings" nameHeading="Player" valueHeading="Score">
                    {leaderboard.map((entry, index) => (
                      <ResultsTableRow
                        key={`${entry.member}-${index}`}
                        rank={index + 1}
                        name={entry.member}
                        value={prettyNumber(entry.score)}
                        isCurrentUser={entry.member === challengeUserInfo.username}
                        isTopThree={index < 3}
                      />
                    ))}
                  </ResultsTable>
                </>
              ) : (
                <p className="text-center text-sm text-gray-700 dark:text-gray-300">
                  No one has completed today's challenge. Check back soon!
                </p>
              )}
            </div>
          )}
        </div>
      </ScrollPanel>
    </div>
  );
}
