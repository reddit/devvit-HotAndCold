import React, { useEffect } from 'react';
import { useGame } from '../hooks/useGame';
import { sendMessageToDevvit } from '../utils';
import { cn, getPrettyDuration } from '@hotandcold/webview-common/utils';
import { useDevvitListener } from '../hooks/useDevvitListener';
import { Tablist } from '@hotandcold/webview-common/components/tablist';
import { useUserSettings } from '../hooks/useUserSettings';
import { useModal } from '../hooks/useModal';
import { GradientBorder } from '@hotandcold/webview-common/components/gradientBorder';
import { RightChevronIcon } from '@hotandcold/webview-common/components/icon';

const prettyNumber = (num: number): string => {
  return num.toLocaleString('en-US');
};

const StatCard = ({
  title,
  value,
  valueSubtext,
}: {
  title: React.ReactNode;
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

export const WinPage = () => {
  const { challengeInfo, challengeUserInfo } = useGame();
  const [activeIndex, setActiveIndex] = React.useState(0);
  const { isUserOptedIntoReminders } = useUserSettings();
  const { showModal: setModal } = useModal();
  const leaderboardData = useDevvitListener('CHALLENGE_LEADERBOARD_RESPONSE');

  if (!challengeUserInfo || !challengeInfo) return null;

  useEffect(() => {
    sendMessageToDevvit({
      type: 'LEADERBOARD_FOR_CHALLENGE',
    });
  }, []);

  const didWin = !!challengeUserInfo.solvedAtMs;
  const word = challengeUserInfo.guesses?.find((x) => x.similarity === 1);

  if (!word) throw new Error('No correct word found?');

  const calculatePercentageOutperformed = (rank: number, totalPlayers: number): number => {
    if (rank === 1) return 100;
    if (totalPlayers <= 1 || rank <= 0) return 0;

    const playersBeaten = totalPlayers - rank;
    const percentage = (playersBeaten / (totalPlayers - 1)) * 100;
    return Math.round(percentage);
  };

  // In the WinPage component:
  const playerRank = leaderboardData?.userRank?.score || 0;
  const totalPlayers = challengeInfo.totalPlayers || 1;
  const percentageOutperformed = calculatePercentageOutperformed(playerRank, totalPlayers);

  return (
    <>
      <div className="flex flex-1 flex-col gap-4 px-4">
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
              <h1 className="text-center text-2xl font-bold text-white">
                {didWin ? 'Congratulations!' : 'Nice Try!'} The word was:{' '}
                <span className="text-[#dd4c4c]">{word.word}</span>
              </h1>

              <div className="flex gap-2 sm:gap-4">
                {didWin && (
                  <StatCard
                    title={
                      <>
                        Score{' '}
                        <span className="whitespace-nowrap">
                          (
                          <button
                            className="cursor-pointer text-inherit underline"
                            onClick={() => setModal('score-breakdown')}
                          >
                            breakdown
                          </button>
                          )
                        </span>
                      </>
                    }
                    value={challengeUserInfo.score?.finalScore ?? 0}
                    valueSubtext={playerRank > 0 ? `Top ${percentageOutperformed}%` : undefined}
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
                <StatCard
                  title="Rank"
                  value={didWin ? `#${leaderboardData?.userRank.score ?? '--'}` : '--'}
                />
              </div>
              {didWin ? (
                <div className="flex w-full max-w-md items-center justify-between gap-2 rounded-full border border-red-700 bg-red-900 bg-[url('/assets/win_bg.png')] bg-cover bg-right-bottom bg-no-repeat px-6 py-2">
                  <div className="flex-auto">
                    <p className="text-base font-semibold">Did that feel too easy?</p>
                    <p className="text-xs">Try an even tougher puzzle</p>
                  </div>
                  <button className="shrink-0 rounded-full bg-gray-50 p-3 text-sm font-semibold text-black sm:py-2 dark:bg-gray-800 dark:text-white">
                    {/* TODO: Show modal when clicked */}
                    <span className="hidden sm:inline">Play Hardcore Mode</span>
                    <span className="block size-4 sm:hidden">
                      <RightChevronIcon />
                    </span>
                  </button>
                </div>
              ) : (
                <div className="rounded-full bg-gray-50 text-sm text-black dark:bg-black dark:text-white">
                  <GradientBorder>
                    <label className="flex cursor-pointer items-center justify-center gap-2 p-4">
                      <input
                        type="checkbox"
                        checked={isUserOptedIntoReminders}
                        onChange={() => {
                          sendMessageToDevvit({
                            type: 'TOGGLE_USER_REMINDER',
                          });
                        }}
                        className="size-4 appearance-none rounded-sm border border-gray-900 accent-blue-500 checked:appearance-auto dark:border-white dark:accent-blue-600"
                      />
                      <span className="select-none">Remind me to play tomorrow</span>
                    </label>
                  </GradientBorder>
                </div>
              )}
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
                {leaderboardData?.userRank && (
                  <p className="text-gray-400">
                    Your Rank:{' '}
                    <span className="font-bold text-blue-400">
                      {didWin ? `#${leaderboardData.userRank.score}` : '--'}
                    </span>
                  </p>
                )}
              </div>

              {leaderboardData?.leaderboardByScore.length ? (
                <div className="overflow-hidden rounded-lg border border-gray-700 bg-gray-900">
                  {leaderboardData?.leaderboardByScore.map((entry, index, entries) => {
                    const isCurrentUser = entry.member === challengeUserInfo.username;

                    // Find the rank by looking at previous scores
                    let rank = 1;
                    if (index > 0) {
                      const prevScore = entries[index - 1].score;
                      if (entry.score === prevScore) {
                        // If this score matches previous score, use the same rank
                        rank = entries.findIndex((e) => e.score === entry.score) + 1;
                      } else {
                        // If score is different, rank is current position + 1
                        rank = index + 1;
                      }
                    }

                    const isTopThree = rank <= 3;

                    return (
                      <div
                        key={entry.member}
                        className={cn(
                          'flex items-center px-4 py-1',
                          index % 2 === 0 ? 'bg-gray-800/50' : 'bg-gray-900/50',
                          isCurrentUser && 'bg-blue-900/20',
                          'transition-colors duration-150'
                        )}
                      >
                        <div className="flex flex-1 items-center gap-3">
                          <span
                            className={cn(
                              'min-w-[2rem] font-mono text-sm',
                              isTopThree ? 'font-bold text-yellow-400' : 'text-gray-400'
                            )}
                          >
                            #{rank}
                          </span>
                          <span
                            className={cn(
                              'truncate font-medium',
                              isCurrentUser ? 'text-blue-500' : 'text-white'
                            )}
                          >
                            {entry.member} {isCurrentUser && '(you)'}
                          </span>
                        </div>
                        <span className="font-bold text-gray-200">{prettyNumber(entry.score)}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-center">
                  No one has completed today's challenge. Check back soon!
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
