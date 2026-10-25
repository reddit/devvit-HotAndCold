import type { ComponentChildren } from 'preact';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { openPopup } from './expanded/launch';
import { ShareIcon } from './icons';
import { GuessJourney, type JourneyGuess } from './resultsCharts';
import './inlineResults.css';

export type ResultStat = {
  label: string;
  value: string | number;
  onClick?: (event: MouseEvent) => void;
};

export function InlineResults({
  didWin,
  word,
  stats,
  guesses,
  actions,
}: {
  didWin: boolean;
  word: string;
  stats: ResultStat[];
  guesses: JourneyGuess[];
  actions: ComponentChildren;
}) {
  return (
    <section
      aria-label="Puzzle Results"
      className="inline-results mx-auto min-h-0 w-full max-w-xl flex-1 text-gray-900 dark:text-white"
    >
      <div className="inline-results-content">
        <h1 className="inline-results-heading text-center font-bold">
          <span className="block text-base">{didWin ? 'Congratulations!' : 'Nice Try!'}</span>
          <span className="block text-xl break-words text-orange-700 dark:text-orange-300">
            {word}
          </span>
        </h1>
        <dl
          className="grid shrink-0 gap-2"
          style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
        >
          {stats.map(({ label, value, onClick }) => (
            <div
              key={label}
              className="min-w-0 rounded-lg bg-gray-100 px-2 py-1 text-center dark:bg-gray-800"
            >
              <dt className="text-[10px] leading-4 text-gray-500 dark:text-gray-400">{label}</dt>
              <dd
                title={String(value)}
                className="truncate text-base leading-5 font-bold tabular-nums"
              >
                {onClick ? (
                  <button
                    type="button"
                    aria-label="Score Breakdown"
                    className="underline decoration-gray-400 underline-offset-2"
                    onClick={onClick}
                  >
                    {value}
                  </button>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
        <GuessJourney guesses={guesses} compact />
        <div className="inline-results-actions shrink-0">{actions}</div>
      </div>
    </section>
  );
}

export function InlineResultButtons({ onShare }: { onShare: () => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={onShare}
        className="inline-result-button inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full bg-gray-100 px-2 text-xs font-semibold dark:bg-gray-800 [&>svg]:h-4 [&>svg]:w-4"
      >
        <ShareIcon /> Share Results
      </button>
      <button
        type="button"
        className="inline-result-button min-w-0 rounded-full border border-gray-300 px-2 text-xs font-semibold dark:border-gray-600"
        onClick={(event) => {
          localStorage.setItem(`results-tab:${requireChallengeNumber()}`, '0');
          openPopup(event, 'results');
        }}
      >
        View Results
      </button>
    </div>
  );
}
