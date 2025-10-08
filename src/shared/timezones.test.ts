import { describe, it, expect } from 'vitest';
import { getOffsetMinutes, getUtcLabel } from './timezones';

// We avoid asserting specific timezone values because they vary by environment.
// Instead, we assert invariants and formatting.

describe('timezones', () => {
  it('getOffsetMinutes matches -Date#getTimezoneOffset()', () => {
    expect(getOffsetMinutes()).toBe(-new Date().getTimezoneOffset());
  });

  it('getUtcLabel formats 0 minutes as UTC+00:00', () => {
    expect(getUtcLabel(0)).toBe('UTC+00:00');
  });

  it('getUtcLabel formats positive offsets with + sign and padding', () => {
    expect(getUtcLabel(330)).toBe('UTC+05:30'); // 5h30m
    expect(getUtcLabel(90)).toBe('UTC+01:30'); // 1h30m
    expect(getUtcLabel(840)).toBe('UTC+14:00'); // 14h (extreme east)
  });

  it('getUtcLabel formats negative offsets with - sign and padding', () => {
    expect(getUtcLabel(-60)).toBe('UTC-01:00'); // 1h west
    expect(getUtcLabel(-90)).toBe('UTC-01:30'); // 1h30m west
    expect(getUtcLabel(-660)).toBe('UTC-11:00'); // 11h (extreme west)
  });
});
