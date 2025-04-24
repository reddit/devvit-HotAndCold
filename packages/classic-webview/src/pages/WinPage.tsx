import React, { useEffect } from 'react';
import { useGame } from '../hooks/useGame';
import { sendMessageToDevvit } from '../utils';
import { cn, getPrettyDuration } from '@hotandcold/webview-common/utils';
import { useDevvitListener } from '../hooks/useDevvitListener';
import { Tablist } from '@hotandcold/webview-common/components/tablist';
import { AnimatedNumber } from '@hotandcold/webview-common/components/timer';
import { useUserSettings } from '../hooks/useUserSettings';
import { ScoreBreakdownModal } from '../components/scoreBreakdownModal';

const prettyNumber = (num: number): string => {
  return num.toLocaleString('en-US');
};

const StatCard = ({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  icon: React.ComponentType;
}) => (
  <div className="flex flex-col items-start gap-2 rounded-lg bg-gray-800 p-3">
    <div className="text-xs text-gray-400">{title}</div>
    <div className="flex gap-1 text-left">
      <div className="flex-shrink-0">
        <Icon />
      </div>
      <div className="truncate font-bold text-white">{value}</div>
    </div>
  </div>
);

const TimeIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className="h-5 w-5"
    viewBox="0 0 24 24"
    strokeWidth="2"
    stroke="currentColor"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
    <path d="M12 7v5l3 3" />
  </svg>
);

const GuessIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className="h-5 w-5"
    viewBox="0 0 24 24"
    strokeWidth="2"
    stroke="currentColor"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M11 5h2" />
    <path d="M5 11h14" />
    <path d="M15 11v-4a2 2 0 0 0 -4 0" />
    <path d="M5 11c0 5.5 2.5 10 7 10" />
    <path d="M19 11c0 5.5 -2.5 10 -7 10" />
    <path d="M12 21v-10" />
  </svg>
);

const ThermometerIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M18 7v12a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-12l6 -4z" />
    <path d="M10 13l2 -1l2 1" />
    <path d="M10 17l2 -1l2 1" />
    <path d="M10 9l2 -1l2 1" />
  </svg>
);

export const WinPage = () => {
  const { challengeInfo, challengeUserInfo } = useGame();
  const [activeIndex, setActiveIndex] = React.useState(0);
  const { isUserOptedIntoReminders } = useUserSettings();
  const [isScoreBreakdownOpen, setIsScoreBreakdownOpen] = React.useState(false);
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
    if (totalPlayers <= 1 || rank <= 0) return 0;
    if (rank === 1) return 100;

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
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex justify-center">
          <Tablist
            activeIndex={activeIndex}
            onChange={setActiveIndex}
            items={[{ name: 'My Stats' }, { name: 'Challenge Stats' }, { name: 'Leaderboard' }]}
          />
        </div>

        <div className="mx-auto w-full max-w-xl px-4">
          {activeIndex === 0 && (
            <div className="flex flex-col items-center gap-6 text-center">
              <h1 className="text-2xl font-bold text-white">
                {didWin ? 'Congratulations!' : 'Nice Try!'} The word was:{' '}
                <span className="text-[#dd4c4c]">{word.word}</span>
              </h1>

              <div className="flex flex-col items-center gap-2">
                {didWin ? (
                  <div className="flex flex-col items-center justify-center">
                    <p className="mb-2 text-sm font-bold">
                      Your Score (
                      <span
                        className="cursor-pointer text-gray-500 underline"
                        onClick={() => setIsScoreBreakdownOpen(true)}
                      >
                        breakdown
                      </span>
                      )
                    </p>

                    <AnimatedNumber
                      size={40}
                      value={challengeUserInfo.score?.finalScore ?? 0}
                      animateOnMount
                    />
                  </div>
                ) : (
                  <span className="text-4xl">--</span>
                )}

                <p className="text-sm text-gray-400">
                  {didWin ? (
                    totalPlayers === 1 ? (
                      <span>You're the first player to solve today's challenge!</span>
                    ) : (
                      <span>
                        That's better than {playerRank > 0 ? percentageOutperformed : '--'}% of
                        players!
                      </span>
                    )
                  ) : (
                    <span>Play again tomorrow!</span>
                  )}
                </p>
              </div>

              <div className="w-50% grid grid-cols-2 gap-4">
                <StatCard
                  title="Time to Solve"
                  value={
                    getPrettyDuration(
                      new Date(challengeUserInfo.startedPlayingAtMs!),
                      new Date(challengeUserInfo.solvedAtMs ?? challengeUserInfo.gaveUpAtMs!)
                    ) ?? '--'
                  }
                  icon={TimeIcon}
                />
                <StatCard
                  title="Rank"
                  value={didWin ? `#${leaderboardData?.userRank.score ?? '--'}` : '--'}
                  icon={ThermometerIcon}
                />
              </div>

              <div className="flex flex-col gap-3">
                {/* <button
                className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
                onClick={() => {}}
              >
                Share Word Journey
              </button> */}

                <label className="flex cursor-pointer items-center justify-center gap-2 px-4 py-2">
                  <input
                    type="checkbox"
                    checked={isUserOptedIntoReminders}
                    onChange={() => {
                      sendMessageToDevvit({
                        type: 'TOGGLE_USER_REMINDER',
                      });
                    }}
                    className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-600"
                  />
                  <span className="select-none text-sm text-gray-300">
                    Remind me to play tomorrow
                  </span>
                </label>
              </div>
            </div>
          )}

          {activeIndex === 1 && (
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <StatCard
                  title="Total Players"
                  value={challengeInfo?.totalPlayers ?? 0}
                  icon={GuessIcon}
                />
                <StatCard
                  title="Total Solves"
                  value={challengeInfo?.totalSolves ?? 0}
                  icon={GuessIcon}
                />
                <StatCard
                  title="Total Guesses"
                  value={challengeInfo?.totalGuesses ?? 0}
                  icon={GuessIcon}
                />
                <StatCard
                  title="Total Hints"
                  value={challengeInfo?.totalHints ?? 0}
                  icon={GuessIcon}
                />
                <StatCard
                  title="Give Ups"
                  value={challengeInfo?.totalGiveUps ?? 0}
                  icon={GuessIcon}
                />
                <StatCard
                  title="Solve Rate"
                  value={`${Math.round(((challengeInfo?.totalSolves ?? 0) / (challengeInfo?.totalPlayers ?? 1)) * 100)}%`}
                  icon={() => (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      strokeWidth="2"
                      stroke="currentColor"
                      fill="none"
                    >
                      <path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" />
                      <path d="M12 7v5l3 3" />
                    </svg>
                  )}
                />
                <StatCard
                  title="Average Guesses"
                  value={Math.round(
                    (challengeInfo?.totalGuesses ?? 0) / (challengeInfo?.totalPlayers ?? 1)
                  )}
                  icon={() => (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      strokeWidth="2"
                      stroke="currentColor"
                      fill="none"
                    >
                      <path d="M3 12h4l3 8l4 -16l3 8h4" />
                    </svg>
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
      <ScoreBreakdownModal
        clickAnywhereToClose={false}
        isOpen={isScoreBreakdownOpen}
        onClose={() => setIsScoreBreakdownOpen(false)}
      />
    </>
  );
};
