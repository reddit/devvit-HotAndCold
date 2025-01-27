import { useGame } from '../hooks/useGame';
import { getPrettyDuration } from '@hotandcold/webview-common/utils';

export const WinPage = () => {
  const { challengeInfo } = useGame();
  if (!challengeInfo || !challengeInfo.word) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-4">
      <div className="mb-4 text-3xl font-bold">Raid Complete!</div>
      <div className="rounded-sm border px-6 py-4 text-xl font-bold">{challengeInfo.word}</div>
      <img
        src={challengeInfo.solvingUserSnoovatar ?? 'assets/default_snoovatar.png'}
        className="w-[65px] object-contain"
      />
      <div className="text-lg font-semibold">Solved by: u/{challengeInfo.solvingUser}</div>
      <div className="text-lg font-semibold">
        Time to solve:{' '}
        {getPrettyDuration(
          new Date(challengeInfo.startedAtMs!),
          new Date(challengeInfo.solvedAtMs!)
        )}
      </div>
    </div>
  );
};
