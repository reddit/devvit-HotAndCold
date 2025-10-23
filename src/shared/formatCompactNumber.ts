export type FormatCompactNumberOptions = {
  decimals?: number;
  trimZeros?: boolean;
};

function trimDecimalZeros(str: string): string {
  if (str.indexOf('.') === -1) return str;
  let s = str;
  while (s.endsWith('0')) s = s.slice(0, -1);
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

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

  let unit: (typeof UNITS)[number] = UNITS[0];
  let nextUnit: (typeof UNITS)[number] | undefined;
  for (const candidate of UNITS) {
    if (abs < candidate.threshold) {
      nextUnit = candidate;
      break;
    }
    unit = candidate;
  }

  const base = unit.threshold;

  // Round to the desired decimals
  let compact = abs / base;
  let rounded = Number(compact.toFixed(decimals));

  // Handle rollover like 999.95K -> 1.0M
  if (rounded >= 1000 && nextUnit) {
    unit = nextUnit;
    compact = abs / unit.threshold;
    rounded = Number(compact.toFixed(decimals));
  }

  const withDecimals = rounded.toFixed(decimals);
  const formatted = trimZeros ? trimDecimalZeros(withDecimals) : withDecimals;

  return `${sign}${formatted}${unit.symbol}`;
}
