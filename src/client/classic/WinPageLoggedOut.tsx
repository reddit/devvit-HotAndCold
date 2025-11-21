import { useEffect, useState, useMemo } from 'preact/hooks';
import { trpc } from '../trpc';
import type { GuessEngine } from '../core/guessEngine';
import { requireChallengeNumber } from '../requireChallengeNumber';

export function WinPageLoggedOut({ engine }: { engine: GuessEngine }) {
  const [secretWord, setSecretWord] = useState<string | null>(null);
  const challengeNumber = requireChallengeNumber();

  // Determine if they won locally
  const wonLocally = useMemo(() => {
    const history = engine.history.value ?? [];
    return history.some((h) => h.similarity === 1);
  }, [engine.history.value]);

  // If they won, we can grab the word from history.
  // If they gave up, we need to fetch it from the server.
  useEffect(() => {
    if (wonLocally) {
      const history = engine.history.value ?? [];
      const winningGuess = history.find((h) => h.similarity === 1);
      if (winningGuess) {
        setSecretWord(winningGuess.word);
      }
    } else {
      // Gave up -> fetch reveal
      void (async () => {
        try {
          const res = await trpc.game.reveal.query({ challengeNumber });
          if (res?.secretWord) {
            setSecretWord(res.secretWord);
          }
        } catch (e) {
          console.error('Failed to reveal word', e);
        }
      })();
    }
  }, [wonLocally, challengeNumber, engine.history.value]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          {wonLocally ? 'Congratulations!' : 'Game Over!'}
        </h1>
        <p className="text-xl">
          The word was: <span className="font-bold text-[#dd4c4c]">{secretWord ?? '...'}</span>
        </p>
        <p className="text-lg text-gray-600 dark:text-gray-300 mt-4">
          Sign up to see the full leaderboard and save your progress.
        </p>
      </div>
    </div>
  );
}
