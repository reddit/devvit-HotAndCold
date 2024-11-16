import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../utils';
import { PlaceholdersAndVanishInput } from './wordInput';
import { List } from './guesses';

const colors = {
  cyan: {
    primary: 'rgb(6, 182, 212)',
    light: 'rgb(34, 211, 238)',
  },
  purple: {
    primary: 'rgb(168, 85, 247)',
    light: 'rgb(192, 132, 252)',
  },
  orange: {
    primary: 'rgb(249, 115, 22)',
    light: 'rgb(251, 146, 60)',
  },
};

export function LampDemo() {
  return (
    <LampContainer>
      <div className="flex flex-col gap-4">
        <PlaceholdersAndVanishInput
          onChange={() => {
            console.log('change');
          }}
          onSubmit={() => {
            console.log('on submit');
          }}
          placeholders={['Can you guess the word?']}
        />
        <div className="h-64 overflow-y-auto">
          <List />
        </div>
      </div>
    </LampContainer>
  );
}

export const LampContainer = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  const colorKeys = Object.keys(colors);
  const [colorIndex, setColorIndex] = useState(0);

  const handleClick = () => {
    setColorIndex((prev) => (prev + 1) % colorKeys.length);
  };

  const currentColor = colors[colorKeys[colorIndex]];

  return (
    <div
      className={cn(
        'relative flex h-[512px] flex-col items-center justify-center overflow-hidden bg-slate-950 w-full rounded-md z-0',
        className
      )}
      onClick={handleClick}
    >
      <div className="relative flex w-full flex-1 scale-y-125 items-center justify-center isolate z-0">
        <motion.div
          initial={{ opacity: 0.5, width: '12rem' }}
          whileInView={{ opacity: 1, width: '24rem' }}
          transition={{
            delay: 0.3,
            duration: 0.8,
            ease: 'easeInOut',
          }}
          className="absolute inset-auto right-1/2 h-44 overflow-visible w-[24rem] text-white"
        >
          <motion.div
            className="absolute inset-0"
            initial={{
              background: `conic-gradient(from 70deg at center top, ${colors.cyan.primary}, transparent, transparent)`,
            }}
            animate={{
              background: `conic-gradient(from 70deg at center top, ${currentColor.primary}, transparent, transparent)`,
            }}
            transition={{
              duration: 0.5,
              ease: 'easeInOut',
            }}
          />
          <div className="absolute w-[100%] left-0 bg-slate-950 h-32 bottom-0 z-20 [mask-image:linear-gradient(to_top,white,transparent)]" />
          <div className="absolute w-32 h-[100%] left-0 bg-slate-950 bottom-0 z-20 [mask-image:linear-gradient(to_right,white,transparent)]" />
        </motion.div>
        <motion.div
          initial={{ opacity: 0.5, width: '12rem' }}
          whileInView={{ opacity: 1, width: '24rem' }}
          transition={{
            delay: 0.3,
            duration: 0.8,
            ease: 'easeInOut',
          }}
          className="absolute inset-auto left-1/2 h-44 w-[24rem] text-white"
        >
          <motion.div
            className="absolute inset-0"
            initial={{
              background: `conic-gradient(from 290deg at center top, transparent, transparent, ${colors.cyan.primary})`,
            }}
            animate={{
              background: `conic-gradient(from 290deg at center top, transparent, transparent, ${currentColor.primary})`,
            }}
            transition={{
              duration: 0.5,
              ease: 'easeInOut',
            }}
          />
          <div className="absolute w-32 h-[100%] right-0 bg-slate-950 bottom-0 z-20 [mask-image:linear-gradient(to_left,white,transparent)]" />
          <div className="absolute w-[100%] right-0 bg-slate-950 h-32 bottom-0 z-20 [mask-image:linear-gradient(to_top,white,transparent)]" />
        </motion.div>
        <div className="absolute top-1/2 h-36 w-full translate-y-8 scale-x-150 bg-slate-950 blur-2xl"></div>
        <div className="absolute top-1/2 z-50 h-36 w-full bg-transparent opacity-10 backdrop-blur-md"></div>
        <motion.div
          className="absolute inset-auto z-50 h-24 w-[22rem] -translate-y-1/2 rounded-full opacity-50 blur-3xl"
          initial={{ backgroundColor: colors.cyan.primary }}
          animate={{
            backgroundColor: currentColor.primary,
          }}
          transition={{
            duration: 0.5,
            ease: 'easeInOut',
          }}
        ></motion.div>
        <motion.div
          initial={{ width: '6rem', backgroundColor: colors.cyan.light }}
          whileInView={{ width: '12rem' }}
          animate={{
            backgroundColor: currentColor.light,
          }}
          transition={{
            backgroundColor: {
              duration: 0.5,
              ease: 'easeInOut',
            },
            delay: 0.3,
            duration: 0.8,
            ease: 'easeInOut',
          }}
          className="absolute inset-auto z-30 h-24 w-48 -translate-y-[4.5rem] rounded-full blur-2xl"
        ></motion.div>
        <motion.div
          initial={{ width: '12rem', backgroundColor: colors.cyan.light }}
          whileInView={{ width: '24rem' }}
          animate={{
            backgroundColor: currentColor.light,
          }}
          transition={{
            backgroundColor: {
              duration: 0.5,
              ease: 'easeInOut',
            },
            delay: 0.3,
            duration: 0.8,
            ease: 'easeInOut',
          }}
          className="absolute inset-auto z-50 h-0.5 w-[24rem] -translate-y-[5.5rem]"
        ></motion.div>

        <div className="absolute inset-auto z-40 h-32 w-full -translate-y-[9.5rem] bg-slate-950"></div>
      </div>

      <div className="relative z-50 flex  flex-col items-center px-5">{children}</div>
    </div>
  );
};
