import { useState } from 'react';
import { sendMessageToDevvit } from '../utils';
import { WordInput } from '../components/wordInput';
import { Guesses } from '../components/guesses';
import { useGame } from '../hooks/useGame';
import { SecondaryButton } from '../components/button';
import { Logo } from '../components/logo';
import { HowToPlayModal } from '../components/howToPlayModal';
import { Progress } from '../components/progress';
import { useSetUserSettings, useUserSettings } from '../hooks/useUserSettings';
import { AnimatedNumber } from '../components/timer';

export const SplashPage = () => {
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const setUserSettings = useSetUserSettings();
  const { sortType } = useUserSettings();

  const [word, setWord] = useState('');
  const { challengeUserInfo, number } = useGame();
  const hasGuessed = challengeUserInfo?.guesses && challengeUserInfo?.guesses?.length > 0;

  return (
    <div className="flex h-full flex-col justify-center gap-6 p-4">
      <div className="flex h-4 items-center justify-between">
        {number && <p className="text-sm text-gray-500">Challenge #{number}</p>}

        {challengeUserInfo?.guesses && (
          <div className="flex">
            <p className="text-sm text-gray-500">Guesses:&nbsp;</p>
            <AnimatedNumber
              className="text-gray-500"
              size={14}
              value={challengeUserInfo.guesses?.length}
            />
          </div>
        )}
      </div>
      <div className="mb-[10px] flex justify-center">
        <Logo />
      </div>
      <div className="flex flex-col items-center justify-center gap-6">
        <p className="text-center text-xl text-white">Can you guess today's word?</p>
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

            setTimeout(() => {
              setWord('');
            }, 400);
          }}
          placeholders={[
            'Can you guess the word?',
            'Any word will do to get started',
            'Try banana',
            'Or cat',
          ]}
        />
      </div>
      {/* Fixed height for no jank */}
      <div className="h-[20px]">
        {hasGuessed && (
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
            <SecondaryButton
              onClick={() =>
                setUserSettings((x) => ({
                  ...x,
                  sortType: sortType === 'SIMILARITY' ? 'TIMESTAMP' : 'SIMILARITY',
                }))
              }
            >
              Sort by {sortType === 'SIMILARITY' ? 'Guessed At' : 'Similarity'}
            </SecondaryButton>
          </div>
        )}
      </div>
      <Guesses items={challengeUserInfo?.guesses ?? []} />
      <Progress />
      <HowToPlayModal isOpen={howToPlayOpen} onClose={() => setHowToPlayOpen(false)} />
    </div>
  );
};
