import { describe, it, expect } from 'vitest';
import { formatCompactNumber } from './formatCompactNumber';

describe('formatCompactNumber', () => {
  it('formats small numbers with commas', () => {
    expect(formatCompactNumber(0)).toBe('0');
    expect(formatCompactNumber(12)).toBe('12');
    expect(formatCompactNumber(999)).toBe('999');
  });

  it('formats thousands as K', () => {
    expect(formatCompactNumber(1000)).toBe('1K');
    expect(formatCompactNumber(1234)).toBe('1.2K');
    expect(formatCompactNumber(12_345)).toBe('12.3K');
    expect(formatCompactNumber(999_949)).toBe('999.9K');
  });

  it('rolls over to M at 1,000K', () => {
    expect(formatCompactNumber(999_950)).toBe('1M');
    expect(formatCompactNumber(1_000_000)).toBe('1M');
    expect(formatCompactNumber(1_234_567)).toBe('1.2M');
  });

  it('formats billions and trillions', () => {
    expect(formatCompactNumber(1_234_567_890)).toBe('1.2B');
    expect(formatCompactNumber(1_234_567_890_123)).toBe('1.2T');
  });

  it('handles negatives', () => {
    expect(formatCompactNumber(-1_234)).toBe('-1.2K');
    expect(formatCompactNumber(-12_345_678)).toBe('-12.3M');
  });

  it('respects decimals option', () => {
    expect(formatCompactNumber(1_234_567, { decimals: 2 })).toBe('1.23M');
  });

  it('keeps trailing zeros when trimZeros is false', () => {
    expect(formatCompactNumber(1_000, { decimals: 2, trimZeros: false })).toBe('1.00K');
  });
});
