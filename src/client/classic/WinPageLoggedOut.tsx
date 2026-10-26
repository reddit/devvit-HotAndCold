import { useEffect, useState, useMemo } from 'preact/hooks';
import { trpc } from '../trpc';
import type { GuessEngine } from '../core/guessEngine';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { showShareSheet, showToast } from '@devvit/web/client';
import { posthog } from '../posthog';
import { ShareIcon } from './icons';
import { ScrollPanel } from '../shared/scrollNavigation';
import { InlineResults, InlineResultButtons } from './inlineResults';
import { GuessJourney } from './resultsCharts';
import { ResultTemperature } from './feedback/temperature';
import { ResultArtwork } from './resultArtwork';
import './expandedResults.css';

export function WinPageLoggedOut({
  engine,
  expanded = false,
}: {
  engine: GuessEngine;
  expanded?: boolean;
}) {
  const [secretWord, setSecretWord] = useState<string | null>(null);
  const challengeNumber = requireChallengeNumber();
  const history = engine.history.value ?? [];
  const ranked = history.filter((guess) => Number.isFinite(guess.rank) && guess.rank >= 0);

  // Determine if they won locally
  const wonLocally = useMemo(() => {
    const history = engine.history.value ?? [];
    return history.some((h) => h.similarity === 1);
  }, [engine.history.value]);

  // If they won, we can grab the word from history.
  // If they gave up, we need to fetch it from the server.
  useEffect(() => {
    if (wonLocally) {
      const history = engine.history.value ?? [];
      const winningGuess = history.find((h) => h.similarity === 1);
      if (winningGuess) {
        setSecretWord(winningGuess.word);
      }
    } else {
      // Gave up -> fetch reveal
      void (async () => {
        try {
          const res = await trpc.game.reveal.query({ challengeNumber });
          if (res?.secretWord) {
            setSecretWord(res.secretWord);
          }
        } catch (e) {
          console.error('Failed to reveal word', e);
        }
      })();
    }
  }, [wonLocally, challengeNumber, engine.history.value]);

  const shareResults = async () => {
    posthog.capture('Win Page Logged Out Share Clicked', {
      challengeNumber,
      wonLocally,
    });
    try {
      await showShareSheet({
        title: 'Hot & Cold',
        text: `Play Hot & Cold #${challengeNumber} with me.`,
        data: JSON.stringify({
          challengeNumber,
        }),
      });
    } catch (e) {
      console.error('Failed to open share sheet', e);
      showToast({ text: 'Share is unavailable right now' });
    }
  };

  if (!expanded)
    return (
      <InlineResults
        didWin={wonLocally}
        word={secretWord ?? '…'}
        stats={[
          { label: 'Guesses', value: history.length },
          {
            label: 'Best Rank',
            value: ranked.length
              ? `#${Math.max(1, Math.min(...ranked.map((guess) => guess.rank)))}`
              : '—',
          },
        ]}
        guesses={history}
        actions={
          <div className="inline-result-actions-stack">
            <InlineResultButtons onShare={() => void shareResults()} />
            <p className="text-center text-[11px] leading-4 text-gray-500 dark:text-gray-400">
              Sign Up to Save Your Progress
            </p>
          </div>
        }
      />
    );

  return (
    <ScrollPanel label="Results">
      <ResultTemperature didWin={wonLocally} />
      <div className="expanded-results-summary mx-auto max-w-xl px-1 pb-3 text-center">
        <div className="expanded-results-hero">
          <ResultArtwork didWin={wonLocally} />
          <h2 className="expanded-results-heading font-bold text-gray-900 dark:text-white">
            {wonLocally ? 'Congratulations!' : 'Game Over!'}
            <br />
            The word was:{' '}
            <span
              className={`font-bold ${wonLocally ? 'text-orange-800 dark:text-orange-200' : 'text-sky-800 dark:text-sky-200'}`}
            >
              {secretWord ?? '...'}
            </span>
          </h2>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Sign up to see the full leaderboard and save your progress.
        </p>
        <div className="w-full">
          <GuessJourney guesses={history} />
        </div>
        <button
          type="button"
          onClick={() => {
            void shareResults();
          }}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-zinc-100 px-5 py-3 text-sm font-semibold text-black focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-50 focus:outline-none dark:bg-zinc-800 dark:text-white"
        >
          <ShareIcon /> Share Results
        </button>
      </div>
    </ScrollPanel>
  );
}
