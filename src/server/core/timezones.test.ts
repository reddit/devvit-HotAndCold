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

it('getUsersInTimezone returns all users via cursor scan', async () => {
  await Timezones.setUserTimezone({ username: user1, timezone: zoneA });
  await new Promise((r) => setTimeout(r, 2));
  await Timezones.setUserTimezone({ username: user2, timezone: zoneA });
  await new Promise((r) => setTimeout(r, 2));
  await Timezones.setUserTimezone({ username: user3, timezone: zoneA });

  let cursor = 0;
  const collected: Array<{ member: string; score: number }> = [];
  do {
    const page = await Timezones.getUsersInTimezone({ timezone: zoneA, cursor, limit: 100 });
    collected.push(...page.members);
    cursor = page.cursor;
  } while (cursor !== 0);

  expect(collected.length).toBe(3);
  // Verify scores present
  for (const u of collected) expect(u.score).toEqual(expect.any(Number));
  // Sort by recency (score DESC) and validate order
  const byRecency = collected.slice().sort((a, b) => b.score - a.score);
  expect(byRecency.map((u) => u.member)).toEqual([user3, user2, user1]);
});

// Removed sort-specific test; zScan does not guarantee ordering.

it('getUsersInTimezone supports pagination via cursor and limit', async () => {
  await Timezones.setUserTimezone({ username: user1, timezone: zoneA });
  await new Promise((r) => setTimeout(r, 2));
  await Timezones.setUserTimezone({ username: user2, timezone: zoneA });
  await new Promise((r) => setTimeout(r, 2));
  await Timezones.setUserTimezone({ username: user3, timezone: zoneA });

  const page1 = await Timezones.getUsersInTimezone({ timezone: zoneA, cursor: 0, limit: 2 });
  expect(page1.members.length).toBeGreaterThan(0);

  const page2 = await Timezones.getUsersInTimezone({
    timezone: zoneA,
    cursor: page1.cursor,
    limit: 2,
  });
  const allMembers = [...page1.members, ...page2.members].map((u) => u.member);
  expect(new Set(allMembers)).toEqual(new Set([user1, user2, user3]));
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

  // Scan zoneA
  let cursorA = 0;
  const membersA: string[] = [];
  do {
    const page = await Timezones.getUsersInTimezone({
      timezone: zoneA,
      cursor: cursorA,
      limit: 100,
    });
    membersA.push(...page.members.map((m) => m.member));
    cursorA = page.cursor;
  } while (cursorA !== 0);
  expect(membersA.sort()).toEqual([user1]);

  // Scan zoneB
  let cursorB = 0;
  const membersB: string[] = [];
  do {
    const page = await Timezones.getUsersInTimezone({
      timezone: zoneB,
      cursor: cursorB,
      limit: 100,
    });
    membersB.push(...page.members.map((m) => m.member));
    cursorB = page.cursor;
  } while (cursorB !== 0);
  expect(membersB.sort()).toEqual([user2]);

  const zone = await Timezones.getUserTimezone({ username: user2 });
  expect(zone).toBe(zoneB);
});

it('clearUserTimezone removes membership and reverse mapping', async () => {
  await Timezones.setUserTimezone({ username: user1, timezone: zoneA });
  await Timezones.setUserTimezone({ username: user2, timezone: zoneA });

  await Timezones.clearUserTimezone({ username: user2 });

  const totalA = await Timezones.totalUsersInTimezone({ timezone: zoneA });
  expect(totalA).toBe(1);

  let cursorA = 0;
  const membersA: string[] = [];
  do {
    const page = await Timezones.getUsersInTimezone({
      timezone: zoneA,
      cursor: cursorA,
      limit: 100,
    });
    membersA.push(...page.members.map((m) => m.member));
    cursorA = page.cursor;
  } while (cursorA !== 0);
  expect(membersA.sort()).toEqual([user1]);

  const zone = await Timezones.getUserTimezone({ username: user2 });
  expect(zone).toBeNull();
});
