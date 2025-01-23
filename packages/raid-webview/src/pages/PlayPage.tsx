import { useEffect, useState } from 'react';
import { sendMessageToDevvit } from '../utils';
import { WordInput } from '@hotandcold/webview-common/components/wordInput';
import { Guesses, GuessItem } from '../components/guesses';
import { useGame } from '../hooks/useGame';
import { useDevvitListener } from '../hooks/useDevvitListener';
import clsx from 'clsx';
import { FeedbackResponse, Guess } from '@hotandcold/raid-shared';
import { GuessTicker } from '../components/guessTicker';

const FeedbackSection = () => {
  const [feedback, setFeedback] = useState<FeedbackResponse | null>(null);
  const message = useDevvitListener('FEEDBACK');
  const { challengeUserInfo } = useGame();

  const latestGuess = challengeUserInfo?.guesses?.reduce(
    (latest, current) => {
      return !latest || current.timestamp > latest.timestamp ? current : latest;
    },
    null as Guess | null
  );

  useEffect(() => {
    if (!message) return;
    setFeedback(message);
  }, [message]);

  return (
    <div className="h-7">
      {feedback ? (
        <div className="flex items-start justify-between gap-2">
          <p className="text-left text-xs text-[#EEF1F3]">{feedback?.feedback}</p>
          {feedback?.action != null && (
            <p
              className={clsx(
                'flex-shrink-0 text-right text-xs text-[#8BA2AD]',
                feedback.action.type !== 'NONE' && 'cursor-pointer underline'
              )}
              onClick={() => {
                switch (feedback.action!.type) {
                  case 'NONE':
                    break;
                  default:
                    throw new Error(
                      `Unknown action type: ${feedback.action!.type satisfies never}`
                    );
                }
              }}
            >
              {feedback.action.message}
            </p>
          )}
        </div>
      ) : latestGuess ? (
        <div className="flex justify-center">
          <div className="w-[160px]">
            <GuessItem item={latestGuess} variant="user" highlight={true} />
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const PlayPage = () => {
  const [word, setWord] = useState('');
  const { challengeUserInfo, challengeTopGuesses } = useGame();

  return (
    <div className="flex h-full flex-col justify-center gap-6">
      <div className="flex flex-col items-center justify-center gap-6">
        <GuessTicker />
        <div className="flex w-full max-w-xl flex-col gap-2">
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
      <div className="flex flex-1 justify-center gap-4">
        <Guesses
          items={challengeTopGuesses ?? []}
          title="Top Guesses"
          variant="community"
          emptyState="Top guesses from the community will appear here."
        />
        <Guesses
          items={challengeUserInfo?.guesses ?? []}
          title="Your Guesses"
          variant="user"
          emptyState="Make a guess to play!"
        />
      </div>
    </div>
  );
};
