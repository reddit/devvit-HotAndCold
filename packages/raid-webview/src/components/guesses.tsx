import { motion, AnimatePresence } from 'motion/react';
import { useUserSettings } from '../hooks/useUserSettings';
import { Guess } from '@hotandcold/raid-shared';
import { cn } from '@hotandcold/webview-common/utils';
import { ReactNode, useEffect, useState } from 'react';
import { useDimensions } from '@hotandcold/webview-common/hooks/useDimensions';
import { HowToPlayModal } from './howToPlayModal';

export const GuessItem = ({
  item,
  variant,
  highlight,
}: {
  item: Guess;
  variant: 'community' | 'user';
  highlight?: boolean;
}) => {
  const { layout } = useUserSettings();
  return (
    <p
      className={cn(
        'relative flex w-full justify-between gap-1 rounded border border-transparent px-1',
        highlight && 'border-gray-500 bg-gray-700/50'
      )}
    >
      <span
        className={cn(
          'flex flex-shrink-0 items-center',
          highlight ? 'font-medium text-white' : 'text-gray-50'
        )}
      >
        {variant === 'community' && item.username && (
          <div className="group relative mr-1">
            <img
              src={item.snoovatar ?? '/assets/default_snoovatar.png'}
              className="inline object-contain"
              style={{
                height: layout === 'CONDENSED' ? '18px' : '22px',
              }}
            />
            <span className="absolute left-0 top-[-100%] m-4 mx-auto rounded-md bg-gray-800 px-1 text-sm text-gray-100 opacity-0 transition-opacity group-hover:opacity-100">
              {item.username}
            </span>
          </div>
        )}
        {item.word} {item.rank <= 250 && item.rank !== -1 ? ` (#${item.rank})` : null}&nbsp;
      </span>
      <span
        className={cn(
          'flex flex-shrink-0 items-center text-right',
          // TODO: Keep in sync with guess service comment stream thing
          item.normalizedSimilarity < 40 && 'text-[#4DE1F2]',
          item.normalizedSimilarity >= 40 && item.normalizedSimilarity < 80 && 'text-[#FED155]',
          item.normalizedSimilarity >= 80 && 'text-[#FE5555]'
        )}
      >
        {item.normalizedSimilarity}%
      </span>
    </p>
  );
};

export const Guesses = ({
  items,
  title,
  variant,
  emptyState,
}: {
  items: Guess[];
  title: string;
  variant: 'community' | 'user';
  emptyState: ReactNode;
}) => {
  const { sortDirection, sortType, layout } = useUserSettings();
  const [currentPage, setCurrentPage] = useState(1);
  const [ref, dimensions] = useDimensions();
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);

  const GUESS_HEIGHT = layout == 'CONDENSED' ? 16 : 22;

  const latestGuess = items.reduce(
    (latest, current) => {
      return !latest || current.timestamp > latest.timestamp ? current : latest;
    },
    null as Guess | null
  );

  const sortedItems = items.sort((a, b) => {
    if (sortType === 'SIMILARITY') {
      return sortDirection === 'ASC' ? a.similarity - b.similarity : b.similarity - a.similarity;
    } else {
      return sortDirection === 'ASC' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp;
    }
  });

  const itemsPerPage = Math.max(
    1,
    Math.floor((dimensions.height - (28 + (sortedItems.length > 1 ? 28 : 0))) / GUESS_HEIGHT)
  );

  const totalPages = Math.ceil(sortedItems.length / itemsPerPage);
  const paginatedItems = sortedItems.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [sortDirection, sortType, itemsPerPage]);

  return (
    <>
      <div
        ref={ref}
        className={cn(
          'relative z-10 flex h-full w-60 flex-col self-center overflow-hidden',
          layout === 'CONDENSED' && 'text-sm',
          layout === 'EXPANDED' && 'text-md'
        )}
      >
        <div className="font-xs font-bold underline">{title}</div>
        <div className="flex-1">
          <AnimatePresence mode="popLayout">
            {paginatedItems.length > 0 ? (
              paginatedItems.map((item) => (
                <motion.div
                  key={item.word}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: GUESS_HEIGHT }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <GuessItem
                    item={item}
                    variant={variant}
                    highlight={variant === 'user' && item.timestamp === latestGuess?.timestamp}
                  />
                </motion.div>
              ))
            ) : (
              <p>{emptyState}</p>
            )}
          </AnimatePresence>
        </div>

        {totalPages > 1 && (
          <div className="flex h-7 items-center justify-center gap-3">
            <button
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className={cn(
                'rounded px-1 py-1',
                currentPage === 1 ? 'cursor-not-allowed opacity-50' : 'hover:bg-gray-700'
              )}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                <path d="M13.883 5.007l.058 -.005h.118l.058 .005l.06 .009l.052 .01l.108 .032l.067 .027l.132 .07l.09 .065l.081 .073l.083 .094l.054 .077l.054 .096l.017 .036l.027 .067l.032 .108l.01 .053l.01 .06l.004 .057l.002 .059v12c0 .852 -.986 1.297 -1.623 .783l-.084 -.076l-6 -6a1 1 0 0 1 -.083 -1.32l.083 -.094l6 -6l.094 -.083l.077 -.054l.096 -.054l.036 -.017l.067 -.027l.108 -.032l.053 -.01l.06 -.01z" />
              </svg>
            </button>
            <span className="">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className={cn(
                'rounded px-1 py-1',
                currentPage === totalPages ? 'cursor-not-allowed opacity-50' : 'hover:bg-gray-700'
              )}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                <path d="M9 6c0 -.852 .986 -1.297 1.623 -.783l.084 .076l6 6a1 1 0 0 1 .083 1.32l-.083 .094l-6 6l-.094 .083l-.077 .054l-.096 .054l-.036 .017l-.067 .027l-.108 .032l-.053 .01l-.06 .01l-.057 .004l-.059 .002l-.059 -.002l-.058 -.005l-.06 -.009l-.052 -.01l-.108 -.032l-.067 -.027l-.132 -.07l-.09 -.065l-.081 -.073l-.083 -.094l-.054 -.077l-.054 -.096l-.017 -.036l-.027 -.067l-.032 -.108l-.01 -.053l-.01 -.06l-.004 -.057l-.002 -12.059z" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <HowToPlayModal isOpen={howToPlayOpen} onClose={() => setHowToPlayOpen(false)} />
    </>
  );
};
