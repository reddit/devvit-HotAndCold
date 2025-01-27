import './guessTicker.css';

import { Fragment, useEffect, useState } from 'react';
import { useDevvitListener } from '../hooks/useDevvitListener';
import { Guess } from '@hotandcold/raid-shared';
import { cn } from '@hotandcold/webview-common/utils';
import { useGame } from '../hooks/useGame';

function shuffle<T>(array: T[]): T[] {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export const GuessTicker = () => {
  const { challengeTopGuesses, challengeUserInfo } = useGame();
  const [guessTickerValues, setGuessTickerValues] = useState<Guess[]>([]);

  const data = useDevvitListener('NEW_GUESS_FROM_GUESS_STREAM');

  useEffect(() => {
    if (data) {
      setGuessTickerValues((x) => [data.guess, ...x].slice(0, 50));
    }
  }, [data]);

  useEffect(() => {
    if (guessTickerValues.length === 0 && challengeTopGuesses) {
      // We just yolo some stuff in there so it's not empty since the realtime stuff isn't
      // stateful
      setGuessTickerValues(
        shuffle(challengeTopGuesses.filter((x) => x.username !== challengeUserInfo?.username))
      );
    }
  }, [challengeTopGuesses, guessTickerValues]);

  return (
    <div className="flex h-[20px] w-full items-center gap-2 rounded-lg border border-gray-800 text-xs">
      <div className="ml-[2px] flex h-[14px] items-center rounded-l-md bg-gray-600 p-1">
        <div className="h-2 w-2 animate-pulse rounded-lg bg-red-600"></div>&nbsp;LATEST
      </div>
      <div className="ticker-scroll flex items-center gap-2 overflow-x-auto">
        {guessTickerValues.map((item, i) => {
          return (
            <Fragment key={`${item.timestamp}-${item.username}-${item.word}`}>
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
                &nbsp;{item.username}: {item.word} ({item.normalizedSimilarity}%)
              </p>
              {i !== guessTickerValues.length - 1 ? <div>|</div> : null}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
};
