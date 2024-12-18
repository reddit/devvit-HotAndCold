import { WebviewToBlocksMessage } from "./shared";
import { ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sendMessageToDevvit(event: WebviewToBlocksMessage) {
  window.parent?.postMessage(event, "*");
}

/**
 * Formats a duration between two dates into a pretty string format (e.g., "4h 3m 22s")
 * @param start - Start date
 * @param end - End date
 * @returns Formatted duration string
 */
export function getPrettyDuration(start: Date, end: Date): string {
  // Calculate the difference in milliseconds
  const diffMs = end.getTime() - start.getTime();

  // Convert to seconds
  let seconds = Math.floor(diffMs / 1000);

  // Calculate hours, minutes, and remaining seconds
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  // Build the duration string
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }

  if (seconds > 0 || (hours === 0 && minutes === 0)) {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ");
}

type FormatOptions = {
  /** Maximum number of decimal places to show */
  maxDecimals?: number;
  /** Show decimals even for whole numbers */
  alwaysShowDecimals?: boolean;
  /** Minimum value to start formatting (numbers below this will be shown as is) */
  minValue?: number;
};

const DEFAULT_OPTIONS: FormatOptions = {
  maxDecimals: 1,
  alwaysShowDecimals: false,
  minValue: 1000,
};

/**
 * Formats a number in social media style (e.g., 1k, 1.2M)
 * @param number The number to format
 * @param options Formatting options
 * @returns Formatted string
 *
 * @example
 * prettyNumber(1234)      // "1.2k"
 * prettyNumber(12345)     // "12.3k"
 * prettyNumber(123456)    // "123.4k"
 * prettyNumber(1234567)   // "1.2m"
 * prettyNumber(12345678)  // "12.3m"
 * prettyNumber(123456789) // "123.4m"
 * prettyNumber(1234567890) // "1.2b"
 */
export function prettyNumber(
  number: number,
  options: FormatOptions = {},
): string {
  // Merge default options
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Handle negative numbers
  const isNegative = number < 0;
  const absNumber = Math.abs(number);

  // If number is smaller than minValue, return as is
  if (absNumber < opts.minValue!) {
    return isNegative ? `-${absNumber}` : absNumber.toString();
  }

  // Define the suffixes and their corresponding divisors
  const units = [
    { suffix: "", divisor: 1 },
    { suffix: "k", divisor: 1000 },
    { suffix: "m", divisor: 1000000 },
    { suffix: "b", divisor: 1000000000 },
    { suffix: "t", divisor: 1000000000000 },
  ];

  // Find the appropriate unit
  let unitIndex = 0;
  for (let i = units.length - 1; i >= 0; i--) {
    if (absNumber >= units[i].divisor) {
      unitIndex = i;
      break;
    }
  }

  const { suffix, divisor } = units[unitIndex];
  const value = absNumber / divisor;

  // Format the number
  let formatted: string;
  if (suffix === "") {
    // No suffix, just return the whole number
    formatted = value.toString();
  } else {
    // Calculate how many decimal places we need
    const decimalPlaces = (() => {
      if (!opts.alwaysShowDecimals && value % 1 === 0) {
        return 0;
      }
      // For numbers like 999.99, show fewer decimals
      if (value >= 100) {
        return 0;
      }
      return Math.min(opts.maxDecimals!, 1);
    })();

    formatted = value.toFixed(decimalPlaces);

    // Remove trailing zeros after decimal point
    if (decimalPlaces > 0) {
      formatted = formatted.replace(/\.?0+$/, "");
    }
  }

  // Add the suffix and handle negative numbers
  return `${isNegative ? "-" : ""}${formatted}${suffix}`;
}
