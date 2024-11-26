import React, { useEffect } from 'react';
import { useGame } from '../hooks/useGame';
import { cn, getPrettyDuration, sendMessageToDevvit } from '../utils';
import { useDevvitListener } from '../hooks/useDevvitListener';
import PillSwitch from '../components/switcher';
import { AnimatedNumber } from '../components/timer';

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
    className="h-5 w-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M10 4l2 1l2 -1" />
    <path d="M12 2v6.5l3 1.72" />
    <path d="M17.928 6.268l.134 2.232l1.866 1.232" />
    <path d="M20.66 7l-5.629 3.25l.01 3.458" />
    <path d="M19.928 14.268l-1.866 1.232l-.134 2.232" />
    <path d="M20.66 17l-5.629 -3.25l-2.99 1.738" />
    <path d="M14 20l-2 -1l-2 1" />
    <path d="M12 22v-6.5l-3 -1.72" />
    <path d="M6.072 17.732l-.134 -2.232l-1.866 -1.232" />
    <path d="M3.34 17l5.629 -3.25l-.01 -3.458" />
    <path d="M4.072 9.732l1.866 -1.232l.134 -2.232" />
    <path d="M3.34 7l5.629 3.25l2.99 -1.738" />
  </svg>
);

export const WinPage = () => {
  const { challengeInfo, challengeUserInfo } = useGame();
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [remindMeTomorrow, setRemindMeTomorrow] = React.useState(false);
  const leaderboardData = useDevvitListener('CHALLENGE_LEADERBOARD_RESPONSE');

  if (!challengeUserInfo || !challengeInfo) return null;

  useEffect(() => {
    sendMessageToDevvit({
      type: 'LEADERBOARD_FOR_CHALLENGE',
    });
  }, []);

  const didWin = !!challengeUserInfo.solvedAtMs;
  const word = challengeUserInfo.guesses?.find((x) => x.similarity === 1);
  const coldestGuess = challengeUserInfo.guesses?.reduce((prev, curr) =>
    prev.similarity < curr.similarity ? prev : curr
  );

  if (!word) throw new Error('No correct word found?');

  // Calculate percentile
  const playerRank = leaderboardData?.userRank?.score || 0;
  const totalPlayers = challengeInfo.totalPlayers || 1;
  // If you're rank 1 out of 100, you're in the 99th percentile
  // If you're rank 100 out of 100, you're in the 0th percentile
  const percentile = Math.max(
    0,
    Math.min(100, Math.round(((totalPlayers - playerRank) / totalPlayers) * 100))
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex justify-center">
        <PillSwitch
          activeIndex={activeIndex}
          onChange={setActiveIndex}
          items={[{ name: 'My Stats' }, { name: 'Challenge Stats' }, { name: 'Leaderboard' }]}
        />
      </div>

      <div className="mx-auto w-full max-w-xl px-4">
        {activeIndex === 0 && (
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="flex flex-col items-center gap-2">
              <h1 className="text-2xl font-bold text-white">
                {didWin ? 'Congratulations!' : 'Nice Try!'}
              </h1>
              <p className="text-xl font-semibold">
                The word was: <span className="text-[#dd4c4c]">{word.word}</span>
              </p>
            </div>

            <div className="flex flex-col items-center gap-2">
              {didWin ? (
                <AnimatedNumber
                  size={40}
                  value={challengeUserInfo.finalScore ?? 0}
                  animateOnMount
                />
              ) : (
                <span className="text-4xl">--</span>
              )}

              <p className="text-gray-400">
                {percentile ? (
                  <span>That's better than {percentile}% of players!</span>
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
                value={`#${leaderboardData?.userRank.score ?? '--'}`}
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
                  checked={remindMeTomorrow}
                  onChange={(e) => {
                    setRemindMeTomorrow(e.target.checked);

                    sendMessageToDevvit({
                      payload: {},
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
                  <span className="font-bold text-blue-400">#{leaderboardData.userRank.score}</span>
                </p>
              )}
            </div>

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
          </div>
        )}
      </div>
    </div>
  );
};
