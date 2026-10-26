import { queueHealth } from '../../../shared/lowQueue';

export function QueueWarningIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="m10.3 4.3-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

export function QueueStatusBadge({ size }: { size?: number | null }) {
  const health = queueHealth(size);
  if (!health) return null;
  return (
    <span
      data-queue-health={health}
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-4 font-bold ${health === 'empty' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}
      title={health === 'empty' ? 'Word Queue Empty' : 'Word Queue Running Low'}
    >
      {health === 'empty' ? '! Empty' : '! Low'}
    </span>
  );
}

export function QueueStatusNotice({ size, onAddWords }: { size: number; onAddWords: () => void }) {
  const health = queueHealth(size);
  if (!health) return null;
  return (
    <div
      role="status"
      data-queue-notice={health}
      className={`mt-3 rounded-xl border p-3 ${health === 'empty' ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200' : 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}
    >
      <p className="flex items-center gap-2 text-sm font-bold">
        <QueueWarningIcon />
        {health === 'empty' ? 'Word Queue Empty' : 'Word Queue Running Low'}
      </p>
      <p className="mt-1 text-sm leading-relaxed">
        {health === 'empty'
          ? 'No upcoming words remain. Add words before the next scheduled post; a new puzzle cannot be created until the queue is refilled. The current puzzle stays playable.'
          : `Only ${size} ${size === 1 ? 'word remains' : 'words remain'}—about ${size} ${size === 1 ? 'day' : 'days'} at one puzzle per day. Refill soon to keep daily posts running.`}
      </p>
      <button
        type="button"
        className="mt-2 rounded-lg border border-current px-3 py-1.5 text-xs font-bold"
        onClick={onAddWords}
      >
        Add Words
      </button>
    </div>
  );
}
