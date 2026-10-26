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
import { userSettings } from './state/userSettings';
import { gameAudio, guessTemperature, soundEnabled } from './feedback/audio';
import { GuessTemperature, useTemperatureFeedback } from './feedback/temperature';
import { GuessActions } from './guessActions';
import { updateReminders } from './state/reminders';
import { bestGuessHeat } from '../shared/guessHeat';
import { startSoundOnGuess } from './feedback/controls';

type PlayPrompt = 'JOIN_SUBREDDIT' | 'REMIND_ME_TO_PLAY';
type ReactNode = ComponentChildren;

const generateOnboarding = (arr: GuessHistoryItem[]): string | null => {
  if (!arr || arr.length === 0) return null;
  const MESSAGES = [
    `"${arr[0]!.word}" is the ${formatOrdinal(arr[0]!.rank)} closest. Smaller number = closer.`,
    'Keep guessing! Try as many as you want.',
    "Try to get under 1000. That's when it gets interesting!",
    'Hints unlock after 5 guesses below the input.',
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
  const { showTemperature, ...temperatureFeedback } = useTemperatureFeedback();
  const [feedback, setFeedback] = useState<ReactNode | null>(null);
  const [hasJoinedSubreddit, setHasJoinedSubreddit] = useState<boolean | null>(
    context.userId ? null : true
  );
  const hasReminders = userSettings.value.isUserOptedIntoReminders;
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

  useEffect(() => {
    // Include restored history and hints, and retain each milestone on colder guesses.
    void gameAudio.setLevel(bestGuessHeat(itemsArray));
  }, [itemsArray]);

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
              className="cursor-pointer self-start text-[10px] font-semibold underline underline-offset-2"
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
            className="cursor-pointer self-start text-[10px] font-semibold underline underline-offset-2"
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
      if ((await updateReminders('enable')) !== true) throw new Error('Reminder update failed');
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

      <GuessTemperature {...temperatureFeedback} rank={latest?.rank ?? null} />

      <div className="relative mx-auto grid w-full max-w-xl grid-cols-[minmax(0,1fr)_auto] gap-x-2">
        <WordInput
          placeholders={['Try banana', 'Try apple', 'Try pizza']}
          isHighContrast
          submitGuess={async (word) => {
            if (!engine) return null;
            startSoundOnGuess();
            const before = engine.history.value ?? [];
            const previous = before.reduce<GuessHistoryItem | null>(
              (last, item) => (!last || item.timestamp >= last.timestamp ? item : last),
              null
            );
            const res = await engine.submit(word);
            if (res.ok) {
              const direction = guessTemperature(previous?.rank, res.rank);
              if (res.similarity === 1 && !before.some((guess) => guess.word === res.word)) {
                void gameAudio.finish('win', soundEnabled.value);
              } else if (direction && !before.some((guess) => guess.word === res.word)) {
                void gameAudio.cue(direction);
                showTemperature(direction);
              }
              const historyNow = engine.history.value ?? [];
              const notVeryCloseMessage =
                res.rank != null && res.rank < 0
                  ? `“${res.word}” isn't very close. Keep trying!`
                  : null;
              const msg =
                notVeryCloseMessage ??
                (res.rank === 1
                  ? 'Scorching guess! One more to crack it.'
                  : generateOnboarding(historyNow as GuessHistoryItem[]));
              const guessCount = historyNow.length;
              const milestoneMessage =
                guessCount === 10 ? "Don't forget to upvote for good luck!" : null;
              const nextPrompt = evaluatePrompt({
                guessCount,
                joinedSubreddit: hasJoinedSubreddit,
                hasReminders,
              });
              const baseMessage =
                notVeryCloseMessage ??
                milestoneMessage ??
                msg ??
                getPromptMessage(nextPrompt) ??
                'Keep it rolling!';
              showFeedback(baseMessage, nextPrompt);
            } else {
              showFeedback(res.message, null);
            }
            return res;
          }}
          onFeedback={(msg) => showFeedback(msg, null)}
          className="col-span-2 mt-4 grid grid-cols-subgrid"
        />
        <div className="col-start-1 flex min-h-6 flex-wrap items-start justify-center gap-x-1 pt-1 text-center text-[10px] leading-[14px] text-gray-600 dark:text-zinc-300">
          {feedback}
        </div>
      </div>
      <GuessActions
        engine={engine}
        onHint={(result, previousRank) => {
          const direction = guessTemperature(previousRank, result.rank);
          if (direction) {
            void gameAudio.cue(direction);
            showTemperature(direction);
          }
          showFeedback('Hint added. Each hint reduces your score by 30%.', null);
        }}
      />
      {items?.value?.length ? (
        <Guesses items={items as any} latest={latest} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {totalPlayers > 0
              ? `${solveRatePct}% of ${formatCompactNumber(totalPlayers)} players have succeeded`
              : "You're the first to play!"}
          </p>
          <button
            className={
              'cursor-pointer rounded-md bg-gray-200 px-4 py-2 text-sm text-black hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600'
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
