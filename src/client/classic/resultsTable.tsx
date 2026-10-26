import type { ComponentChildren } from 'preact';
import { cn } from '../utils/cn';

export function ResultsTable({
  label,
  nameHeading,
  valueHeading,
  children,
}: {
  label: string;
  nameHeading: string;
  valueHeading: string;
  children: ComponentChildren;
}) {
  return (
    <div className="overflow-clip rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <table aria-label={label} className="w-full border-collapse text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
          <tr>
            <th
              scope="col"
              className="w-px px-2 py-2 text-right font-medium whitespace-nowrap sm:px-3"
            >
              Rank
            </th>
            <th scope="col" className="px-2 py-2 text-left font-medium sm:px-3">
              {nameHeading}
            </th>
            <th
              scope="col"
              className="w-px px-2 py-2 text-right font-medium whitespace-nowrap sm:px-3"
            >
              {valueHeading}
            </th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function ResultsTableRow({
  rank,
  name,
  value,
  isHint = false,
  isCurrentUser = false,
  isTopThree = false,
}: {
  rank: number | null;
  name: string;
  value: string;
  isHint?: boolean;
  isCurrentUser?: boolean;
  isTopThree?: boolean;
}) {
  return (
    <tr
      aria-current={isCurrentUser ? 'true' : undefined}
      className={cn(
        'odd:bg-gray-50 even:bg-gray-100 dark:odd:bg-gray-800/50 dark:even:bg-gray-900/50',
        isCurrentUser && 'odd:bg-cyan-50 even:bg-cyan-50 dark:odd:bg-cyan-950 dark:even:bg-cyan-950'
      )}
    >
      <td
        className={cn(
          'px-2 py-2 text-right align-top font-mono whitespace-nowrap tabular-nums sm:px-3',
          isTopThree
            ? 'font-semibold text-yellow-800 dark:text-yellow-300'
            : 'text-gray-600 dark:text-gray-400'
        )}
      >
        {rank != null && Number.isFinite(rank) && rank >= 0
          ? `#${rank.toLocaleString('en-US')}`
          : '—'}
      </td>
      <th
        scope="row"
        className={cn(
          'px-2 py-2 text-left align-top font-medium [overflow-wrap:anywhere] sm:px-3',
          isCurrentUser ? 'text-cyan-800 dark:text-cyan-200' : 'text-gray-900 dark:text-white'
        )}
      >
        {name}
        {isCurrentUser && ' (You)'}
        {isHint && (
          <span className="ml-2 inline-block rounded-full bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold whitespace-nowrap text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            Hint
          </span>
        )}
      </th>
      <td className="px-2 py-2 text-right align-top whitespace-nowrap text-gray-800 tabular-nums sm:px-3 dark:text-gray-200">
        {value}
      </td>
    </tr>
  );
}
