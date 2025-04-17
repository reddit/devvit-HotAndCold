import { motion, AnimatePresence } from 'motion/react';
import { useUserSettings } from '../hooks/useUserSettings';
import { Guess } from '@hotandcold/classic-shared';
import { cn } from '@hotandcold/webview-common/utils';
import { useEffect, useState } from 'react';
import { useDimensions } from '@hotandcold/webview-common/hooks/useDimensions';

// const ProximityIndicator = ({ guess }: { guess: Guess }) => {
//   const fill = Math.round((1 - guess.rank / 1000) * 100);
//   return (
//     <motion.div
//       className="absolute right-1 top-0 flex h-full translate-x-full items-center gap-1 pl-1"
//       initial={{ opacity: 0, scale: 0.8 }}
//       animate={{ opacity: 1, scale: 1 }}
//       transition={{ type: 'spring', duration: 0.5 }}
//     >
//       <span className="text-sm text-[#FE5555]">#{guess.rank}</span>
//       <motion.div className="relative h-1.5 w-12 overflow-hidden rounded-full bg-gray-700">
//         <motion.div
//           className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-[#4DE1F2] via-[#FED155] to-[#FE5555]"
//           initial={{ width: '0%' }}
//           animate={{ width: `${fill}%` }}
//           transition={{ type: 'spring', duration: 0.7 }}
//         />
//       </motion.div>
//     </motion.div>
//   );
// };

const GuessItem = ({ item, latestGuess }: { item: Guess; latestGuess?: Guess }) => {
  return (
    <p
      className={cn(
        'relative flex w-full justify-between gap-1 rounded px-1',
        item.timestamp === latestGuess?.timestamp && 'border border-gray-500 bg-gray-700/50'
      )}
    >
      <span
        className={cn(
          'truncate',
          item.timestamp === latestGuess?.timestamp ? 'font-medium text-white' : 'text-gray-50'
        )}
      >
        {item.word} {item.rank <= 250 && item.rank !== -1 ? ` (#${item.rank})` : null}
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

const PreviousPageIcon = () => (
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
);

const NextPageIcon = () => (
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
);

export const Guesses = ({
  items,
  updatePaginationSeed,
}: {
  items: Guess[];
  /**
   * Used to trigger re-measurement of the pagination.
   * This is a workaround for the fact that the pagination is animated into the view,
   * and the height of the container is not updated until the animation is complete.
   * Without this, the pagination only holds one item per page.
   */
  updatePaginationSeed: number;
}) => {
  const { sortDirection, sortType, layout } = useUserSettings();
  const [currentPage, setCurrentPage] = useState(1);
  const [ref, dimensions, reMeasure] = useDimensions();

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

  // Re-measure the available height when the parent asks for it
  useEffect(() => {
    if (updatePaginationSeed > 0) {
      reMeasure();
    }
  }, [updatePaginationSeed]);

  return (
    <div
      ref={ref}
      className={cn(
        'relative z-10 flex h-full w-60 flex-col self-center',
        layout === 'CONDENSED' && 'text-sm',
        layout === 'EXPANDED' && 'text-md'
      )}
    >
      {sortedItems.length > 0 && (
        <div className="flex h-7 w-full flex-col content-end items-start gap-1">
          {latestGuess && sortedItems.length > 1 && (
            <GuessItem item={latestGuess} latestGuess={latestGuess} />
          )}
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="popLayout">
          {paginatedItems.map((item) => (
            <motion.div
              key={item.word}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: GUESS_HEIGHT }}
              exit={{ opacity: 0, height: 0 }}
            >
              <GuessItem item={item} />
            </motion.div>
          ))}
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
            <PreviousPageIcon />
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
            <NextPageIcon />
          </button>
        </div>
      )}
    </div>
  );
};
