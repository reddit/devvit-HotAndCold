import { motion, AnimatePresence } from 'motion/react';

export type Guess = {
  word: string;
  similarity: number;
};

export const Guesses = ({ items }: { items: Guess[] }) => {
  return (
    <div className="flex flex-col items-center gap-4 p-4 relative z-10">
      <div className="flex flex-col gap-2 w-48">
        <AnimatePresence mode="popLayout">
          {items.map((item) => (
            <motion.div
              key={item.word}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded cursor-pointer text-white"
            >
              <span>{item.word}</span>: <span>{item.similarity}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};
