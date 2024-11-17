import { motion, AnimatePresence } from 'motion/react';
import { useUserSettings } from '../hooks/useUserSettings';
import { Guess } from '../shared';

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
    <div className="relative z-10 flex flex-col items-start gap-4 p-4">
      <div className="flex w-48 flex-col gap-2">
        <AnimatePresence mode="popLayout">
          {sortedItems.map((item) => (
            <motion.div
              key={item.word}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex cursor-pointer rounded text-xs text-white"
            >
              <span>{item.word}</span>: <span>{item.similarity}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};
