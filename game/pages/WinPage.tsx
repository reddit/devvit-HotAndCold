import { useEffect } from 'react';
import { useGame } from '../hooks/useGame';
import { getPrettyDuration, sendMessageToDevvit } from '../utils';
import { useDevvitListener } from '../hooks/useDevvitListener';

export function prettyPercentage(value: number, decimals: number = 2): string {
  // Handle edge cases
  if (isNaN(value) || !isFinite(value)) {
    return '--';
  }

  // Convert to percentage and round to specified decimals
  const percentage = value * 100;
  const rounded = Number(percentage.toFixed(decimals));

  // Format with thousands separator and percentage symbol
  return `${rounded.toLocaleString()}%`;
}

export const WinPage = () => {
  const { challengeInfo, challengeUserInfo } = useGame();
  const leaderboardData = useDevvitListener('CHALLENGE_LEADERBOARD_RESPONSE');

  if (!challengeUserInfo || !challengeInfo) return null;

  useEffect(() => {
    sendMessageToDevvit({
      type: 'LEADERBOARD_FOR_CHALLENGE',
    });
  }, []);

  const didWin = !!challengeUserInfo.solvedAtMs;
  const word = challengeUserInfo.guesses?.find((x) => x.similarity === 1);

  if (!word) {
    throw new Error(`No correct word found?`);
  }

  return (
    <div className="flex flex-col gap-6 text-sm">
      <div className="flex gap-6">
        <div>
          <h1>{didWin ? 'Nice word!' : 'Try again tomorrow?'}</h1>
          <p>Join the conversation below to talk about your journey!</p>
          <p>Send me a message to play again tomorrow? {'<ADD TOGGLE>'}</p>
          <p>Word: {word.word}</p>
          <p>Your stats:</p>
          <ul>
            <li>Total guesses: {challengeUserInfo.guesses?.length ?? 0}</li>
            <li>Total hints: {challengeUserInfo.guesses?.filter((x) => x.isHint).length ?? 0}</li>
            <li>Score: {challengeUserInfo.finalScore ?? 0}</li>
            {didWin && (
              <li>
                Time to solve:{' '}
                {getPrettyDuration(
                  new Date(challengeUserInfo.startedPlayingAtMs!),
                  new Date(challengeUserInfo.solvedAtMs!)
                )}
              </li>
            )}
          </ul>
        </div>
        <div>
          <p>Leaderboard</p>
          <p>your rank: {leaderboardData?.userRank?.score}</p>
          {leaderboardData?.leaderboardByScore.map((x, i) => {
            return (
              <p key={x.member}>
                <span className="font-bold">{i + 1}.&nbsp;</span>
                <span>{x.member}: </span>
                <span>{x.score}</span>
              </p>
            );
          })}
        </div>
      </div>
      <div>
        <p>Challenge Metrics:</p>
        <p>Total players: {challengeInfo?.totalPlayers ?? '0'}</p>
        <p>Total solves: {challengeInfo?.totalSolves ?? '0'}</p>
        <p>
          Solve rate:{' '}
          {prettyPercentage((challengeInfo?.totalSolves ?? 0) / (challengeInfo.totalPlayers ?? 0))}
        </p>
        <p>Total guesses: {challengeInfo?.totalGuesses ?? '0'}</p>
        <p>Total give ups: {challengeInfo?.totalGiveUps ?? '0'}</p>
        <p>Total hints: {challengeInfo?.totalHints ?? '0'}</p>
      </div>
    </div>
  );
};
