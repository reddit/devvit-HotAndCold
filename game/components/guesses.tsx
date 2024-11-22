import { motion, AnimatePresence } from 'motion/react';
import { useUserSettings } from '../hooks/useUserSettings';
import { Guess } from '../shared';
import { cn } from '../utils';

export const Guesses = ({ items }: { items: Guess[] }) => {
  const { sortDirection, sortType } = useUserSettings();

  const sortedItems = items.sort((a, b) => {
    if (sortType === 'SIMILARITY') {
      return sortDirection === 'ASC' ? a.similarity - b.similarity : b.similarity - a.similarity;
    } else {
      return sortDirection === 'ASC' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp;
    }
  });

  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center gap-4 p-4">
      <div className="flex w-48 flex-1 flex-col gap-2 overflow-auto">
        <AnimatePresence mode="popLayout">
          {sortedItems.map((item) => (
            <motion.div
              key={item.word}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex justify-between rounded text-xs"
            >
              <span className="text-gray-50">{item.word}</span>
              <span
                className={cn(
                  '',
                  item.normalizedSimilarity < 40 && 'text-[#4DE1F2]',
                  item.normalizedSimilarity >= 40 &&
                    item.normalizedSimilarity < 80 &&
                    'text-[#FED155]',
                  item.normalizedSimilarity >= 80 && 'text-[#FE5555]'
                )}
              >
                {item.normalizedSimilarity}%
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};
