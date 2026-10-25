import { useId } from 'preact/hooks';
import { formatCompactNumber } from '../../shared/formatCompactNumber';

export type JourneyGuess = { rank: number; timestampMs?: number; timestamp?: number };

/** A static rank chart: no focus targets, gestures, or extra data requests. */
export function GuessJourney({
  guesses,
  compact = false,
}: {
  guesses: JourneyGuess[];
  compact?: boolean;
}) {
  const id = useId();
  const ordered = guesses
    .map((guess, index) => ({
      rank: guess.rank,
      at: guess.timestampMs ?? guess.timestamp ?? index,
      index,
    }))
    .sort((a, b) => a.at - b.at || a.index - b.index);
  const valid = ordered
    .map((guess, index) => ({ ...guess, index }))
    .filter((guess) => Number.isFinite(guess.rank) && guess.rank >= 0);
  if (!valid.length) return null;
  const width = 320;
  const height = compact ? 48 : 104;
  const maxRank = Math.max(1000, ...valid.map((guess) => guess.rank));
  const points = valid.map((guess) => ({
    x: ordered.length === 1 ? width / 2 : 8 + (guess.index / (ordered.length - 1)) * (width - 16),
    y: 6 + (Math.log10(Math.max(1, guess.rank)) / Math.log10(maxRank)) * (height - 12),
  }));
  const path = points
    .map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ');
  const last = points.at(-1)!;
  const best = Math.max(1, Math.min(...valid.map((guess) => guess.rank)));
  return (
    <figure
      className={
        compact ? 'inline-results-chart min-h-0' : 'rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60'
      }
    >
      <figcaption className="mb-1 flex items-center justify-between gap-2 text-[11px] leading-4 text-gray-500 dark:text-gray-400">
        <span className="font-semibold">Your Guess Journey</span>
        <span>
          {guesses.length} {guesses.length === 1 ? 'Guess' : 'Guesses'} · Closer ↑
        </span>
      </figcaption>
      <svg
        role="img"
        aria-label={`Guess journey over ${guesses.length} guesses. Best rank ${best}. Higher is closer; ranks use a logarithmic scale.`}
        className="block w-full"
        style={{ height }}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient
            id={`${id}-temperature`}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="0"
            y2={height}
          >
            <stop offset="0%" stop-color="#ea580c" />
            <stop offset="45%" stop-color="#eab308" />
            <stop offset="100%" stop-color="#0891b2" />
          </linearGradient>
        </defs>
        <path
          d={`M8,${height - 6}H${width - 8}`}
          stroke="currentColor"
          className="text-gray-200 dark:text-gray-700"
        />
        {points.length > 1 && (
          <path
            d={path}
            fill="none"
            stroke={`url(#${id}-temperature)`}
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
        )}
        <circle cx={last.x} cy={last.y} r="3.5" fill={`url(#${id}-temperature)`} />
      </svg>
      {!compact && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          First Guess → Last Guess · Higher Points Mean Closer Ranks · Log Scale
        </p>
      )}
    </figure>
  );
}

export function CommunityProgress({ players, solves }: { players: number; solves: number }) {
  if (!Number.isFinite(players) || players <= 0) return null;
  const count = Number.isFinite(solves) ? Math.max(0, solves) : 0;
  const percent = Math.min(100, Math.round((count / players) * 100));
  return (
    <figure className="rounded-xl bg-gray-50 p-4 dark:bg-gray-800/60">
      <figcaption className="mb-2 flex flex-wrap justify-between gap-1 text-sm">
        <span className="font-semibold">Community Progress</span>
        <span className="text-gray-500 dark:text-gray-400">
          {formatCompactNumber(count)} of {formatCompactNumber(players)} Players Solved
        </span>
      </figcaption>
      <div
        role="meter"
        aria-label="Players Who Solved"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-600"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{percent}% Solve Rate</p>
    </figure>
  );
}
