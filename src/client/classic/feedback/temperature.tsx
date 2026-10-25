import type { Temperature } from './audio';
import { audioPreferences } from './audio';
import './temperature.css';

export function GuessTemperature({
  direction,
  sequence,
}: {
  direction: Temperature | null;
  sequence: number;
}) {
  return (
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
          <svg
            aria-hidden="true"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {direction === 'warmer' ? (
              <path d="M13 3c1 5-3 6-2 9 2-1 3-3 3-3 4 4 5 6 3 9-3 5-11 2-11-3 0-3 2-6 4-8 0 3 1 3 1 3 2-2 2-4 2-7Z" />
            ) : (
              <>
                <path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3M3 10l4-1-1-4M21 14l-4 1 1 4M6 19l1-4-4-1M18 5l-1 4 4 1" />
              </>
            )}
          </svg>
          <span>
            {direction === 'warmer' ? 'Warmer' : 'Colder'}
            <span className="sr-only"> than your previous guess</span>
          </span>
        </span>
      )}
    </div>
  );
}
