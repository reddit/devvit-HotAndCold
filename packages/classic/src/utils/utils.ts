import { Devvit } from '@devvit/public-api';
import { BlocksToWebviewMessage } from '@hotandcold/classic-shared';

export const sendMessageToWebview = (context: Devvit.Context, message: BlocksToWebviewMessage) => {
  context.ui.webView.postMessage('webview', message);
};

export const stringifyValues = <T extends Record<string, any>>(obj: T): Record<keyof T, string> => {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key, String(value)])
  ) as Record<keyof T, string>;
};

export const coerceValues = <T extends Record<string, any>>(obj: T) => {
  // Common boolean string values
  const TRUE_VALUES = new Set(['true', 'yes', 'y', 'on', '1', 'enabled', 'enable', 't']);
  const FALSE_VALUES = new Set(['false', 'no', 'n', 'off', '0', 'disabled', 'disable', 'f']);

  return Object.entries(obj).reduce(
    (acc, [key, value]) => {
      // Skip if value is not a string
      if (typeof value !== 'string') {
        return { ...acc, [key]: value };
      }

      // Attempt to coerce the string value
      const coercedValue = (() => {
        const normalizedValue = value.trim().toLowerCase();

        // Enhanced boolean checking
        if (TRUE_VALUES.has(normalizedValue)) return true;
        if (FALSE_VALUES.has(normalizedValue)) return false;

        // Handle null/undefined
        if (normalizedValue === 'null') return null;
        if (normalizedValue === 'undefined') return undefined;

        // Handle numbers
        if (/^-?\d+$/.test(value)) return parseInt(value, 10);
        if (/^-?\d*\.\d+$/.test(value)) return parseFloat(value);

        // Try parsing JSON for objects/arrays
        try {
          if (
            (value.startsWith('{') && value.endsWith('}')) ||
            (value.startsWith('[') && value.endsWith(']'))
          ) {
            return JSON.parse(value);
          }
        } catch {
          // If JSON parsing fails, return original string
        }

        // Return original string if no coercion applies
        return value;
      })();

      return { ...acc, [key]: coercedValue };
    },
    {} as Record<string, any>
  );
};

export const isEmptyObject = <T extends object>(obj: T): boolean => {
  return Object.keys(obj).length === 0;
};

/**
 * Devvit throws when there is an event/function invocation that has to be ran on the
 * server. There are currently limitations of our system with using try catch (but we
 * like try catch). This function checks if the error thrown in a catch block is a
 * circuit breaker. If so, it throws immediately!
 */
export const isServerCall = (e: unknown) => {
  if (e instanceof Error && e.message === 'ServerCallRequired') {
    // console.log(`Throwing circuit breaker!`);
    throw e;
  }
};

type CustomOmit<T, K extends keyof T> = {
  [P in Exclude<keyof T, K>]: T[P];
};

export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): CustomOmit<T, K> {
  const result = { ...obj };
  keys.forEach((key) => delete result[key]);
  return result as CustomOmit<T, K>;
}
