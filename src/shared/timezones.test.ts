import { describe, it, expect, vi, afterEach } from 'vitest';
import { getBrowserIanaTimeZone } from './timezones';

const getResolvedOptions = () => new Intl.DateTimeFormat().resolvedOptions();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getBrowserIanaTimeZone', () => {
  it('returns the mocked IANA timezone when available', () => {
    const base = getResolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => ({
      ...base,
      timeZone: 'America/New_York',
    }));

    const tz = getBrowserIanaTimeZone();
    expect(tz).toBe('America/New_York');
  });

  it('returns undefined when timeZone is empty', () => {
    const base = getResolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => ({
      ...base,
      timeZone: '',
    }));

    const tz = getBrowserIanaTimeZone();
    expect(tz).toBeUndefined();
  });

  it('returns undefined when resolvedOptions throws', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => {
      throw new Error('boom');
    });

    const tz = getBrowserIanaTimeZone();
    expect(tz).toBeUndefined();
  });

  it('does not throw in the real environment and returns string or undefined', () => {
    expect(() => getBrowserIanaTimeZone()).not.toThrow();
    const tz = getBrowserIanaTimeZone();
    if (tz !== undefined) {
      expect(typeof tz).toBe('string');
      expect(tz.length).toBeGreaterThan(0);
    }
  });
});
