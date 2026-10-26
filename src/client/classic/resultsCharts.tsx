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
      <figcaption className="mb-1 flex items-center justify-between gap-2 text-[11px] leading-4 text-gray-600 dark:text-gray-300">
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

const playerCount = (count: number) =>
  Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;

export function CommunityProgress({
  players,
  solves,
  giveUps = 0,
}: {
  players: number;
  solves: number;
  giveUps?: number;
}) {
  const total = playerCount(players);
  if (!total) return null;
  // Legacy/in-flight counters must not produce negative segments or overflow the chart.
  const solved = Math.min(total, playerCount(solves));
  const gaveUp = Math.min(total - solved, playerCount(giveUps));
  const playing = total - solved - gaveUp;
  const percent = Math.round((solved / total) * 100);
  const outcomes = [
    { label: 'Solved', count: solved, color: 'bg-orange-600 dark:bg-orange-400' },
    { label: 'Gave Up', count: gaveUp, color: 'bg-sky-600 dark:bg-sky-400' },
    { label: 'Unfinished', count: playing, color: 'bg-gray-400 dark:bg-gray-500' },
  ];
  return (
    <figure className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60">
      <figcaption className="mb-2 flex flex-wrap justify-between gap-1 text-xs text-gray-600 dark:text-gray-300">
        <span className="font-semibold">Community Progress</span>
        <span>{percent}% Solve Rate</span>
      </figcaption>
      <div
        role="img"
        aria-label={`Player outcomes: ${solved.toLocaleString('en-US')} solved, ${gaveUp.toLocaleString('en-US')} gave up, ${playing.toLocaleString('en-US')} unfinished, out of ${total.toLocaleString('en-US')} players.`}
        className="flex h-3 overflow-hidden rounded-full"
      >
        {outcomes.map(({ label, count, color }) => (
          <span
            key={label}
            aria-hidden="true"
            className={color}
            style={{ width: `${(count / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-gray-600 dark:text-gray-300">
        {outcomes.map(({ label, count, color }) => (
          <li
            key={label}
            title={`${count.toLocaleString('en-US')} ${label}`}
            className="flex min-w-0 items-center gap-1.5"
          >
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
            {label}
          </li>
        ))}
      </ul>
    </figure>
  );
}

export type StandingScore = { member: string; score: number };

/** Uses only the leaderboard page already requested for the table below it. */
export function StandingsScores({
  entries,
  currentUsername,
}: {
  entries: StandingScore[];
  currentUsername?: string | null;
}) {
  const valid = entries
    .map((entry, index) => ({ ...entry, place: index + 1 }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score >= 0);
  if (!valid.length) return null;
  const highest = Math.max(...valid.map((entry) => entry.score));
  const width = 320;
  const height = 56;
  const pitch = width / entries.length;
  const barWidth = Math.min(24, pitch * 0.7);
  const current = valid.find((entry) => entry.member === currentUsername);
  return (
    <figure className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60">
      <figcaption className="mb-2 flex flex-wrap justify-between gap-1 text-xs text-gray-600 dark:text-gray-300">
        <span className="font-semibold">Leaderboard Scores</span>
        <span>
          Top {entries.length} {entries.length === 1 ? 'Finisher' : 'Finishers'}
        </span>
      </figcaption>
      <div className="flex gap-2">
        <div
          aria-hidden="true"
          className="flex w-10 shrink-0 flex-col justify-between text-right text-[10px] leading-3 text-gray-600 tabular-nums dark:text-gray-300"
        >
          <span>{formatCompactNumber(highest)}</span>
          <span>0</span>
        </div>
        <svg
          role="img"
          aria-label={`Scores for the top ${entries.length} ${entries.length === 1 ? 'finisher' : 'finishers'}. Highest score ${highest.toLocaleString('en-US')}. Scores start at zero.${current ? ` Your position in this chart: ${current.place}.` : ''}`}
          className="block min-w-0 flex-1"
          style={{ height }}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
        >
          <path
            d={`M0,${height - 1}H${width}`}
            stroke="currentColor"
            className="text-gray-300 dark:text-gray-600"
          />
          {valid.map((entry) => {
            const barHeight = highest > 0 ? (entry.score / highest) * (height - 5) : 0;
            const isCurrent = entry.member === currentUsername;
            return (
              <rect
                key={entry.member}
                x={(entry.place - 0.5) * pitch - barWidth / 2}
                y={height - 1 - barHeight}
                width={barWidth}
                height={barHeight}
                rx={Math.min(2, barWidth / 2)}
                fill="currentColor"
                className={
                  isCurrent
                    ? 'text-orange-600 dark:text-orange-400'
                    : 'text-cyan-700 dark:text-cyan-400'
                }
              >
                <title>{`#${entry.place} · ${entry.member}: ${entry.score.toLocaleString('en-US')} Points`}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div
        aria-hidden="true"
        className={`mt-1 ml-12 flex ${entries.length === 1 ? 'justify-center' : 'justify-between'} gap-2 text-[10px] leading-3 text-gray-600 tabular-nums dark:text-gray-300`}
      >
        {entries.length > 1 && <span>#1</span>}
        {current && (
          <span className="inline-flex items-center gap-1 text-orange-800 dark:text-orange-200">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-600 dark:bg-orange-400" />
            You{entries.length === 1 && ' · #1'}
          </span>
        )}
        {entries.length === 1 && !current && <span>#1</span>}
        {entries.length > 1 && <span>#{entries.length}</span>}
      </div>
    </figure>
  );
}
