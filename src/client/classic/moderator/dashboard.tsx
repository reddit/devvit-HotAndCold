import type { ComponentChildren } from 'preact';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../server';
import { LOW_QUEUE_THRESHOLD } from '../../../shared/lowQueue';

export type ModeratorSection =
  | 'Dashboard'
  | 'Latest Puzzle'
  | 'Word Queue'
  | 'Scheduling'
  | 'Reminders'
  | 'Redis';
type Overview = inferRouterOutputs<AppRouter>['moderation']['overview'];

const card =
  'flex min-w-0 flex-col rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900';
const action =
  'mt-5 w-full rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600';
const secondary = 'mt-2 text-sm text-gray-500 dark:text-gray-400';

function CardIcon({ children }: { children: ComponentChildren }) {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}
function CardTitle({ children, icon }: { children: ComponentChildren; icon: ComponentChildren }) {
  return (
    <h2 className="mb-3 flex items-center gap-2.5 font-bold">
      <span className="text-cyan-700 dark:text-cyan-300">{icon}</span>
      {children}
    </h2>
  );
}
export function QueueAlertToggle({
  enabled,
  busy,
  onToggle,
}: {
  enabled: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mt-4 rounded-xl bg-gray-50 p-3 dark:bg-gray-800/70">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Notify Low Queue"
        disabled={busy}
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-left text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      >
        <CardIcon>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </CardIcon>
        <span className="grow">Notify Low Queue</span>
        <span
          className={`rounded-full px-2 py-1 text-xs ${enabled ? 'bg-cyan-100 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-100' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-200'}`}
        >
          {enabled ? 'On' : 'Off'}
        </span>
      </button>
      <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        Reddit DMs to you at {LOW_QUEUE_THRESHOLD} words or fewer, and again if empty. Checked
        hourly. Alerts reset after refilling above {LOW_QUEUE_THRESHOLD}. Separate from player
        reminders.
      </p>
    </div>
  );
}

export function ModeratorDashboard({
  data,
  busy,
  onNavigate,
  onToggleAlerts,
  date,
}: {
  data: Overview;
  busy: boolean;
  onNavigate: (section: ModeratorSection) => void;
  onToggleAlerts: () => void;
  date: (ms: number) => string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-label="Moderator Dashboard">
      <section className={card}>
        <CardTitle
          icon={
            <CardIcon>
              <path d="M4 20V4h16v16ZM8 8h8M8 12h5M8 16h3" />
            </CardIcon>
          }
        >
          Latest Puzzle
        </CardTitle>
        {data.challenge ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-3xl font-bold">#{data.challenge.challengeNumber}</p>
              {data.challenge.postUrl && (
                <a
                  className="text-sm font-semibold text-cyan-700 underline dark:text-cyan-300"
                  href={data.challenge.postUrl}
                  title={data.challenge.postUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Game Post ↗
                </a>
              )}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              {[
                ['Players', data.challenge.totalPlayers ?? 0],
                ['Solves', data.challenge.totalSolves ?? 0],
                ['Guesses', data.challenge.totalGuesses ?? 0],
                ['Hints Used', data.challenge.totalHints ?? 0],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p className={secondary}>
            No puzzle yet. Add words, then use Scheduling to create the first puzzle.
          </p>
        )}
        <div className="grow" />
        <button className={action} onClick={() => onNavigate('Latest Puzzle')}>
          View Puzzle Details
        </button>
      </section>
      <section className={card}>
        <CardTitle
          icon={
            <CardIcon>
              <path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01" />
            </CardIcon>
          }
        >
          Word Queue
        </CardTitle>
        <p className="text-3xl font-bold">
          {data.queueSize.toLocaleString()}{' '}
          <span className="text-base font-medium">{data.queueSize === 1 ? 'Word' : 'Words'}</span>
        </p>
        <p className={secondary}>
          About {data.queueSize.toLocaleString()} {data.queueSize === 1 ? 'day' : 'days'} at one
          puzzle per day. Extra posts use words faster.
        </p>
        {data.queueSize <= LOW_QUEUE_THRESHOLD && (
          <p className="mt-3 text-sm font-semibold text-amber-800 dark:text-amber-200">
            {data.queueSize === 0
              ? 'Queue Empty — Add Words Before the Next Post'
              : 'Queue Running Low'}
          </p>
        )}
        <QueueAlertToggle
          enabled={data.lowQueueAlertsEnabled}
          busy={busy}
          onToggle={onToggleAlerts}
        />
        <div className="grow" />
        <button className={action} onClick={() => onNavigate('Word Queue')}>
          Manage Queue
        </button>
      </section>
      <section className={card}>
        <CardTitle
          icon={
            <CardIcon>
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2" />
            </CardIcon>
          }
        >
          Scheduling
        </CardTitle>
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
          Next Scheduled Post
        </p>
        <time
          className="mt-2 text-xl font-bold"
          dateTime={new Date(data.nextPostAtMs).toISOString()}
        >
          {date(data.nextPostAtMs)}
        </time>
        <p className={secondary}>
          Daily at 12:00 UTC, with three automatic retries. Times above use your local time zone.
        </p>
        <p className={secondary}>
          Recover a missing daily puzzle or deliberately post an extra one.
        </p>
        <div className="grow" />
        <button className={action} onClick={() => onNavigate('Scheduling')}>
          Manage Scheduling
        </button>
      </section>
      <section className={card}>
        <CardTitle
          icon={
            <CardIcon>
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
            </CardIcon>
          }
        >
          Reminders
        </CardTitle>
        <p className="text-3xl font-bold">
          {data.notifications.total.toLocaleString()}{' '}
          <span className="text-base font-medium">
            Pending {data.notifications.total === 1 ? 'Group' : 'Groups'}
          </span>
        </p>
        <p className={secondary}>
          Player reminders for new daily puzzles. Each group can contain multiple recipients.
        </p>
        {data.notifications.next[0] && (
          <p className={secondary}>Next delivery: {date(data.notifications.next[0].dueAtMs)}</p>
        )}
        <div className="grow" />
        <button className={action} onClick={() => onNavigate('Reminders')}>
          View Reminders
        </button>
      </section>
      <section className={`${card} sm:col-span-2`}>
        <CardTitle
          icon={
            <CardIcon>
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5v7c0 4 18 4 18 0V5M3 12v7c0 4 18 4 18 0v-7" />
            </CardIcon>
          }
        >
          Redis
        </CardTitle>
        <p className="text-xl font-bold">Storage and Cache Tools</p>
        <p className={secondary}>
          Inspect puzzle storage and selectively clear old full JSON ranking caches. Inspection
          loads only when requested.
        </p>
        <div className="grow" />
        <button className={action} onClick={() => onNavigate('Redis')}>
          Inspect Redis
        </button>
      </section>
    </div>
  );
}
