import { expect } from 'vitest';
import { test } from '../test';
import { Timezones } from './timezones';
import { redis } from '@devvit/web/server';

const user1 = 'alice';
const user2 = 'bob';
const user3 = 'carol';
const zoneA = 'America/New_York';
const zoneB = 'Asia/Kolkata';

test('setUserTimezone saves IANA and getUserTimezone returns it', async () => {
  await Timezones.setUserTimezone({ username: user1, timezone: zoneA });
  const tz = await Timezones.getUserTimezone({ username: user1 });
  expect(tz).toBe(zoneA);
});

test('idempotent setUserTimezone overwrites to the same value without error', async () => {
  await Timezones.setUserTimezone({ username: user1, timezone: zoneA });
  await Timezones.setUserTimezone({ username: user1, timezone: zoneA });
  const tz = await Timezones.getUserTimezone({ username: user1 });
  expect(tz).toBe(zoneA);
});

test('moving a user updates IANA mapping', async () => {
  await Timezones.setUserTimezone({ username: user2, timezone: zoneA });
  let tz = await Timezones.getUserTimezone({ username: user2 });
  expect(tz).toBe(zoneA);
  await Timezones.setUserTimezone({ username: user2, timezone: zoneB });
  tz = await Timezones.getUserTimezone({ username: user2 });
  expect(tz).toBe(zoneB);
});

test('clearUserTimezone removes IANA mapping', async () => {
  await Timezones.setUserTimezone({ username: user3, timezone: zoneA });
  await Timezones.clearUserTimezone({ username: user3 });
  const tz = await Timezones.getUserTimezone({ username: user3 });
  expect(tz).toBeNull();
});

test('getUserTimezones drops invalid stored zones', async () => {
  await redis.hSet(Timezones.UserToIanaKey(), {
    alice: 'Etc/Unknown',
    bob: 'America/New_York',
  });

  const tzMap = await Timezones.getUserTimezones({ usernames: ['alice', 'bob'] });
  expect(tzMap.alice).toBeNull();
  expect(tzMap.bob).toBe('America/New_York');
});
