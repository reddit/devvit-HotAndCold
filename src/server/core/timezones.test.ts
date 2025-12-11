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

test('migrates known offsets to canonical IANA zones and skips unknowns', async () => {
  // Seed legacy hash: tz:userToZone
  await redis.hSet(Timezones.UserToZoneKey(), {
    alice: 'UTC-05:00', // -> America/New_York
    bob: 'UTC+05:30', // -> Asia/Kolkata
    carol: 'UTC+01:00', // -> Europe/Paris
    dave: 'UTC-07:00', // -> America/Los_Angeles
    eve: 'UTC+09:00', // -> Asia/Tokyo
    frank: 'UTC+00:15', // unknown -> skipped
  });

  const { migrated, skipped } = await Timezones.migrateOffsetsToIana({ batchSize: 10 });
  expect(migrated).toBe(5);
  expect(skipped).toBe(1);

  const iana = await redis.hGetAll(Timezones.UserToIanaKey());
  expect(iana.alice).toBe('America/Chicago');
  expect(iana.bob).toBe('Asia/Kolkata');
  expect(iana.carol).toBe('Europe/Paris');
  expect(iana.dave).toBe('America/Los_Angeles');
  expect(iana.eve).toBe('Asia/Tokyo');
  expect(iana.frank).toBeUndefined();
});
