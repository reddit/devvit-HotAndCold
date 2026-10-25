import { useEffect, useRef, useState } from 'preact/hooks';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../server';
import { formatBytes } from './format';

type Sample = inferRouterOutputs<AppRouter>['moderation']['redisSample'];
type Row = Sample['rows'][number];
const columns: { key: keyof Row; label: string; size?: boolean }[] = [
  { key: 'challengeNumber', label: 'Puzzle' },
  { key: 'cacheBytes', label: 'Full JSON Cache', size: true },
  { key: 'compactCacheBytes', label: 'Compact Cache', size: true },
  { key: 'players', label: 'Solvers Indexed' },
  { key: 'progressPlayers', label: 'Progress Indexed' },
  { key: 'sampledPlayers', label: 'Players Sampled' },
  { key: 'sampledGuessBytes', label: 'Guess Payloads', size: true },
];

export function RedisSamplePanel({
  sample,
  busy,
  onClear,
}: {
  sample: Sample;
  busy: boolean;
  onClear: (challengeNumbers: number[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [sort, setSort] = useState<{ key: keyof Row; descending: boolean }>({
    key: 'cacheBytes',
    descending: true,
  });
  const selectAll = useRef<HTMLInputElement>(null);
  const eligible = sample.rows.filter((row) => row.cacheBytes > 0);
  const selectedRows = eligible.filter((row) => selected.has(row.challengeNumber));
  const allSelected = eligible.length > 0 && selectedRows.length === eligible.length;
  const partlySelected = selectedRows.length > 0 && !allSelected;
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = partlySelected;
  }, [partlySelected]);
  const sorted = [...sample.rows].sort(
    (a, b) =>
      (sort.descending ? b[sort.key] - a[sort.key] : a[sort.key] - b[sort.key]) ||
      b.challengeNumber - a.challengeNumber
  );
  const selectedBytes = selectedRows.reduce((sum, row) => sum + row.cacheBytes, 0);
  const changeSelection = (next: Set<number>) => {
    setSelected(next);
    setConfirmed(false);
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-2 font-bold">Measured Sample</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Shared compact dictionary cache: {formatBytes(sample.dictionaryBytes)}. Values cover known
        keys for this data release, excluding Redis overhead.
      </p>
      <p className="my-3 text-xs text-gray-600 dark:text-gray-300">
        Sort any column to reorder this sample of {sample.rows.length} puzzles. Select All applies
        only to full JSON caches in this sample. Nothing is selected by default; inspecting another
        sample resets the selection.
      </p>
      <div
        className="overflow-x-auto rounded-lg focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:outline-none"
        role="region"
        aria-label="Puzzle Storage Measurements"
        tabIndex={0}
      >
        <table className="w-full text-left text-xs text-gray-900 dark:text-gray-100">
          <caption className="sr-only">
            Sampled Puzzle Storage. Full JSON Cache is sorted largest first by default. Only
            selected full JSON caches can be cleared.
          </caption>
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th scope="col" className="p-2">
                <input
                  ref={selectAll}
                  type="checkbox"
                  aria-label="Select All Clearable Puzzles in This Sample"
                  title="Select All in This Sample"
                  checked={allSelected}
                  disabled={busy || eligible.length === 0}
                  onChange={(event) =>
                    changeSelection(
                      new Set(
                        event.currentTarget.checked
                          ? eligible.map((row) => row.challengeNumber)
                          : []
                      )
                    )
                  }
                />
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className="p-2 font-semibold"
                  aria-sort={
                    sort.key === column.key
                      ? sort.descending
                        ? 'descending'
                        : 'ascending'
                      : 'none'
                  }
                >
                  <button
                    type="button"
                    aria-label={`Sort by ${column.label}`}
                    disabled={busy}
                    className="flex items-center gap-1 rounded py-1 text-left underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:outline-none"
                    onClick={() =>
                      setSort((previous) => ({
                        key: column.key,
                        descending: previous.key === column.key ? !previous.descending : true,
                      }))
                    }
                  >
                    {column.label}
                    <svg
                      aria-hidden="true"
                      className="shrink-0"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path
                        d={
                          sort.key === column.key
                            ? sort.descending
                              ? 'm6 9 6 6 6-6'
                              : 'm6 15 6-6 6 6'
                            : 'm8 8 4-4 4 4M8 16l4 4 4-4'
                        }
                      />
                    </svg>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.challengeNumber}
                className="border-b border-gray-100 dark:border-gray-800"
              >
                <td className="p-2">
                  <input
                    type="checkbox"
                    aria-label={`Select Puzzle #${row.challengeNumber}`}
                    checked={selected.has(row.challengeNumber)}
                    disabled={busy || row.cacheBytes === 0}
                    title={
                      row.cacheBytes === 0
                        ? 'No Full JSON Cache to Clear'
                        : `Select Puzzle #${row.challengeNumber}`
                    }
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.currentTarget.checked) next.add(row.challengeNumber);
                      else next.delete(row.challengeNumber);
                      changeSelection(next);
                    }}
                  />
                </td>
                {columns.map((column) =>
                  column.key === 'challengeNumber' ? (
                    <th key={column.key} scope="row" className="p-2 font-medium">
                      #{row.challengeNumber}
                    </th>
                  ) : (
                    <td key={column.key} className="p-2 tabular-nums">
                      {column.size ? formatBytes(row[column.key]) : row[column.key]}
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 text-xs font-medium" role="status">
        {selectedRows.length} of {eligible.length} Clearable Puzzles Selected · Up to{' '}
        {formatBytes(selectedBytes)} to Remove
      </div>
      <div className="mt-5 space-y-3 rounded-xl bg-gray-50 p-4 dark:bg-gray-800">
        <h3 className="text-sm font-semibold">Clear Selected Full JSON Ranking Caches</h3>
        <p className="text-xs text-gray-600 dark:text-gray-300">
          This removes only the selected old full JSON ranking copies. Compact ranking caches, the
          shared dictionary, player history, queued words, answers, and scores are preserved.
        </p>
        <p className="text-xs text-gray-600 dark:text-gray-300">
          Usually no extra requests or slowdown: the app keeps using compact caches and static
          ranking files. Browser, CDN, and server-memory caches are also kept. A normal cache miss
          may still fetch static files and load more slowly.
        </p>
        <p className="text-xs text-amber-800 dark:text-amber-200">
          Outage tradeoff: these old copies are a backup. If static ranking data cannot load and no
          other cached copy is available, ranking or hint requests for these puzzles may temporarily
          fail. The current app does not rebuild the full JSON copies after clearing them.
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          The selected size is an upper estimate from this sample. The actual total can differ if
          caches change or puzzles share a cache.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            className="mt-1"
            type="checkbox"
            checked={confirmed}
            disabled={busy || selectedRows.length === 0}
            onChange={(event) => setConfirmed(event.currentTarget.checked)}
          />
          I Understand the Selected Outage Fallback Caches Will Be Removed
        </label>
        <button
          type="button"
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900"
          disabled={busy || !confirmed || selectedRows.length === 0}
          onClick={async () => {
            if (busy || !confirmed || selectedRows.length === 0) return;
            setConfirmed(false);
            await onClear(selectedRows.map((row) => row.challengeNumber));
          }}
        >
          Clear Selected Caches
        </button>
      </div>
    </section>
  );
}
