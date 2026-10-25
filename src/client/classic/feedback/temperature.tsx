import clsx from 'clsx';
import type { Temperature } from './audio';
import { audioPreferences } from './audio';
import './temperature.css';
import { FlameIcon, SnowflakeIcon } from '../icons';

export const TEMPERATURE_FEEDBACK_MS = 1400;

export function GuessTemperature({
  direction,
  sequence,
  contained = false,
}: {
  direction: Temperature | null;
  sequence: number;
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
        {direction && (
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
