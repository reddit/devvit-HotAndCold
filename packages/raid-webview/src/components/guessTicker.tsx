import { Fragment, useEffect, useState } from 'react';
import { useDevvitListener } from '../hooks/useDevvitListener';
import { Guess } from '@hotandcold/raid-shared';
import { cn } from '@hotandcold/webview-common/utils';

export const GuessTicker = () => {
  const [guessTickerValues, setGuessTickerValues] = useState<Guess[]>([]);

  const data = useDevvitListener('NEW_GUESS_FROM_GUESS_STREAM');

  useEffect(() => {
    if (data) {
      setGuessTickerValues((x) => [data.guess, ...x].slice(0, 50));
    }
  }, [data]);

  return (
    <div className="flex h-[20px] w-full items-center gap-4 rounded-lg border border-gray-800 text-xs">
      <div className="ml-[2px] flex h-[14px] items-center rounded-l-md bg-gray-600 p-1">
        <div className="h-2 w-2 animate-pulse rounded-lg bg-red-600"></div>&nbsp;LATEST
      </div>
      <div className="flex items-center gap-2 overflow-x-auto">
        {guessTickerValues.map((item, i) => {
          return (
            <Fragment key={`${item.timestamp}-${item.username}-${item.word}`}>
              {i % 2 ? <div>|</div> : null}
              <p
                key={item.timestamp}
                className={cn(
                  'flex-shrink-0 text-xs text-[#8BA2AD]',
                  item.normalizedSimilarity < 40 && 'text-[#4DE1F2]',
                  item.normalizedSimilarity >= 40 &&
                    item.normalizedSimilarity < 80 &&
                    'text-[#FED155]',
                  item.normalizedSimilarity >= 80 && 'text-[#FE5555]'
                )}
              >
                <img
                  src={item.snoovatar ?? '/assets/default_snoovatar.png'}
                  className="inline h-[16px] object-contain"
                />
                &nbsp;{item.username}: {item.word}
              </p>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
};
