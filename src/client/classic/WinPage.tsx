import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Tablist } from '../shared/tablist';
import { GradientBorder } from '../shared/gradientBorder';
// import { RightChevronIcon } from '../shared/icons';
import { cn } from '../utils/cn';
import { trpc } from '../trpc';
// import { context } from '@devvit/web/client';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { getPrettyDuration } from '../../shared/prettyDuration';
import { ScoreBreakdownModal } from './scoreBreakdownModal';

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

const CallToAction = ({ didWin }: { didWin: boolean }) => {
  // Hardcore upsell is not wired yet in classic – show reminder toggle only
  const [isUserOptedIntoReminders, setOptIn] = useState(false);

  if (!didWin) return null;

  return (
    <div className="cursor-pointer rounded-full text-sm font-semibold">
      <GradientBorder>
        <label className="flex items-center justify-center gap-2 p-4">
          <input
            type="checkbox"
            checked={isUserOptedIntoReminders}
            onChange={() => setOptIn((v) => !v)}
            className="size-4 appearance-none rounded-sm border border-gray-900 accent-blue-500 checked:appearance-auto dark:border-white dark:accent-blue-600"
          />
          <span className="select-none">Remind me to play every day</span>
        </label>
      </GradientBorder>
    </div>
  );
};

export function WinPage() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [isScoreOpen, setIsScoreOpen] = useState(false);

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
  const totalPlayers = challengeInfo.totalPlayers || 1;
  const percentageOutperformed = calculatePercentageOutperformed(playerRank, totalPlayers);

  return (
    <div className={cn('flex flex-1 flex-col gap-4 px-4')}>
      <div className="mx-auto">
        <Tablist
          activeIndex={activeIndex}
          onChange={setActiveIndex}
          items={[{ name: 'My Stats' }, { name: 'Challenge Stats' }, { name: 'Leaderboard' }]}
        />
      </div>

      <div className="mx-auto w-full max-w-xl flex-auto px-4">
        {activeIndex === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-8">
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
                          onClick={() => setIsScoreOpen(true)}
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
            {/* <CallToAction didWin={didWin} /> */}
          </div>
        )}

        {activeIndex === 1 && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <StatCard title="Total Players" value={challengeInfo?.totalPlayers ?? 0} />
              <StatCard title="Total Solves" value={challengeInfo?.totalSolves ?? 0} />
              <StatCard title="Total Guesses" value={challengeInfo?.totalGuesses ?? 0} />
              <StatCard title="Total Hints" value={challengeInfo?.totalHints ?? 0} />
              <StatCard title="Give Ups" value={challengeInfo?.totalGiveUps ?? 0} />
              <StatCard
                title="Solve Rate"
                value={`${Math.round(((challengeInfo?.totalSolves ?? 0) / (challengeInfo?.totalPlayers ?? 1)) * 100)}%`}
              />
              <StatCard
                title="Average Guesses"
                value={Math.round(
                  (challengeInfo?.totalGuesses ?? 0) / (challengeInfo?.totalPlayers ?? 1)
                )}
              />
            </div>
          </div>
        )}

        {activeIndex === 2 && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 text-center">
              {userRank && (
                <p className="text-gray-400">
                  Your Rank: <span className="font-bold text-blue-400">#{userRank}</span>
                </p>
              )}
            </div>

            {leaderboard?.length ? (
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
                {leaderboard.map((entry, index, entries) => {
                  const isCurrentUser = entry.member === challengeUserInfo.username;
                  let rank = 1;
                  if (index > 0) {
                    const prevScore = entries[index - 1]?.score ?? entry.score;
                    if (entry.score === prevScore) {
                      rank = Math.max(1, entries.findIndex((e) => e.score === entry.score) + 1);
                    } else {
                      rank = index + 1;
                    }
                  }
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
