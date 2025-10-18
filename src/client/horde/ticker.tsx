import './ticker.css';

import { Fragment } from 'preact/jsx-runtime';
import { cn } from '../utils/cn';
import { hordeTickerGuesses } from './state/realtime';

const DEFAULT_SNOOVATAR = '/assets/default_snoovatar.png';

export const GuessTicker = () => {
  const items = hordeTickerGuesses;

  return (
    <div className="flex h-[20px] w-full items-center gap-2 rounded-lg border border-gray-800 text-xs">
      <div className="ml-[2px] flex h-[14px] items-center rounded-l-md bg-gray-600 p-1">
        <div className="h-2 w-2 animate-pulse rounded-lg bg-red-600"></div>&nbsp;LATEST
      </div>
      <div className="ticker-scroll flex items-center gap-2 overflow-x-auto">
        {items.value.map((item, i) => {
          const safeRank = Number.isFinite(item.rank) ? (item.rank as number) : -1;
          const colorClass =
            safeRank >= 1000
              ? 'text-blue-700 dark:text-[#4DE1F2]'
              : safeRank >= 250
                ? 'text-yellow-700 dark:text-[#FED155]'
                : 'text-red-700 dark:text-[#FE5555]';
          return (
            <Fragment key={`${item.atMs}-${item.username ?? ''}-${item.word}`}>
              <p className={cn('flex-shrink-0 text-xs text-[#8BA2AD]', colorClass)}>
                {item.username ? (
                  <span className="mr-1 inline-flex items-center">
                    <img
                      src={item.snoovatar || DEFAULT_SNOOVATAR}
                      alt={item.username ? `${item.username}'s avatar` : 'Player avatar'}
                      title={item.username}
                      className="h-4 w-4 rounded-full object-cover"
                    />
                  </span>
                ) : null}
                {item.word} {safeRank > 0 ? `( #${safeRank} )` : ''}
              </p>
              {i !== items.value.length - 1 ? <div>|</div> : null}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
};
