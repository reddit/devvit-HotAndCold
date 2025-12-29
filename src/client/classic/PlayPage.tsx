import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { WordInput } from '../shared/wordInput';
import { Guesses } from '../shared/guesses';
import type { GuessEngine, GuessHistoryItem } from '../core/guessEngine';
import { formatOrdinal } from '../../shared/ordinal';
import { formatCompactNumber } from '../../shared/formatCompactNumber';
import { context } from '@devvit/web/client';
import { openHowToPlay } from './state/howToPlay';
import { posthog } from '../posthog';
import { trpc } from '../trpc';
import { getBrowserIanaTimeZone } from '../../shared/timezones';
import { setReminderOptIn, userSettings } from './state/userSettings';

type PlayPrompt = 'JOIN_SUBREDDIT' | 'REMIND_ME_TO_PLAY';
type ReactNode = ComponentChildren;

const generateOnboarding = (arr: GuessHistoryItem[]): string | null => {
  if (!arr || arr.length === 0) return null;
  const MESSAGES = [
    `"${arr[0]!.word}" is the ${formatOrdinal(arr[0]!.rank)} closest. Smaller number = closer.`,
    'Keep guessing! Try as many as you want.',
    "Try to get under 1000. That's when it gets interesting!",
    'Stuck? Grab a hint from the menu.',
  ] as const;

  const idx = Math.min(arr.length, 5) - 1; // 0..4
  return MESSAGES[idx] ?? null;
};

const evaluatePrompt = ({
  guessCount,
  joinedSubreddit,
  hasReminders,
}: {
  guessCount: number;
  joinedSubreddit: boolean | null;
  hasReminders: boolean;
}): PlayPrompt | null => {
  if (!context.userId) return null;
  if (joinedSubreddit === false && guessCount > 15) {
    return 'JOIN_SUBREDDIT';
  }
  if (hasReminders === false && guessCount > 25) {
    return 'REMIND_ME_TO_PLAY';
  }
  return null;
};

const PROMPT_MESSAGES: Record<PlayPrompt, string> = {
  JOIN_SUBREDDIT: 'Team up with the crew on Reddit?',
  REMIND_ME_TO_PLAY: 'Want a reminder when a new puzzle drops?',
};

const getPromptMessage = (prompt: PlayPrompt | null): string | null => {
  if (!prompt) return null;
  if (prompt === 'JOIN_SUBREDDIT') {
    const subredditName = context.subredditName ?? 'the crew';
    return `Team up with r/${subredditName}?`;
  }
  return PROMPT_MESSAGES[prompt] ?? null;
};

export function PlayPage({ engine }: { engine?: GuessEngine }) {
  const [feedback, setFeedback] = useState<ReactNode | null>(null);
  const [hasJoinedSubreddit, setHasJoinedSubreddit] = useState<boolean | null>(
    context.userId ? null : true
  );
  const [hasReminders, setHasReminders] = useState<boolean>(
    userSettings.value.isUserOptedIntoReminders
  );
  const [isJoinLoading, setIsJoinLoading] = useState(false);
  const [isReminderLoading, setIsReminderLoading] = useState(false);
  const lastFeedbackMessage = useRef<string | null>(null);
  const lastFeedbackPrompt = useRef<PlayPrompt | null>(null);

  const { items, itemsArray, latest } = useMemo(() => {
    const itemsSignal = engine ? engine.history : null;
    const arr = itemsSignal ? (itemsSignal.value ?? []) : [];
    const last = arr.length > 0 ? arr.reduce((a, b) => (a.timestamp > b.timestamp ? a : b)) : null;
    return { items: itemsSignal, itemsArray: arr, latest: last } as const;
  }, [engine, engine?.history.value]);

  const totalPlayers = Number(context.postData?.totalPlayers ?? 0);
  const totalSolves = Number(context.postData?.totalSolves ?? 0);
  const solveRatePct = totalPlayers > 0 ? Math.round((totalSolves / totalPlayers) * 100) : 0;

  useEffect(() => {
    if (!context.userId) return;
    let isMounted = true;
    void (async () => {
      try {
        const joined = await trpc.cta.hasJoinedSubreddit.query();
        if (isMounted) {
          setHasJoinedSubreddit(joined);
        }
      } catch (err) {
        console.error('Failed to determine subreddit membership', err);
        if (isMounted) {
          setHasJoinedSubreddit(null);
        }
      }
      try {
        const optedIn = await trpc.cta.isOptedIntoReminders.query();
        if (isMounted) {
          setHasReminders(optedIn);
          setReminderOptIn(optedIn);
        }
      } catch (err) {
        console.error('Failed to determine reminder preference', err);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const buildFeedbackNode = useCallback(
    (message: string, prompt: PlayPrompt) => {
      if (!context.userId) return <span>{message}</span>;
      if (prompt === 'JOIN_SUBREDDIT') {
        const subredditName = context.subredditName ?? 'the crew';
        return (
          <>
            <span>{message}</span>
            <button
              type="button"
              className="self-start text-[10px] font-semibold underline underline-offset-2 cursor-pointer"
              onClick={handleJoinSubreddit}
              disabled={isJoinLoading}
            >
              {isJoinLoading ? 'Joining…' : `Join r/${subredditName}`}
            </button>
          </>
        );
      }
      return (
        <>
          <span>{message}</span>
          <button
            type="button"
            className="self-start text-[10px] font-semibold underline underline-offset-2 cursor-pointer"
            onClick={handleEnableReminders}
            disabled={isReminderLoading}
          >
            {isReminderLoading ? 'Enabling…' : 'Ping me'}
          </button>
        </>
      );
    },
    [isJoinLoading, isReminderLoading]
  );

  const showFeedback = useCallback(
    (message: string, prompt: PlayPrompt | null) => {
      lastFeedbackMessage.current = message;
      lastFeedbackPrompt.current = prompt;
      if (!prompt || !context.userId) {
        setFeedback(<span>{message}</span>);
        return;
      }
      setFeedback(buildFeedbackNode(message, prompt));
    },
    [buildFeedbackNode]
  );

  useEffect(() => {
    if (!lastFeedbackMessage.current || !lastFeedbackPrompt.current) return;
    setFeedback(buildFeedbackNode(lastFeedbackMessage.current, lastFeedbackPrompt.current));
  }, [buildFeedbackNode]);

  async function handleJoinSubreddit() {
    if (!context.userId) return;
    setIsJoinLoading(true);
    posthog.capture('Game Page Join Subreddit Prompt Clicked');
    try {
      await trpc.cta.joinSubreddit.mutate({});
      posthog.setPersonProperties({ joined_subreddit: true });
      setHasJoinedSubreddit(true);
      const guessCount = engine ? (engine.history.value ?? []).length : itemsArray.length;
      const nextPrompt = evaluatePrompt({
        guessCount,
        joinedSubreddit: true,
        hasReminders,
      });
      const upbeat = nextPrompt ? 'Welcome aboard! Keep the streak alive.' : 'Welcome aboard!';
      showFeedback(upbeat, nextPrompt);
    } catch (err) {
      console.error('Failed to join subreddit', err);
      showFeedback("Couldn't join right now—try again in a bit?", 'JOIN_SUBREDDIT');
    } finally {
      setIsJoinLoading(false);
    }
  }

  async function handleEnableReminders() {
    if (!context.userId) return;
    setIsReminderLoading(true);
    posthog.capture('Game Page Reminder Prompt Clicked');
    try {
      const timezone = getBrowserIanaTimeZone();
      await trpc.cta.setReminder.mutate({ timezone });
      posthog.setPersonProperties({ opted_into_reminders: true });
      setHasReminders(true);
      setReminderOptIn(true);
      const guessCount = engine ? (engine.history.value ?? []).length : itemsArray.length;
      const nextPrompt = evaluatePrompt({
        guessCount,
        joinedSubreddit: hasJoinedSubreddit,
        hasReminders: true,
      });
      const upbeat = nextPrompt
        ? 'Daily pings on—ready for tomorrow?'
        : 'Daily pings on! See you soon.';
      showFeedback(upbeat, nextPrompt);
    } catch (err) {
      console.error('Failed to enable reminders', err);
      showFeedback('Reminders hiccuped—give it another tap?', 'REMIND_ME_TO_PLAY');
    } finally {
      setIsReminderLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-center text-2xl font-bold">
        {itemsArray.length > 0 ? `Guesses: ${itemsArray.length}` : 'Can you guess the secret word?'}
      </h1>

      <div className="relative mx-auto w-full max-w-xl pb-6">
        <WordInput
          placeholders={['Try banana', 'Try apple', 'Try pizza']}
          isHighContrast
          submitGuess={async (word) => {
            if (!engine) return null;
            const res = await engine.submit(word);
            if (res.ok) {
              const historyNow = engine.history.value ?? [];
              const msg =
                res.rank === 1
                  ? 'Scorching guess! One more to crack it.'
                  : generateOnboarding(historyNow as GuessHistoryItem[]);
              const guessCount = historyNow.length;
              const milestoneMessage =
                guessCount === 10 ? "Don't forget to upvote for good luck!" : null;
              const nextPrompt = evaluatePrompt({
                guessCount,
                joinedSubreddit: hasJoinedSubreddit,
                hasReminders,
              });
              const baseMessage =
                milestoneMessage ?? msg ?? getPromptMessage(nextPrompt) ?? 'Keep it rolling!';
              showFeedback(baseMessage, nextPrompt);
            } else {
              showFeedback(res.message, null);
            }
            return res;
          }}
          onFeedback={(msg) => showFeedback(msg, null)}
          className="mt-4"
        />
        {feedback && (
          <div className="absolute left-0 right-0 bottom-[7px] flex justify-start gap-1 text-[10px] text-gray-600 dark:text-zinc-300">
            {feedback}
          </div>
        )}
      </div>
      {items?.value?.length ? (
        <Guesses items={items as any} latest={latest} />
      ) : (
        <div className="flex flex-1 min-h-0 flex-col gap-4 items-center">
          <p className="text-sm dark:text-gray-400 text-gray-600">
            {totalPlayers > 0
              ? `${solveRatePct}% of ${formatCompactNumber(totalPlayers)} players have succeeded`
              : "You're the first to play!"}
          </p>
          <button
            className={
              'text-sm rounded-md px-4 py-2 cursor-pointer bg-gray-200 text-black hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600'
            }
            onClick={() => {
              posthog.capture('Game Page How to Play Button Below Input Clicked');

              openHowToPlay();
            }}
          >
            How to Play
          </button>
        </div>
      )}
    </>
  );
}

export default PlayPage;
