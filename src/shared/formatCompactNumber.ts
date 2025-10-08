export type FormatCompactNumberOptions = {
  decimals?: number;
  trimZeros?: boolean;
};

/**
 * Formats large numbers in a compact format..
 * Examples:
 *  - 1,234 -> "1.2K"
 *  - 12,345 -> "12.3K"
 *  - 1,234,567 -> "1.2M"
 *  - 1,234,567,890 -> "1.2B"
 *  - 1,234,567,890,123 -> "1.2T"
 */
export function formatCompactNumber(
  value: number,
  options: FormatCompactNumberOptions = {}
): string {
  if (!Number.isFinite(value)) return String(value);

  const { decimals = 1, trimZeros = true } = options;

  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs < 1000) return sign + abs.toLocaleString('en-US');

  const UNITS = [
    { threshold: 1_000, symbol: 'K' },
    { threshold: 1_000_000, symbol: 'M' },
    { threshold: 1_000_000_000, symbol: 'B' },
    { threshold: 1_000_000_000_000, symbol: 'T' },
    { threshold: 1_000_000_000_000_000, symbol: 'Q' },
  ] as const;

  let unitIndex = 0;
  for (let i = 0; i < UNITS.length; i++) {
    if (abs < UNITS[i].threshold) {
      unitIndex = i - 1;
      break;
    }
    // If we've reached the largest threshold and still larger, use the last unit
    if (i === UNITS.length - 1) unitIndex = i;
  }

  const base = UNITS[unitIndex].threshold;
  const symbol = UNITS[unitIndex].symbol;

  // Round to the desired decimals
  let compact = abs / base;
  let rounded = Number(compact.toFixed(decimals));

  // Handle rollover like 999.95K -> 1.0M
  if (rounded >= 1000 && unitIndex < UNITS.length - 1) {
    unitIndex += 1;
    compact = abs / UNITS[unitIndex].threshold;
    rounded = Number(compact.toFixed(decimals));
  }

  const formatted = trimZeros
    ? rounded.toFixed(decimals).replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, '')
    : rounded.toFixed(decimals);

  return `${sign}${formatted}${UNITS[unitIndex].symbol}`;
}
