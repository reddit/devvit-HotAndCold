import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@hotandcold/webview-common/utils';
import { PrimaryButton } from './button';
import { useWordSubmission } from '@hotandcold/classic-webview/src/hooks/useGame';

type PixelData = {
  x: number;
  y: number;
  r: number;
  color: string;
};

// Spinning loading indicator component
const SpinningCircle = ({ className = "h-5 w-5 text-white" }: { className?: string }) => (
  <div className="flex items-center justify-center h-5 w-5">
    <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  </div>
);

export function WordInput({
  placeholders,
  onChange,
  onSubmit,
  autoFocusOnKeypress = true,
  value: externalValue = '', // New prop for controlled input
  isHighContrast = false,
}: {
  placeholders: string[];
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (animationDuration: number) => void;
  autoFocusOnKeypress?: boolean;
  value?: string; // Add to props interface
  isHighContrast?: boolean;
}) {
  const [currentPlaceholder, setCurrentPlaceholder] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [internalValue, setInternalValue] = useState(externalValue);
  const { isSubmitting } = useWordSubmission();

  // Sync internal value with external value
  useEffect(() => {
    setInternalValue(externalValue);
  }, [externalValue]);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const newDataRef = useRef<PixelData[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const startAnimation = () => {
    intervalRef.current = setInterval(() => {
      setCurrentPlaceholder((prev) => (prev + 1) % placeholders.length);
    }, 3000);
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible' && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    } else if (document.visibilityState === 'visible') {
      startAnimation();
    }
  };

  useEffect(() => {
    startAnimation();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [placeholders]);

  useEffect(() => {
    if (!autoFocusOnKeypress) return;

    const handleGlobalKeyPress = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (
        e.key === 'Escape' ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.key === 'Shift' ||
        e.key === 'Tab' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      ) {
        return;
      }

      if (document.visibilityState === 'visible' && inputRef.current) {
        e.preventDefault();
        inputRef.current.focus();

        if (e.key.length === 1) {
          const newValue = e.key;
          onChange?.({
            target: { value: newValue },
          } as React.ChangeEvent<HTMLInputElement>);
        }
      }
    };

    if (document.visibilityState === 'visible') {
      document.addEventListener('keydown', handleGlobalKeyPress);
    }

    return () => {
      document.removeEventListener('keydown', handleGlobalKeyPress);
    };
  }, [autoFocusOnKeypress, onChange]);

  const draw = useCallback(() => {
    if (!inputRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 800;
    canvas.height = 800;
    ctx.clearRect(0, 0, 800, 800);
    const computedStyles = getComputedStyle(inputRef.current);

    const fontSize = parseFloat(computedStyles.getPropertyValue('font-size'));
    ctx.font = `${fontSize * 2}px ${computedStyles.fontFamily}`;
    ctx.fillStyle = '#FFF';
    ctx.fillText(internalValue, 16, 40);

    const imageData = ctx.getImageData(0, 0, 800, 800);
    const pixelData = imageData.data;
    const newData: PixelData[] = [];

    for (let t = 0; t < 800; t++) {
      const i = 4 * t * 800;
      for (let n = 0; n < 800; n++) {
        const e = i + 4 * n;
        if (pixelData[e] !== 0 && pixelData[e + 1] !== 0 && pixelData[e + 2] !== 0) {
          newData.push({
            x: n,
            y: t,
            r: 1,
            color: `rgba(${pixelData[e]}, ${pixelData[e + 1]}, ${pixelData[e + 2]}, ${pixelData[e + 3]})`,
          });
        }
      }
    }

    newDataRef.current = newData;
  }, [internalValue]);

  useEffect(() => {
    draw();
  }, [internalValue, draw]);

  const animate = (start: number) => {
    const animateFrame = (pos: number = 0) => {
      requestAnimationFrame(() => {
        const newArr = [];
        for (let i = 0; i < newDataRef.current.length; i++) {
          const current = newDataRef.current[i];
          if (current.x < pos) {
            newArr.push(current);
          } else {
            if (current.r <= 0) {
              current.r = 0;
              continue;
            }
            current.x += Math.random() > 0.5 ? 1 : -1;
            current.y += Math.random() > 0.5 ? 1 : -1;
            current.r -= 0.05 * Math.random();
            newArr.push(current);
          }
        }
        newDataRef.current = newArr;
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) {
          ctx.clearRect(pos, 0, 800, 800);
          newDataRef.current.forEach((t) => {
            const { x: n, y: i, r: s, color: color } = t;
            if (n > pos) {
              ctx.beginPath();
              ctx.rect(n, i, s, s);
              ctx.fillStyle = color;
              ctx.strokeStyle = color;
              ctx.stroke();
            }
          });
        }
        if (newDataRef.current.length > 0) {
          animateFrame(pos - 8);
        } else {
          // Don't reset the value anymore, let the parent control it
          setAnimating(false);
        }
      });
    };
    animateFrame(start);
  };

  const vanishAndSubmit = () => {
    if (!internalValue) return;

    setAnimating(true);
    draw();

    if (inputRef.current) {
      const maxX = newDataRef.current.reduce(
        (prev, current) => (current.x > prev ? current.x : prev),
        0
      );

      // Calculate animation duration based on width
      // 8 pixels per frame at 60fps
      const pixelsPerFrame = 8;
      const framesNeeded = maxX / pixelsPerFrame;
      const durationMs = (framesNeeded / 60) * 1000; // convert to milliseconds

      // Add a small buffer for safety
      const totalDuration = durationMs + 100;

      animate(maxX);

      // Let parent know how long to wait
      onSubmit(totalDuration);
    }
  };

  const handleSubmit = () => {
    if (internalValue) {
      vanishAndSubmit();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !animating && !isSubmitting) {
      handleSubmit();
    }
  };

  return (
    <div className={cn('relative mx-auto flex w-full max-w-xl items-center gap-2 overflow-hidden')}>
      <canvas
        className={cn(
          'pointer-events-none absolute left-[5px] top-[15%] z-[1000] origin-top-left scale-50 transform pr-20 text-base invert filter dark:invert-0',
          !animating ? 'opacity-0' : 'opacity-100'
        )}
        ref={canvasRef}
      />
      <input
        onChange={(e) => {
          if (!animating && !isSubmitting && onChange) {
            onChange(e);
          }
        }}
        spellCheck="false"
        onKeyDown={handleKeyDown}
        ref={inputRef}
        value={internalValue}
        type="text"
        autoCorrect="on"
        autoComplete="off"
        enterKeyHint="send"
        disabled={isSubmitting}
        className={cn(
          'text-md relative z-50 h-14 w-full rounded-full border-none px-4 text-black shadow-[0px_2px_3px_-1px_rgba(0,0,0,0.1),_0px_1px_0px_0px_rgba(25,28,33,0.02),_0px_0px_0px_1px_rgba(25,28,33,0.08)] transition duration-200 focus:outline-none focus:ring-0 dark:text-white',
          animating && 'text-transparent dark:text-transparent',
          internalValue && 'bg-gray-50 dark:bg-gray-800',
          isHighContrast ? 'bg-white dark:bg-black' : 'bg-gray-50 dark:bg-gray-800',
          isSubmitting && 'cursor-not-allowed opacity-70'
        )}
      />

      <PrimaryButton
        isHighContrast={isHighContrast}
        disabled={!internalValue || isSubmitting}
        type="submit"
        className="z-50 flex-shrink-0"
        onMouseDown={(e) => {
          // Workaround for ios and android blurring the input on button click
          e.preventDefault();
          if (!isSubmitting) {
            handleSubmit();
          }
        }}
      >
        {isSubmitting ? <SpinningCircle /> : 'Guess'}
      </PrimaryButton>

      <div className="pointer-events-none absolute inset-0 z-[1010] flex items-center rounded-full">
        <AnimatePresence mode="wait">
          {!internalValue && (
            <motion.p
              initial={{
                y: 5,
                opacity: 0,
              }}
              key={`current-placeholder-${currentPlaceholder}`}
              animate={{
                y: 0,
                opacity: 1,
              }}
              exit={{
                y: -10,
                opacity: 0,
              }}
              transition={{
                duration: 0.2,
                ease: 'linear',
              }}
              className="text-md w-[calc(100%-2rem)] truncate pl-4 text-left font-normal text-neutral-500 dark:text-zinc-500"
            >
              {placeholders[currentPlaceholder]}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
