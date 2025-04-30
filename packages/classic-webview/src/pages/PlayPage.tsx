import { useEffect, useState } from 'react';
import { sendMessageToDevvit } from '../utils';
import { WordInput } from '@hotandcold/webview-common/components/wordInput';
import { Guesses } from '../components/guesses';
import { useGame } from '../hooks/useGame';
import { useDevvitListener } from '../hooks/useDevvitListener';
import clsx from 'clsx';
import { FeedbackResponse } from '@hotandcold/classic-shared';
import { motion } from 'motion/react';
import { AnimatedNumber } from '@hotandcold/webview-common/components/timer';
import { PageContentContainer } from '../components/pageContentContainer';
import { cn } from '@hotandcold/webview-common/utils';
import { useHardcoreAccess } from '../hooks/useHardcoreAccess';
import { UnlockHardcoreCTAContent } from '../components/UnlockHardcoreCTAContent';

const useFeedback = (): { feedback: FeedbackResponse | null; dismissFeedback: () => void } => {
  const [feedback, setFeedback] = useState<FeedbackResponse | null>(null);
  const message = useDevvitListener('FEEDBACK');

  useEffect(() => {
    if (!message) return;
    setFeedback(message);
  }, [message]);

  const dismissFeedback = () => {
    setFeedback(null);
  };

  return { feedback, dismissFeedback };
};

const FeedbackSection = ({ feedback }: { feedback: FeedbackResponse | null }) => {
  return (
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

const getWelcomeMessage = (
  allowedGuessCount?: number,
  totalPlayers?: number,
  totalSolves?: number
): string => {
  if (allowedGuessCount !== undefined) {
    return `${allowedGuessCount} guesses. No hints. No mercy.`;
  }

  if (
    totalPlayers === undefined ||
    totalSolves === undefined ||
    totalPlayers === 0 ||
    totalSolves === 0
  ) {
    return 'Be the first to solve this challenge!';
  }

  const percentOfWinners = Math.round((totalSolves / totalPlayers) * 100);
  return `${percentOfWinners}% of ${totalPlayers} players have succeeded`;
};

const GuessesMessage = ({
  allowedGuessCount,
  guessCount,
  fontSize,
}: {
  allowedGuessCount?: number;
  guessCount: number;
  fontSize: number;
}) => {
  const hasGuessLimit = allowedGuessCount !== undefined;
  const value = hasGuessLimit ? allowedGuessCount - guessCount : guessCount;
  const label = hasGuessLimit ? ' guesses remaining' : 'Guesses: ';

  // Calculate percentage of guesses used.
  // Only apply colors in hardcore mode.
  const percentageUsed = hasGuessLimit ? guessCount / allowedGuessCount : 0;

  return (
    <span
      className={cn('flex items-center justify-center gap-2', {
        'text-yellow-500': percentageUsed >= 0.7,
        'text-red-500': percentageUsed >= 0.9,
      })}
    >
      {!hasGuessLimit && label}
      <AnimatedNumber value={value} size={fontSize} className="translate-y-px" />
      {hasGuessLimit && label}
    </span>
  );
};

export const PlayPage = () => {
  const { mode } = useGame();
  const { access } = useHardcoreAccess();

  const isHardcore = mode === 'hardcore';

  let content;

  if (isHardcore && access.status !== 'active') {
    content = <UnlockHardcoreCTAContent withLinkToTodaysPuzzle />;
  } else {
    content = <GameplayContent />;
  }

  return (
    <PageContentContainer
      showContainer={isHardcore}
      className="flex flex-col items-center justify-center"
    >
      {content}
    </PageContentContainer>
  );
};

const GameplayContent = () => {
  const [word, setWord] = useState('');
  const { challengeUserInfo, mode, challengeInfo } = useGame();
  const { feedback, dismissFeedback } = useFeedback();

  const guesses = challengeUserInfo?.guesses ?? [];
  const hasGuessed = guesses.length > 0;
  const [guessesAnimationCount, setGuessesAnimationCount] = useState(0); // Used to trigger re-measurement of the pagination

  const isHardcore = mode === 'hardcore';
  const showFeedback = feedback || hasGuessed;
  const welcomeMessage = getWelcomeMessage(
    challengeInfo?.allowedGuessCount,
    challengeInfo?.totalPlayers,
    challengeInfo?.totalSolves
  );

  return (
    <div className="flex h-full w-full max-w-md flex-grow-0 flex-col items-center justify-center gap-6">
      <p className="text-center text-2xl font-bold text-white">
        {hasGuessed ? (
          <GuessesMessage
            fontSize={21}
            allowedGuessCount={challengeInfo?.allowedGuessCount}
            guessCount={guesses.length}
          />
        ) : (
          `Can you guess the secret word?`
        )}
      </p>
      <div className="flex w-full flex-col gap-2">
        <WordInput
          value={word}
          isHighContrast={isHardcore}
          onChange={(e) => {
            setWord(e.target.value);
            dismissFeedback(); // Hide feedback when typing
          }}
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
        <div className="min-h-7">
          {showFeedback ? (
            <FeedbackSection feedback={feedback} />
          ) : (
            <p
              className={cn(
                'text-center text-base',
                isHardcore ? 'font-bold text-white' : 'text-[#8BA2AD]'
              )}
            >
              {welcomeMessage}
            </p>
          )}
        </div>
      </div>

      <motion.div // Animates the guesses sliding up from the bottom, which also pushes the word input up
        initial={false}
        animate={hasGuessed ? { height: '100%', opacity: 1 } : { height: '0', opacity: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
        className="overflow-hidden"
        onAnimationComplete={() => {
          setGuessesAnimationCount((c) => c + 1);
        }}
      >
        <Guesses items={guesses} updatePaginationSeed={guessesAnimationCount} />
      </motion.div>
    </div>
  );
};
