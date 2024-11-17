import { useState } from 'react';
import { sendMessageToDevvit } from '../utils';
import { WordInput } from '../components/wordInput';
import { Guesses } from '../components/guesses';
import { Timer } from '../components/timer';
import { useGame } from '../hooks/useGame';
import { SecondaryButton } from '../components/button';

export const SplashPage = () => {
  const [loading, setLoading] = useState(false);
  const [word, setWord] = useState('');
  const { challengeUserInfo } = useGame();

  return (
    <div className="flex flex-col gap-4 justify-center p-4">
      <Timer startTime={challengeUserInfo?.startedPlayingAtMs ?? Date.now()} maxValue={9999} />
      <h1 className="text-white">Hot And Cold</h1>
      <p className="text-white">Guess the secret word by meaning</p>
      <WordInput
        onChange={(e) => setWord(e.target.value)}
        onSubmit={() => {
          sendMessageToDevvit({
            type: 'WORD_SUBMITTED',
            value: word.trim().toLowerCase(),
          });
          // TODO Store previous in case we need to replenish due to errors
          setWord('');
          setLoading(true);
        }}
        placeholders={['Can you guess the word?', 'Try banana', 'Try dog']}
      />
      <div className="flex items-center justify-center gap-4">
        <SecondaryButton
          onClick={() => {
            sendMessageToDevvit({
              type: 'HINT_REQUEST',
            });
          }}
        >
          Hint
        </SecondaryButton>
        <SecondaryButton
          onClick={() => {
            sendMessageToDevvit({
              type: 'GIVE_UP_REQUEST',
            });
          }}
        >
          Give Up
        </SecondaryButton>
      </div>
      <Guesses items={challengeUserInfo?.guesses ?? []} />
    </div>
  );
};
