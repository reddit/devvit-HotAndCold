import { useState } from 'react';
import { useSetPage } from '../hooks/usePage';
import { postMessage } from '../utils';

export const SplashPage = () => {
  const [guess, setGuess] = useState('');
  const [loading, setLoading] = useState(false);
  const setPage = useSetPage();

  return (
    <div className="flex flex-col gap-4 justify-center">
      <p>Hot and Cold</p>
      <p>Guess any word to start</p>
      <input onChange={(e) => setGuess(e.target.value)} value={guess} />
      <button
        className="size-4"
        disabled={loading}
        onClick={async () => {
          setPage('play');
          setLoading(true);

          postMessage({
            type: 'WORD_SUBMITTED',
            value: guess.trim().toLowerCase(),
          });
        }}
      >
        {loading ? 'Loading...' : 'Play'}
      </button>
    </div>
  );
};
