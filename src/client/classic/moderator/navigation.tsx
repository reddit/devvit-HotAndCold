import type { ComponentChildren, RefObject } from 'preact';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../server';
import { LOW_QUEUE_THRESHOLD } from '../../../shared/lowQueue';
import { DeveloperIcon } from '../icons';

export const MODERATOR_SECTIONS = ['Latest', 'Schedule', 'Reminders', 'Words', 'Storage'] as const;
export type ModeratorSection = (typeof MODERATOR_SECTIONS)[number] | 'Developer Tools';
type Overview = inferRouterOutputs<AppRouter>['moderation']['overview'];

export const SECTION_DESCRIPTIONS: Record<ModeratorSection, string> = {
  Latest: 'Review the current puzzle, player activity, and moderation tools.',
  Schedule: 'See the next daily post, recover a missing puzzle, or post an extra one.',
  Reminders: 'Review pending player reminder groups and their delivery times.',
  Words: 'Add upcoming words, check queue coverage, and manage low-queue alerts.',
  Storage: 'Inspect Redis storage and selectively clear old ranking caches.',
  'Developer Tools': 'Developer-only experiments and notification testing.',
};

function Icon({ children }: { children: ComponentChildren }) {
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
const icons: Record<(typeof MODERATOR_SECTIONS)[number], ComponentChildren> = {
  Latest: <path d="M4 20V4h16v16ZM8 8h8M8 12h5M8 16h3" />,
  Schedule: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2" />
    </>
  ),
  Reminders: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />,
  Words: <path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01" />,
  Storage: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v7c0 4 18 4 18 0V5M3 12v7c0 4 18 4 18 0v-7" />
    </>
  ),
};

function summary(section: ModeratorSection, data: Overview, date: (ms: number) => string): string {
  switch (section) {
    case 'Latest': {
      const players = Number(data.challenge?.totalPlayers ?? 0);
      const solves = Number(data.challenge?.totalSolves ?? 0);
      return data.challenge
        ? `Puzzle #${data.challenge.challengeNumber} · ${players} ${players === 1 ? 'Player' : 'Players'} · ${solves} ${solves === 1 ? 'Solve' : 'Solves'}`
        : 'No Puzzle Yet';
    }
    case 'Schedule':
      return `Next Post · ${date(data.nextPostAtMs)}`;
    case 'Reminders':
      return `${data.notifications.total.toLocaleString()} Pending ${data.notifications.total === 1 ? 'Group' : 'Groups'}`;
    case 'Words':
      return `${data.queueSize.toLocaleString()} ${data.queueSize === 1 ? 'Word' : 'Words'} · About ${data.queueSize.toLocaleString()} ${data.queueSize === 1 ? 'Day' : 'Days'}`;
    case 'Storage':
      return 'Inspect Data and Clear Ranking Caches';
    case 'Developer Tools':
      return 'Local Experiments and Push Tests';
  }
}

export function ModeratorNavigation({
  data,
  selected,
  onNavigate,
  selectedButtonRef,
  date,
  className,
}: {
  data: Overview;
  selected: ModeratorSection;
  onNavigate: (section: ModeratorSection) => void;
  selectedButtonRef: RefObject<HTMLButtonElement>;
  date: (ms: number) => string;
  className: string;
}) {
  return (
    <nav aria-label="Moderator Settings Sections" className={className}>
      <h2 className="mb-3 text-sm font-bold text-gray-600 dark:text-gray-300">Moderator Tools</h2>
      <ul className="space-y-2">
        {MODERATOR_SECTIONS.map((section) => (
          <li key={section}>
            <button
              type="button"
              ref={selected === section ? selectedButtonRef : null}
              aria-label={section}
              aria-describedby={`moderator-summary-${section}`}
              aria-current={selected === section ? 'page' : undefined}
              aria-controls="moderator-details"
              onClick={() => onNavigate(section)}
              className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 ${selected === section ? 'border-cyan-600 bg-cyan-50 dark:border-cyan-700 dark:bg-cyan-950/40' : 'border-gray-200 bg-white hover:border-gray-400 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800'}`}
            >
              <span className="mt-0.5 shrink-0 text-cyan-700 dark:text-cyan-300">
                <Icon>{icons[section]}</Icon>
              </span>
              <span className="min-w-0 grow">
                <span className="block text-sm font-bold">{section}</span>
                <span
                  id={`moderator-summary-${section}`}
                  className="mt-1 block text-xs leading-snug text-gray-500 dark:text-gray-400"
                >
                  {summary(section, data, date)}
                </span>
                {section === 'Words' && data.queueSize <= LOW_QUEUE_THRESHOLD && (
                  <span className="mt-1 block text-xs font-semibold text-amber-800 dark:text-amber-200">
                    {data.queueSize === 0 ? 'Queue Empty' : 'Queue Running Low'}
                  </span>
                )}
              </span>
              <svg
                aria-hidden="true"
                className="mt-1 shrink-0 text-gray-400 @min-[640px]:rotate-180"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
      {data.developerToolsAvailable && (
        <div className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-800">
          <button
            type="button"
            ref={selected === 'Developer Tools' ? selectedButtonRef : null}
            aria-label="Developer Tools"
            aria-current={selected === 'Developer Tools' ? 'page' : undefined}
            aria-controls="moderator-details"
            onClick={() => onNavigate('Developer Tools')}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold ${selected === 'Developer Tools' ? 'bg-cyan-50 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
          >
            <DeveloperIcon />
            Developer Tools
          </button>
        </div>
      )}
    </nav>
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
        <Icon>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </Icon>
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
