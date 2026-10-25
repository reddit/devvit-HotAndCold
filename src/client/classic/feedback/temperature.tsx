import clsx from 'clsx';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Temperature } from './audio';
import { audioPreferences } from './audio';
import './temperature.css';
import { FlameIcon, SnowflakeIcon } from '../icons';

export const TEMPERATURE_FEEDBACK_MS = 1400;

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
}: {
  direction: Temperature | null;
  sequence: number;
  showBadge?: boolean;
  contained?: boolean;
}) {
  return (
    <>
      {direction && audioPreferences.value.motion && (
        <div
          key={sequence}
          aria-hidden="true"
          className={clsx(
            'temperature-backdrop',
            `temperature-backdrop--${direction}`,
            contained && 'temperature-backdrop--contained'
          )}
          style={{ animationDuration: `${TEMPERATURE_FEEDBACK_MS}ms` }}
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
