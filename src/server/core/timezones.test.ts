import { expect } from 'vitest';
import { it } from '../test/devvitTest';
import { Timezones } from './timezones';

const zoneA = 'UTC+00:00';
const zoneB = 'UTC+05:30';
const user1 = 'alice';
const user2 = 'bob';
const user3 = 'carol';

it('setUserTimezone adds a user and sets reverse mapping', async () => {
  await Timezones.setUserTimezone({ username: user1, timezone: zoneA });

  const total = await Timezones.totalUsersInTimezone({ timezone: zoneA });
  expect(total).toBe(1);

  const zone = await Timezones.getUserTimezone({ username: user1 });
  expect(zone).toBe(zoneA);
});

it('idempotent setUserTimezone does not duplicate membership', async () => {
  await Timezones.setUserTimezone({ username: user1, timezone: zoneA });
  await Timezones.setUserTimezone({ username: user1, timezone: zoneA });

  const total = await Timezones.totalUsersInTimezone({ timezone: zoneA });
  expect(total).toBe(1);
});

it('getUsersInTimezone returns users sorted by recency DESC by default', async () => {
  await Timezones.setUserTimezone({ username: user1, timezone: zoneA });
  await new Promise((r) => setTimeout(r, 2));
  await Timezones.setUserTimezone({ username: user2, timezone: zoneA });
  await new Promise((r) => setTimeout(r, 2));
  await Timezones.setUserTimezone({ username: user3, timezone: zoneA });

  const users = await Timezones.getUsersInTimezone({ timezone: zoneA });

  expect(Array.isArray(users)).toBe(true);
  expect(users.length).toBe(3);

  // Most recent first: carol, bob, alice
  expect(users.map((u) => u.member)).toEqual([user3, user2, user1]);
  // Scores present
  for (const u of users) expect(u.score).toEqual(expect.any(Number));
});

it('getUsersInTimezone supports ASC sort', async () => {
  await Timezones.setUserTimezone({ username: user1, timezone: zoneA });
  await new Promise((r) => setTimeout(r, 2));
  await Timezones.setUserTimezone({ username: user2, timezone: zoneA });
  await new Promise((r) => setTimeout(r, 2));
  await Timezones.setUserTimezone({ username: user3, timezone: zoneA });

  const users = await Timezones.getUsersInTimezone({ timezone: zoneA, sort: 'ASC' });

  expect(users.map((u) => u.member)).toEqual([user1, user2, user3]);
});

it('getUsersInTimezone supports pagination by rank', async () => {
  await Timezones.setUserTimezone({ username: user1, timezone: zoneA });
  await new Promise((r) => setTimeout(r, 2));
  await Timezones.setUserTimezone({ username: user2, timezone: zoneA });
  await new Promise((r) => setTimeout(r, 2));
  await Timezones.setUserTimezone({ username: user3, timezone: zoneA });

  // Default DESC: [carol, bob, alice]
  const page1 = await Timezones.getUsersInTimezone({ timezone: zoneA, start: 0, stop: 1 });
  expect(page1.map((u) => u.member)).toEqual([user3, user2]);

  const page2 = await Timezones.getUsersInTimezone({ timezone: zoneA, start: 1, stop: 2 });
  expect(page2.map((u) => u.member)).toEqual([user2, user1]);
});

it('moving a user updates zone membership and reverse mapping', async () => {
  await Timezones.setUserTimezone({ username: user1, timezone: zoneA });
  await Timezones.setUserTimezone({ username: user2, timezone: zoneA });

  let totalA = await Timezones.totalUsersInTimezone({ timezone: zoneA });
  expect(totalA).toBe(2);

  // Move bob to zoneB
  await Timezones.setUserTimezone({ username: user2, timezone: zoneB });

  totalA = await Timezones.totalUsersInTimezone({ timezone: zoneA });
  const totalB = await Timezones.totalUsersInTimezone({ timezone: zoneB });
  expect(totalA).toBe(1);
  expect(totalB).toBe(1);

  const usersA = await Timezones.getUsersInTimezone({ timezone: zoneA, sort: 'ASC' });
  expect(usersA.map((u) => u.member)).toEqual([user1]);

  const usersB = await Timezones.getUsersInTimezone({ timezone: zoneB, sort: 'ASC' });
  expect(usersB.map((u) => u.member)).toEqual([user2]);

  const zone = await Timezones.getUserTimezone({ username: user2 });
  expect(zone).toBe(zoneB);
});

it('clearUserTimezone removes membership and reverse mapping', async () => {
  await Timezones.setUserTimezone({ username: user1, timezone: zoneA });
  await Timezones.setUserTimezone({ username: user2, timezone: zoneA });

  await Timezones.clearUserTimezone({ username: user2 });

  const totalA = await Timezones.totalUsersInTimezone({ timezone: zoneA });
  expect(totalA).toBe(1);

  const usersA = await Timezones.getUsersInTimezone({ timezone: zoneA, sort: 'ASC' });
  expect(usersA.map((u) => u.member)).toEqual([user1]);

  const zone = await Timezones.getUserTimezone({ username: user2 });
  expect(zone).toBeNull();
});
