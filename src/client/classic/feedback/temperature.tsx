import clsx from 'clsx';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Temperature } from './audio';
import { audioPreferences, gameAudio } from './audio';
import './temperature.css';
import { FlameIcon, SnowflakeIcon } from '../icons';
import { guessHeat } from '../../shared/guessHeat';

export const TEMPERATURE_FEEDBACK_MS = 1400;

export function ResultTemperature({ didWin }: { didWin: boolean }) {
  useEffect(() => {
    void gameAudio.finish(didWin ? 'win' : 'give-up');
  }, [didWin]);
  return <TemperatureBackdrop tone={didWin ? 'victory' : 'frozen'} />;
}

export function TemperatureBackdrop({
  tone,
  close = false,
  contained = false,
  pulse = false,
}: {
  tone: Temperature | 'victory' | 'frozen';
  close?: boolean;
  contained?: boolean;
  pulse?: boolean;
}) {
  if (!audioPreferences.value.motion) return null;
  return (
    <div
      aria-hidden="true"
      className={clsx(
        'temperature-backdrop',
        `temperature-backdrop--${tone}`,
        close && 'temperature-backdrop--close',
        contained && 'temperature-backdrop--contained',
        pulse && 'temperature-backdrop--pulse'
      )}
      style={pulse ? { animationDuration: `${TEMPERATURE_FEEDBACK_MS}ms` } : undefined}
    />
  );
}

export function useTemperatureFeedback() {
  const [feedback, setFeedback] = useState<{
    direction: Temperature | null;
    sequence: number;
    showBadge: boolean;
  }>({ direction: null, sequence: 0, showBadge: false });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const showTemperature = (direction: Temperature) => {
    clearTimeout(timer.current);
    setFeedback((previous) => ({ direction, sequence: previous.sequence + 1, showBadge: true }));
    timer.current = setTimeout(() => {
      setFeedback((previous) => ({ ...previous, showBadge: false }));
    }, TEMPERATURE_FEEDBACK_MS);
  };
  return { ...feedback, showTemperature };
}

export function GuessTemperature({
  direction,
  sequence,
  showBadge = true,
  contained = false,
  rank,
}: {
  direction: Temperature | null;
  sequence: number;
  showBadge?: boolean;
  contained?: boolean;
  rank?: number | null;
}) {
  return (
    <>
      {direction && (
        <TemperatureBackdrop
          key={sequence}
          tone={direction}
          close={direction === 'warmer' && guessHeat(rank) === 2}
          contained={contained}
          pulse
        />
      )}
      <div
        className="flex h-6 shrink-0 items-center justify-center"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {direction && showBadge && (
          <span
            key={sequence}
            className={`guess-temperature guess-temperature--${direction}`}
            data-motion={audioPreferences.value.motion}
            title="Compared with your previous guess"
          >
            {direction === 'warmer' ? <FlameIcon /> : <SnowflakeIcon />}
            <span>
              {direction === 'warmer' ? 'Warmer' : 'Colder'}
              <span className="sr-only"> than your previous guess</span>
            </span>
          </span>
        )}
      </div>
    </>
  );
}
