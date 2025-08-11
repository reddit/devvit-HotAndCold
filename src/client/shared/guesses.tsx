import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Signal } from '@preact/signals';
import { cn } from '../utils/cn';
import { userSettings } from '../classic/state/userSettings';
import { useDimensions } from './useDimensions';
import { rankToProgress } from '../../shared/progress';

export type GuessItem = {
  word: string;
  similarity: number; // 0..1 (display as %)
  rank: number; // -1 if unknown
  timestamp: number;
};

export function Guesses({
  items,
  latest,
}: {
  items: GuessItem[] | Signal<GuessItem[]>;
  latest?: GuessItem | null;
}) {
  const list: GuessItem[] = Array.isArray((items as any).value)
    ? (items as Signal<GuessItem[]>).value
    : (items as GuessItem[]);

  const sorted = useMemo(() => {
    const settings = userSettings.value;
    const base = [...list];
    if (settings.sortType === 'SIMILARITY') {
      base.sort((a, b) =>
        settings.sortDirection === 'ASC' ? a.similarity - b.similarity : b.similarity - a.similarity
      );
    } else {
      base.sort((a, b) =>
        settings.sortDirection === 'ASC' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp
      );
    }
    return base;
  }, [list, userSettings.value.sortType, userSettings.value.sortDirection]);

  const layout = userSettings.value.layout;
  const FALLBACK_ROW_HEIGHT = layout === 'CONDENSED' ? 16 : 22;

  // Dimension-aware pagination
  const [ref, dimensions, reMeasure] = useDimensions();
  const listColumnRef = useRef<HTMLDivElement | null>(null);
  const [measuredRowHeight, setMeasuredRowHeight] = useState<number>(FALLBACK_ROW_HEIGHT + 4);

  // Measure the actual row height (including the column gap) to avoid clipping
  useEffect(() => {
    const parent = listColumnRef.current;
    if (!parent) return;

    const probe = document.createElement('p');
    probe.className = 'relative flex w-full justify-between gap-1 rounded px-1';
    probe.style.visibility = 'hidden';
    // minimal content to realize line height
    const left = document.createElement('span');
    left.textContent = 'W';
    const right = document.createElement('span');
    right.textContent = '00%';
    probe.appendChild(left);
    probe.appendChild(right);
    parent.appendChild(probe);

    window.requestAnimationFrame(() => {
      const styles = getComputedStyle(parent);
      const gap = parseFloat(styles.rowGap || '0') || 0;
      const height = probe.offsetHeight || FALLBACK_ROW_HEIGHT;
      setMeasuredRowHeight(Math.max(1, Math.round(height + gap)));
      parent.removeChild(probe);
    });
  }, [listColumnRef.current, layout]);
  const [currentPage, setCurrentPage] = useState(1);

  // Prefer the provided latest item, otherwise derive it
  const latestItem: GuessItem | null = useMemo(() => {
    if (latest) return latest;
    if (sorted.length === 0) return null;
    return sorted.reduce(
      (acc, cur) => (cur.timestamp > (acc?.timestamp ?? 0) ? cur : acc),
      sorted[0]!
    );
  }, [latest, sorted]);

  const getRankEmoji = (rank?: number | null): string | null => {
    const safeRank = Number.isFinite(rank) ? (rank as number) : -1;
    if (safeRank >= 1 && safeRank <= 250) return '🔥';
    if (safeRank >= 251 && safeRank <= 1000) return '☀️';
    return null;
  };

  const getProgressClass = (rank: number | undefined) => {
    const safeRank = Number.isFinite(rank) ? (rank as number) : -1;
    // Darken in light mode for readability, keep brighter hues in dark mode
    if (safeRank >= 1000) return 'text-blue-700 dark:text-[#4DE1F2]';
    if (safeRank >= 250) return 'text-yellow-700 dark:text-[#FED155]';
    return 'text-red-700 dark:text-[#FE5555]';
  };

  // Calculate how many rows can fit within the scrollable list area only
  // We attach the ref to the scroll container so this height excludes the header and pagination controls
  const itemsPerPage = useMemo(() => {
    const row = measuredRowHeight || FALLBACK_ROW_HEIGHT;
    return Math.max(1, Math.floor(dimensions.height / row));
  }, [dimensions.height, measuredRowHeight, FALLBACK_ROW_HEIGHT]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / itemsPerPage));
  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sorted.slice(start, start + itemsPerPage);
  }, [sorted, currentPage, itemsPerPage]);

  useEffect(() => {
    // Re-measure when content characteristics change
    reMeasure();
  }, [sorted.length, layout, latestItem, reMeasure]);

  useEffect(() => {
    setCurrentPage(1);
  }, [itemsPerPage, userSettings.value.sortDirection, userSettings.value.sortType]);

  return (
    <div
      className={cn(
        'relative z-10 flex w-60 flex-col self-center flex-1 min-h-0',
        layout === 'CONDENSED' ? 'text-sm' : 'text-md'
      )}
    >
      {sorted.length > 0 && latestItem && (
        <p
          className={cn(
            'relative flex w-full justify-between gap-1 rounded px-1 border border-gray-300 bg-gray-100/70 dark:border-gray-500 dark:bg-gray-700/50'
          )}
        >
          <span className="truncate font-medium text-gray-900 dark:text-white">
            {latestItem.word}
            {getRankEmoji(latestItem.rank) ? ` ${getRankEmoji(latestItem.rank)}` : null}
          </span>
          <span
            className={cn(
              'flex flex-shrink-0 items-center text-right',
              getProgressClass(latestItem.rank)
            )}
          >
            {latestItem.rank >= 1 ? `#${latestItem.rank}` : '—'}
          </span>
        </p>
      )}

      <div ref={ref} className="flex-1 overflow-hidden min-h-0">
        <div ref={listColumnRef} className="flex flex-col gap-1">
          {pageItems.map((g) => (
            <p
              key={`${g.word}-${g.timestamp}`}
              className="relative flex w-full justify-between gap-1 rounded px-1"
            >
              <span className="truncate text-gray-900 dark:text-gray-50">
                {g.word}
                {getRankEmoji(g.rank) ? ` ${getRankEmoji(g.rank)}` : null}
              </span>
              <span
                className={cn(
                  'flex flex-shrink-0 items-center text-right',
                  getProgressClass(g.rank)
                )}
              >
                {g.rank >= 1 ? `#${g.rank}` : '—'}
              </span>
            </p>
          ))}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex h-4 items-center justify-center gap-3">
          <button
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            className={cn(
              'rounded px-1 py-0.5',
              currentPage === 1 ? 'cursor-not-allowed opacity-50' : 'dark:hover:bg-gray-700'
            )}
          >
            ‹
          </button>
          <span>
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
            className={cn(
              'rounded px-1 py-0.5',
              currentPage === totalPages
                ? 'cursor-not-allowed opacity-50'
                : 'dark:hover:bg-gray-700'
            )}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
