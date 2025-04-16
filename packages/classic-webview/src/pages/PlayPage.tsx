import { useEffect, useState } from 'react';
import { sendMessageToDevvit } from '../utils';
import { WordInput } from '@hotandcold/webview-common/components/wordInput';
import { Guesses } from '../components/guesses';
import { useGame } from '../hooks/useGame';
import { useDevvitListener } from '../hooks/useDevvitListener';
import clsx from 'clsx';
import { FeedbackResponse } from '@hotandcold/classic-shared';
import { motion } from 'motion/react';

const FeedbackSection = () => {
  const [feedback, setFeedback] = useState<FeedbackResponse | null>(null);
  const message = useDevvitListener('FEEDBACK');

  useEffect(() => {
    if (!message) return;
    setFeedback(message);
  }, [message]);

  return (
    <div className="flex h-7 items-start justify-between gap-2">
      <p className="text-left text-xs text-[#EEF1F3]">{feedback?.feedback}</p>
      {feedback?.action != null && (
        <p
          className={clsx(
            'flex-shrink-0 text-right text-xs text-[#8BA2AD]',
            feedback.action.type !== 'NONE' && 'cursor-pointer underline'
          )}
          onClick={() => {
            switch (feedback.action!.type) {
              case 'HINT':
                sendMessageToDevvit({ type: 'HINT_REQUEST' });
                break;
              case 'GIVE_UP':
                sendMessageToDevvit({ type: 'GIVE_UP_REQUEST' });
                break;
              case 'NONE':
                break;
              default:
                throw new Error(
                  `Unknown action type: ${String(feedback.action!.type satisfies never)}`
                );
            }
          }}
        >
          {feedback.action.message}
        </p>
      )}
    </div>
  );
};

export const PlayPage = () => {
  const [word, setWord] = useState('');
  const { challengeUserInfo } = useGame();
  const guesses = challengeUserInfo?.guesses ?? [];

  const [showGuesses, setShowGuesses] = useState(guesses.length > 0); // Initial state based on guesses

  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-grow-0 flex-col items-center justify-center gap-6">
        <p className="text-center text-2xl font-bold text-white">Can you guess the secret word?</p>
        <div className="flex w-full flex-col gap-2">
          <WordInput
            value={word}
            onChange={(e) => setWord(e.target.value)}
            onSubmit={(animationDuration) => {
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
                setShowGuesses(true); // Show the guesses box after the submit animation
              }, animationDuration);
            }}
            placeholders={[
              'Can you guess the word?',
              'Any word will do to get started',
              'Try banana',
              'Or cat',
            ]}
          />
          <FeedbackSection />
        </div>
      </div>

      <motion.div // Animates the guesses sliding up from the bottom, which also pushes the word input up
        initial={false}
        animate={showGuesses ? { height: '100%', opacity: 1 } : { height: '0%', opacity: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut', delay: 0.6 }}
        className="overflow-hidden"
      >
        <Guesses items={guesses} />
      </motion.div>
    </div>
  );
};
