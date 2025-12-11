import { vi, expect } from 'vitest';

vi.mock('@devvit/pushnotif', () => ({
  pushnotif: {
    enqueue: vi.fn(),
    optInCurrentUser: vi.fn(),
    optOutCurrentUser: vi.fn(),
  },
}));

import { test } from '../test';
import { Notifications } from './notifications';

const { nextLocalSendTimeUtcMsIana, utcOffsetLabelAt } = Notifications.__test__;

function getLocalParts(
  timeZone: string,
  utcMs: number
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value])
  ) as Record<string, string>;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function assertLocalTimeMatches(
  zone: string,
  dueAtMs: number,
  expectedHour: number,
  expectedMinute: number
): void {
  const lp = getLocalParts(zone, dueAtMs);
  expect(lp.hour).toBe(expectedHour);
  expect(lp.minute).toBe(expectedMinute);
}

function assertSameOrNextLocalDay(
  zone: string,
  baseUtcMs: number,
  dueAtMs: number,
  before: boolean
): void {
  const now = getLocalParts(zone, baseUtcMs);
  const due = getLocalParts(zone, dueAtMs);
  const sameDay = now.year === due.year && now.month === due.month && now.day === due.day;
  if (before) {
    expect(sameDay).toBe(true);
  } else {
    // Equal or after should be next local day
    expect(sameDay).toBe(false);
  }
}

test('same day vs next day behavior in America/New_York', () => {
  vi.useFakeTimers();
  try {
    // 2025-01-01T12:00Z = 07:00 local (EST)
    const base = Date.parse('2025-01-01T12:00:00.000Z');
    vi.setSystemTime(base);
    const zone = 'America/New_York';

    // Before 09:00 local -> same day at 09:00 local (14:00Z)
    let due = nextLocalSendTimeUtcMsIana({
      baseUtcMs: base,
      timeZone: zone,
      hourLocal: 9,
      minuteLocal: 0,
    });
    expect(due).toBe(Date.parse('2025-01-01T14:00:00.000Z'));
    assertLocalTimeMatches(zone, due, 9, 0);
    assertSameOrNextLocalDay(zone, base, due, true);

    // Exactly at 09:00 local -> next day at 09:00 local
    const atNineLocal = Date.parse('2025-01-01T14:00:00.000Z');
    vi.setSystemTime(atNineLocal);
    due = nextLocalSendTimeUtcMsIana({
      baseUtcMs: atNineLocal,
      timeZone: zone,
      hourLocal: 9,
      minuteLocal: 0,
    });
    expect(due).toBe(Date.parse('2025-01-02T14:00:00.000Z'));
    assertLocalTimeMatches(zone, due, 9, 0);
    assertSameOrNextLocalDay(zone, atNineLocal, due, false);

    // After 09:00 local -> next day 09:00 local
    const tenLocal = Date.parse('2025-01-01T15:00:00.000Z');
    vi.setSystemTime(tenLocal);
    due = nextLocalSendTimeUtcMsIana({
      baseUtcMs: tenLocal,
      timeZone: zone,
      hourLocal: 9,
      minuteLocal: 0,
    });
    expect(due).toBe(Date.parse('2025-01-02T14:00:00.000Z'));
    assertLocalTimeMatches(zone, due, 9, 0);
    assertSameOrNextLocalDay(zone, tenLocal, due, false);
  } finally {
    vi.useRealTimers();
  }
});

test('handles half-hour and quarter-hour offsets', () => {
  vi.useFakeTimers();
  try {
    const base = Date.parse('2025-01-01T12:00:00.000Z');
    vi.setSystemTime(base);

    // Asia/Kolkata (+05:30)
    let zone = 'Asia/Kolkata';
    let due = nextLocalSendTimeUtcMsIana({
      baseUtcMs: base,
      timeZone: zone,
      hourLocal: 9,
      minuteLocal: 0,
    });
    expect(due).toBe(Date.parse('2025-01-02T03:30:00.000Z'));
    assertLocalTimeMatches(zone, due, 9, 0);

    // Asia/Kathmandu (+05:45)
    zone = 'Asia/Kathmandu';
    due = nextLocalSendTimeUtcMsIana({
      baseUtcMs: base,
      timeZone: zone,
      hourLocal: 9,
      minuteLocal: 0,
    });
    // At base, local ~17:45, so next day 09:00 local
    assertLocalTimeMatches(zone, due, 9, 0);
    expect(due - base).toBeGreaterThan(0);
    expect(due - base).toBeLessThan(48 * 60 * 60 * 1000);

    // Australia/Eucla (+08:45)
    zone = 'Australia/Eucla';
    due = nextLocalSendTimeUtcMsIana({
      baseUtcMs: base,
      timeZone: zone,
      hourLocal: 9,
      minuteLocal: 0,
    });
    assertLocalTimeMatches(zone, due, 9, 0);
  } finally {
    vi.useRealTimers();
  }
});

test('respects DST spring forward and fall back in America/New_York', () => {
  vi.useFakeTimers();
  try {
    const zone = 'America/New_York';

    // Spring forward 2025-03-09: 12:00Z should be 08:00 local (EDT)
    const baseSpring = Date.parse('2025-03-09T12:00:00.000Z');
    vi.setSystemTime(baseSpring);
    let due = nextLocalSendTimeUtcMsIana({
      baseUtcMs: baseSpring,
      timeZone: zone,
      hourLocal: 9,
      minuteLocal: 0,
    });
    expect(due).toBe(Date.parse('2025-03-09T13:00:00.000Z'));
    assertLocalTimeMatches(zone, due, 9, 0);

    // Fall back 2025-11-02: 12:00Z should be 07:00 local (EST)
    const baseFall = Date.parse('2025-11-02T12:00:00.000Z');
    vi.setSystemTime(baseFall);
    due = nextLocalSendTimeUtcMsIana({
      baseUtcMs: baseFall,
      timeZone: zone,
      hourLocal: 9,
      minuteLocal: 0,
    });
    expect(due).toBe(Date.parse('2025-11-02T14:00:00.000Z'));
    assertLocalTimeMatches(zone, due, 9, 0);
  } finally {
    vi.useRealTimers();
  }
});

test('rolls over at month/year boundaries correctly', () => {
  vi.useFakeTimers();
  try {
    // Pacific/Kiritimati is UTC+14, very far ahead
    const zone = 'Pacific/Kiritimati';
    const base = Date.parse('2025-01-31T22:30:00.000Z');
    vi.setSystemTime(base);

    const due = nextLocalSendTimeUtcMsIana({
      baseUtcMs: base,
      timeZone: zone,
      hourLocal: 9,
      minuteLocal: 0,
    });
    assertLocalTimeMatches(zone, due, 9, 0);
    // Should be within two days and not before base
    expect(due - base).toBeGreaterThan(0);
    expect(due - base).toBeLessThan(48 * 60 * 60 * 1000);
  } finally {
    vi.useRealTimers();
  }
});

test('offset label is computed at due time', () => {
  vi.useFakeTimers();
  try {
    const zone = 'America/New_York';
    const base = Date.parse('2025-01-01T12:00:00.000Z');
    vi.setSystemTime(base);
    const due = nextLocalSendTimeUtcMsIana({
      baseUtcMs: base,
      timeZone: zone,
      hourLocal: 9,
      minuteLocal: 0,
    });
    const label = utcOffsetLabelAt(zone, due);
    expect(/^UTC[+-]\d{2}:\d{2}$/.test(label)).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
