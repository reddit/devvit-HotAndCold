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
    <div className="flex flex-col gap-4 p-4 relative z-10 items-start">
      <div className="flex flex-col gap-2 w-48">
        <AnimatePresence mode="popLayout">
          {sortedItems.map((item) => (
            <motion.div
              key={item.word}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded cursor-pointer text-white flex text-xs"
            >
              <span>{item.word}</span>: <span>{item.similarity}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};
