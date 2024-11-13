type TimeToMillisecondsInput = {
  seconds?: number;
  minutes?: number;
  hours?: number;
  days?: number;
};

const TIME_UNITS = {
  seconds: 1000,
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
} as const;

/**
 * Converts time units to milliseconds
 * @param time Object containing time units to convert
 * @returns Total milliseconds
 * @example
 * toMilliseconds({ minutes: 5 }) // 300000
 * toMilliseconds({ hours: 1, minutes: 30 }) // 5400000
 * toMilliseconds({ days: 1, hours: 12 }) // 129600000
 */
export const toMilliseconds = (time: TimeToMillisecondsInput): number => {
  if (Object.keys(time).length === 0) {
    return 0;
  }

  return Object.entries(time).reduce((total, [unit, value]) => {
    if (value === undefined || value === null) {
      return total;
    }

    if (value < 0) {
      throw new Error(
        `Invalid ${unit} value: ${value}. Time units must be positive numbers.`,
      );
    }

    if (!Number.isFinite(value)) {
      throw new Error(
        `Invalid ${unit} value: ${value}. Time units must be finite numbers.`,
      );
    }

    return total + (value * TIME_UNITS[unit as keyof typeof TIME_UNITS]);
  }, 0);
};
