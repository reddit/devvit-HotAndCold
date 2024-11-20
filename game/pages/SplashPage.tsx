import { ComponentProps, useEffect, useState } from 'react';
import { sendMessageToDevvit } from '../utils';
import { WordInput } from '../components/wordInput';
import { Guesses } from '../components/guesses';
import { Timer } from '../components/timer';
import { useGame } from '../hooks/useGame';
import { SecondaryButton } from '../components/button';
import { Modal } from '../components/modal';

const HowToPlayModal = (props: Omit<ComponentProps<typeof Modal>, 'children'>) => {
  return (
    <Modal {...props}>
      <div className="p-6">
        <h3 className="mb-4 text-xl font-bold text-white">How to Play</h3>
        <p className="mb-4 text-gray-300">
          Guess the secret word by entering words with similar meanings. Words are scored based on
          how semantically related they are to the target word.
        </p>
        <div className="space-y-4">
          <p className="text-gray-300">Example: If the secret word is "ocean":</p>
          <ul className="space-y-2">
            <li className="flex items-center space-x-2">
              <span className="rounded bg-red-600 px-2 py-1 text-white dark:bg-red-500">sea</span>
              <span className="text-gray-300">would score 95+ (nearly identical meaning)</span>
            </li>
            <li className="flex items-center space-x-2">
              <span className="rounded bg-orange-500 px-2 py-1 text-white dark:bg-orange-400">
                wave
              </span>
              <span className="text-gray-300">would score 90-94 (strongly related)</span>
            </li>
            <li className="flex items-center space-x-2">
              <span className="rounded bg-yellow-500 px-2 py-1 text-black dark:bg-yellow-400 dark:text-black">
                beach
              </span>
              <span className="text-gray-300">would score 80-89 (related)</span>
            </li>
            <li className="flex items-center space-x-2">
              <span className="rounded bg-green-500 px-2 py-1 text-white dark:bg-green-400">
                boat
              </span>
              <span className="text-gray-300">would score 45-79 (somewhat related)</span>
            </li>
            <li className="flex items-center space-x-2">
              <span className="rounded bg-blue-500 px-2 py-1 text-white dark:bg-blue-400">
                tree
              </span>
              <span className="text-gray-300">would score 30-44 (distantly related)</span>
            </li>
            <li className="flex items-center space-x-2">
              <span className="rounded bg-purple-500 px-2 py-1 text-white dark:bg-purple-400">
                calculator
              </span>
              <span className="text-gray-300">would score 0-29 (unrelated)</span>
            </li>
          </ul>
        </div>
        <p className="mt-4 italic text-gray-300">
          Think about synonyms, categories, and related concepts to find the secret word.
        </p>
      </div>
    </Modal>
  );
};

export const SplashPage = () => {
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const [word, setWord] = useState('');
  const { challengeUserInfo } = useGame();

  return (
    <div className="flex flex-col justify-center gap-4 p-4">
      <Timer startTime={challengeUserInfo?.startedPlayingAtMs ?? Date.now()} maxValue={9999} />
      <h1 className="text-white">Hot And Cold</h1>
      <p className="text-white">Guess the secret word by meaning</p>
      <WordInput
        value={word}
        onChange={(e) => setWord(e.target.value)}
        onSubmit={() => {
          if (word.trim().split(' ').length > 1) {
            sendMessageToDevvit({
              type: 'SHOW_TOAST',
              string: 'I only understand one word at a time.',
            });
            return;
          }

          sendMessageToDevvit({
            type: 'WORD_SUBMITTED',
            value: word.trim().toLowerCase(),
          });
          // TODO Store previous in case we need to replenish due to errors
          setWord('');
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
        <SecondaryButton onClick={() => setHowToPlayOpen(true)}>How to Play</SecondaryButton>
      </div>
      <Guesses items={challengeUserInfo?.guesses ?? []} />
      <HowToPlayModal isOpen={howToPlayOpen} onClose={() => setHowToPlayOpen(false)} />
    </div>
  );
};
