import { ComponentProps, JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { PrimaryButton } from './button';
import { cn } from '../utils/cn';
import { makeGuess } from '../core/guess';
import type { ClientGuessResult } from '../core/guessEngine';
import { experiments } from '../../shared/experiments/experiments';
import { context } from '@devvit/web/client';

export type WordInputResult = {
  similarity: number;
  rank: number;
} | null;

export type WordInputProps = {
  placeholders: string[];
  onChange?: (value: string) => void;
  onSubmit?: (animationDurationMs: number) => void;
  onGuess?: (result: WordInputResult) => void;
  onFeedback?: (message: string) => void;
  autoFocusOnKeypress?: boolean;
  value?: string;
  isHighContrast?: boolean;
  submitGuess?: (word: string) => Promise<ClientGuessResult | WordInputResult>;
} & Omit<ComponentProps<'div'>, 'onChange'>;

type PixelData = {
  x: number;
  y: number;
  r: number;
  color: string;
};

const SpinningCircle = ({ className = 'h-5 w-5 text-white' }: { className?: string }) => (
  <div className="flex h-5 w-5 items-center justify-center">
    <svg
      className={`animate-spin ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      ></circle>
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      ></path>
    </svg>
  </div>
);

export function WordInput({
  placeholders,
  onChange,
  onSubmit,
  onGuess,
  onFeedback,
  autoFocusOnKeypress = true,
  value: externalValue = '',
  isHighContrast = false,
  submitGuess,
  className,
  ...rest
}: WordInputProps) {
  const defaultGuessToOn =
    experiments.evaluate(context.userId ?? '', 'exp_default_guess_to_on').treatment === 'on';

  const [currentPlaceholder, setCurrentPlaceholder] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [internalValue, setInternalValue] = useState(externalValue);

  // Sync internal value with external when controlled
  useEffect(() => {
    setInternalValue(externalValue);
  }, [externalValue]);

  const intervalRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const newDataRef = useRef<PixelData[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const startAnimation = () => {
    intervalRef.current = window.setInterval(() => {
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
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [placeholders]);

  useEffect(() => {
    if (!autoFocusOnKeypress) return;
    const handleGlobalKeyPress = (e: KeyboardEvent) => {
      const target = e.target as Element | null;
      if (target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement))
        return;
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
          setInternalValue(newValue);
          onChange?.(newValue);
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

  const draw = useCallback(
    (text?: string) => {
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
      const textToRender = text ?? internalValue ?? '';
      ctx.fillText(textToRender, 16, 40);

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
    },
    [internalValue]
  );

  useEffect(() => {
    draw();
  }, [internalValue, draw]);

  const animate = (start: number) => {
    const animateFrame = (pos: number = 0) => {
      requestAnimationFrame(() => {
        const next: PixelData[] = [];
        const data = newDataRef.current;
        for (let i = 0; i < data.length; i++) {
          const current = data[i]!;
          if (current.x < pos) {
            next.push(current);
          } else {
            if (current.r <= 0) {
              current.r = 0;
              continue;
            }
            current.x += Math.random() > 0.5 ? 1 : -1;
            current.y += Math.random() > 0.5 ? 1 : -1;
            current.r -= 0.05 * Math.random();
            next.push(current);
          }
        }
        newDataRef.current = next;
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) {
          ctx.clearRect(pos, 0, 800, 800);
          newDataRef.current.forEach((p) => {
            const { x, y, r, color } = p;
            if (x > pos) {
              ctx.beginPath();
              ctx.rect(x, y, r, r);
              ctx.fillStyle = color;
              ctx.strokeStyle = color;
              ctx.stroke();
            }
          });
        }
        if (newDataRef.current.length > 0) {
          animateFrame(pos - 8);
        } else {
          setIsAnimating(false);
        }
      });
    };
    animateFrame(start);
  };

  const vanishAndSubmit = async (wordOverride?: string) => {
    const wordSource = wordOverride ?? internalValue;
    if (!wordSource) return;
    setIsAnimating(true);
    draw(wordSource);

    if (inputRef.current) {
      const maxX = newDataRef.current.reduce(
        (prev, current) => (current.x > prev ? current.x : prev),
        0
      );
      const pixelsPerFrame = 8;
      const framesNeeded = maxX / pixelsPerFrame;
      const durationMs = (framesNeeded / 60) * 1000;
      const totalDuration = durationMs + 100;

      animate(maxX);
      onSubmit?.(totalDuration);

      try {
        const word = wordSource.toLowerCase();
        if (typeof submitGuess === 'function') {
          const res = await submitGuess(word);
          if (res && typeof (res as any).ok === 'boolean') {
            const r = res as ClientGuessResult;
            if (r.ok) {
              onGuess?.({ similarity: r.similarity, rank: r.rank ?? -1 });
              setInternalValue('');
              onChange?.('');
              inputRef.current?.focus();
            } else {
              onFeedback?.(r.message);
              if (
                r.code === 'NOT_IN_DICTIONARY' ||
                r.code === 'DUPLICATE' ||
                r.code === 'INVALID_CHARS'
              ) {
                setInternalValue('');
                onChange?.('');
              }
              inputRef.current?.focus();
            }
          } else {
            onGuess?.(res as WordInputResult);
            setInternalValue('');
            onChange?.('');
            inputRef.current?.focus();
          }
        } else {
          const result = await makeGuess(word);
          onGuess?.(result);
          setInternalValue('');
          onChange?.('');
          inputRef.current?.focus();
        }
      } catch (err) {
        console.error(err);
        const message = err instanceof Error ? err.message : 'Something went wrong';
        onFeedback?.(message);
      } finally {
        setIsLoading(false);
        inputRef.current?.focus();
      }
    }
  };

  const getPrefilledWord = useCallback(() => {
    const raw = placeholders[currentPlaceholder] ?? '';
    const stripped = raw.trim();
    const match = stripped.match(/^\s*try\s+(.+)$/i);
    const candidate = match ? match[1] : stripped;
    return (candidate ?? '').trim();
  }, [placeholders, currentPlaceholder]);

  const handleSubmit = () => {
    const prefilled = getPrefilledWord();
    const readyWord = internalValue || (defaultGuessToOn ? prefilled : '');
    if (!readyWord || isAnimating || isLoading) return;
    inputRef.current?.focus();
    setIsLoading(true);
    void vanishAndSubmit(readyWord);
  };

  const handleKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isAnimating && !isLoading) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className={cn(
        'relative mx-auto flex w-full max-w-xl items-center gap-2 overflow-hidden flex-shrink-0',
        className
      )}
      {...rest}
    >
      <canvas
        className={cn(
          'pointer-events-none absolute left-[7.5px] top-[21%] z-[1000] origin-top-left scale-50 transform pr-20 text-base invert filter dark:invert-0',
          !isAnimating ? 'opacity-0' : 'opacity-100'
        )}
        ref={canvasRef}
      />

      <input
        onInput={(e) => {
          if (isAnimating || isLoading) return;
          const next = (e.currentTarget as HTMLInputElement).value;
          setInternalValue(next);
          onChange?.(next);
        }}
        spellcheck={false}
        onKeyDown={handleKeyDown}
        ref={inputRef}
        value={internalValue}
        type="text"
        autoCorrect="on"
        autoComplete="off"
        enterKeyHint="send"
        className={cn(
          'text-md relative z-50 h-12 w-full rounded-full border-none px-4 text-black transition duration-200 focus:outline-none focus:ring-0 dark:text-white',
          // Ensure the input surface is visible in both color modes
          'bg-zinc-100 dark:bg-zinc-800',
          isAnimating && 'text-transparent dark:text-transparent',
          isLoading && 'cursor-not-allowed opacity-70'
        )}
      />

      <PrimaryButton
        isHighContrast={isHighContrast}
        disabled={!(internalValue || (defaultGuessToOn ? getPrefilledWord() : '')) || isLoading}
        type="submit"
        className="z-50 h-12 flex-shrink-0 flex items-center justify-center"
        onMouseDown={(e) => {
          e.preventDefault();
          if (!isLoading) handleSubmit();
        }}
      >
        <span className="relative inline-flex items-center justify-center">
          <span className={cn(isLoading ? 'invisible' : 'visible')}>Guess</span>
          {isLoading && (
            <span className="absolute inset-0 grid place-items-center">
              <SpinningCircle />
            </span>
          )}
        </span>
      </PrimaryButton>

      {/* Simple placeholder without React-only animation deps */}
      {!internalValue && !isAnimating && (
        <div className="pointer-events-none absolute inset-0 z-[1010] flex items-center rounded-full">
          <p className="text-md w-[calc(100%-2rem)] truncate pl-4 text-left font-normal text-neutral-500 dark:text-zinc-500">
            {placeholders[currentPlaceholder]}
          </p>
        </div>
      )}
    </div>
  );
}

export default WordInput;
