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
import { HARDCORE_MAX_GUESSES } from '../constants';
import { useHardcoreAccess } from '../hooks/useHardcoreAccess';
import { PurchaseButton } from '../components/PurchaseButton';

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
  isHardcore: boolean,
  totalPlayers?: number,
  totalSolves?: number
): string => {
  if (isHardcore) {
    return `${HARDCORE_MAX_GUESSES} guesses. No hints. No mercy.`;
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
  guessCount,
  fontSize,
  isHardcore,
}: {
  guessCount: number;
  fontSize: number;
  isHardcore: boolean;
}) => {
  const value = isHardcore ? HARDCORE_MAX_GUESSES - guessCount : guessCount;
  const label = isHardcore ? ' guesses remaining' : 'Guesses: ';

  return (
    <span className="flex items-center justify-center gap-2">
      {!isHardcore && label}
      <AnimatedNumber value={value} size={fontSize} className="translate-y-px" />
      {isHardcore && label}
    </span>
  );
};

export const PlayPage = () => {
  const { mode } = useGame();
  const { access } = useHardcoreAccess();

  const isHardcore = mode === 'hardcore';

  let content;

  if (isHardcore && access.status !== 'active') {
    content = <UnlockHardcorePageContent />;
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

const UnlockHardcorePageContent = () => {
  return (
    <div className="flex w-full max-w-md flex-col items-center justify-center gap-4 p-6 sm:gap-6 sm:p-8 md:max-w-2xl md:p-10">
      <p className="text-xl font-bold text-white sm:text-2xl">100 guesses. No hints. No mercy.</p>
      <p className="text-sm font-normal text-gray-300">
        Unlocking Hardcore grants access to today and all previous hardcore puzzles.
      </p>
      <hr className="h-px w-1/2 max-w-xs bg-white/20"></hr>
      <div className="flex w-full flex-col items-center gap-4 py-2 sm:w-auto sm:flex-row sm:items-start">
        <PurchaseButton price={50} style="secondary" productSku="hardcore-mode-seven-day-access">
          Unlock for 7 days
        </PurchaseButton>
        <PurchaseButton price={250} style="primary" productSku="hardcore-mode-lifetime-access">
          Unlock FOREVER
        </PurchaseButton>
      </div>
      <p className="text-slate-400 text-center text-[12px] font-normal">
        Looking for today's puzzle?{' '}
        <span className="underline decoration-solid underline-offset-auto">Click here</span>
      </p>
    </div>
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
    isHardcore,
    challengeInfo?.totalPlayers,
    challengeInfo?.totalSolves
  );

  return (
    <div className="flex w-full max-w-md flex-grow-0 flex-col items-center justify-center gap-6">
      <p className="text-center text-2xl font-bold text-white">
        {hasGuessed ? (
          <GuessesMessage fontSize={21} isHardcore={isHardcore} guessCount={guesses.length} />
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
        <div className="mt-3 min-h-7">
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
