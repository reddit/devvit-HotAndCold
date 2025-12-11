import { expect, vi } from 'vitest';
import { test } from '../test';
import { Reminders } from '../core/reminder';
import { User } from '../core/user';
import { redis, reddit } from '@devvit/web/server';
import { notifications } from '@devvit/notifications';

// Mock notifications to avoid internal failures in tests
vi.spyOn(notifications, 'optInCurrentUser').mockResolvedValue();
vi.spyOn(notifications, 'optOutCurrentUser').mockResolvedValue();

const testUser1 = 'alice';
const testUser2 = 'bob';
const testUser3 = 'carol';
const makeRedditUser = (id: string, username: string) => ({
  id,
  username,
  getSnoovatarUrl: async () => undefined,
});
const seedUserCache = async (username: string) => {
  const id = `t2_${username}`;
  const cached = { id, username };
  await redis.hSet(User.UsernameToIdKey(), { [username]: id });
  await redis.set(User.Key(id), JSON.stringify(cached));
};
const makeCleanupRunResult = (
  overrides: Partial<Reminders.CleanupRunResult> = {}
): Reminders.CleanupRunResult => ({
  cleared: 0,
  examined: 0,
  iterations: 0,
  estimatedBytes: 0,
  estimatedMegabytes: 0,
  durationMs: 0,
  lastCursor: 0,
  done: false,
  ...overrides,
});

test('setReminderForUsername adds a user', async () => {
  await seedUserCache(testUser1);
  await Reminders.setReminderForUsername({ username: testUser1 });
  const total = await Reminders.totalReminders();
  expect(total).toBe(1);
});

test('isUserOptedIntoReminders returns true if opted in, false otherwise', async () => {
  await seedUserCache(testUser1);
  await Reminders.setReminderForUsername({ username: testUser1 });
  const isIn = await Reminders.isUserOptedIntoReminders({ username: testUser1 });
  expect(isIn).toBe(true);
  const isIn2 = await Reminders.isUserOptedIntoReminders({ username: testUser2 });
  expect(isIn2).toBe(false);
});

test('removeReminderForUsername removes a user', async () => {
  await seedUserCache(testUser1);
  await Reminders.setReminderForUsername({ username: testUser1 });
  await Reminders.removeReminderForUsername({ username: testUser1 });
  const total = await Reminders.totalReminders();
  expect(total).toBe(0);
  const isIn = await Reminders.isUserOptedIntoReminders({ username: testUser1 });
  expect(isIn).toBe(false);
});

test('getAllUsersOptedIntoReminders returns all users who opted in (order by score)', async () => {
  await seedUserCache(testUser1);
  await seedUserCache(testUser2);
  await seedUserCache(testUser3);
  await Reminders.setReminderForUsername({ username: testUser1 });
  await new Promise((r) => setTimeout(r, 2));
  await Reminders.setReminderForUsername({ username: testUser2 });
  await new Promise((r) => setTimeout(r, 2));
  await Reminders.setReminderForUsername({ username: testUser3 });
  const users = await Reminders.getAllUsersOptedIntoReminders();
  expect(Array.isArray(users)).toBe(true);
  expect(users.length).toBe(3);
  expect(users).toEqual(
    [testUser1, testUser2, testUser3].map((x) => ({
      member: x,
      score: expect.any(Number),
    }))
  );
});

test('totalReminders returns correct count', async () => {
  await seedUserCache(testUser1);
  await seedUserCache(testUser2);
  expect(await Reminders.totalReminders()).toBe(0);
  await Reminders.setReminderForUsername({ username: testUser1 });
  expect(await Reminders.totalReminders()).toBe(1);
  await Reminders.setReminderForUsername({ username: testUser2 });
  expect(await Reminders.totalReminders()).toBe(2);
});

test('toggleReminderForUsername toggles opt-in state', async () => {
  await seedUserCache(testUser1);
  let result = await Reminders.toggleReminderForUsername({ username: testUser1 });
  expect(result).toEqual({ newValue: true });
  expect(await Reminders.isUserOptedIntoReminders({ username: testUser1 })).toBe(true);
  result = await Reminders.toggleReminderForUsername({ username: testUser1 });
  expect(result).toEqual({ newValue: false });
  expect(await Reminders.isUserOptedIntoReminders({ username: testUser1 })).toBe(false);
});

test('rejects invalid usernames (e.g., with u/ prefix)', async () => {
  expect(() => Reminders.setReminderForUsername({ username: 'u/invalid' })).toThrowError(
    /Username must not start with the u\/ prefix/
  );
});

test('reminder opt-in removes user cache expiry and opt-out reapplies it', async () => {
  const username = testUser1;
  const id = 't2_' + username;
  const spy = vi
    .spyOn(reddit, 'getUserByUsername')
    .mockResolvedValue(makeRedditUser(id, username) as any);
  try {
    await User.getByUsername(username);
  } finally {
    spy.mockRestore();
  }

  let expireTime = await redis.expireTime(User.Key(id));
  expect(expireTime).toBeGreaterThan(0);

  await Reminders.setReminderForUsername({ username });
  expireTime = await redis.expireTime(User.Key(id));
  expect(expireTime).toBe(-1);

  await Reminders.removeReminderForUsername({ username });
  expireTime = await redis.expireTime(User.Key(id));
  const ttlRemaining = expireTime - Math.floor(Date.now() / 1000);
  expect(ttlRemaining).toBeGreaterThanOrEqual(User.CacheTtlSeconds - 30);
  expect(ttlRemaining).toBeLessThanOrEqual(User.CacheTtlSeconds + 1);
});

test('clearCacheForNonReminderUsers removes caches for users without reminders', async () => {
  await redis.hSet(User.UsernameToIdKey(), {
    alice: 't2_alice',
    bob: 't2_bob',
  });
  await redis.set(User.Key('t2_alice'), JSON.stringify({ id: 't2_alice', username: 'alice' }));
  await redis.set(User.Key('t2_bob'), JSON.stringify({ id: 't2_bob', username: 'bob' }));
  await redis.zAdd(Reminders.getRemindersKey(), {
    member: 'bob',
    score: Date.now(),
  });

  const result = await Reminders.clearCacheForNonReminderUsers({
    startAt: 0,
    totalIterations: 1,
    count: 10,
  });

  expect(result.cleared).toBe(1);
  expect(await redis.get(User.Key('t2_alice'))).toBeUndefined();
  expect(await redis.get(User.Key('t2_bob'))).toEqual(
    JSON.stringify({ id: 't2_bob', username: 'bob' })
  );
});

test('cleanup cancel flag can be toggled via redis key', async () => {
  expect(await Reminders.isCleanupJobCancelled()).toBe(false);
  await Reminders.setCleanupJobCancelled(true);
  expect(await Reminders.isCleanupJobCancelled()).toBe(true);
  await Reminders.setCleanupJobCancelled(false);
  expect(await Reminders.isCleanupJobCancelled()).toBe(false);
});

test('recordCleanupRun aggregates stats across runs', async () => {
  const first = await Reminders.recordCleanupRun(
    makeCleanupRunResult({
      cleared: 2,
      examined: 10,
      estimatedBytes: 2048,
      durationMs: 500,
      lastCursor: 123,
    })
  );
  expect(first.totalCleared).toBe(2);
  expect(first.totalExamined).toBe(10);
  expect(first.totalMegabytes).toBeCloseTo(2048 / (1024 * 1024));

  const second = await Reminders.recordCleanupRun(
    makeCleanupRunResult({
      cleared: 3,
      examined: 5,
      estimatedBytes: 1024,
      durationMs: 250,
      lastCursor: 0,
      done: true,
    })
  );
  expect(second.totalCleared).toBe(5);
  expect(second.totalExamined).toBe(15);
  expect(second.totalMegabytes).toBeCloseTo((2048 + 1024) / (1024 * 1024));
  expect(second.done).toBe(true);
  expect(second.runs).toBe(2);
});
