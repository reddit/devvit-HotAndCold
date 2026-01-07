import { expect, vi } from 'vitest';
import { test } from '../test';
import { Reminders } from '../core/reminder';
import { User } from '../core/user';
import { redis, reddit } from '@devvit/web/server';
import { Empty } from '@devvit/protos/types/google/protobuf/empty.js';
import type { Metadata } from '@devvit/protos';
import { Header } from '@devvit/shared-types/Header.js';

const testUser2 = 'bob';
const testUser3 = 'carol';
const makeRedditUser = (id: string, username: string) => ({
  id,
  username,
  getSnoovatarUrl: async () => undefined,
});
const seedUserCache = async (username: string, userId?: string) => {
  const id = userId ?? `t2_${username}`;
  const cached = { id, username };
  await redis.hSet(User.UsernameToIdKey(), { [username]: id });
  await redis.set(User.Key(id), JSON.stringify(cached));
};
const metadataForUserId = (userId: string): Metadata => ({
  [Header.User]: { values: [userId] },
});
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

test('setReminderForUsername opts the current user in', async ({ username, userId }) => {
  await seedUserCache(username, userId);
  await Reminders.setReminderForUsername({ username });
  expect(await Reminders.totalReminders()).toBe(1);
});

test('isUserOptedIntoReminders returns true if opted in, false otherwise', async ({
  username,
  userId,
}) => {
  await seedUserCache(username, userId);
  await seedUserCache(testUser2);
  await Reminders.setReminderForUsername({ username });
  const isIn = await Reminders.isUserOptedIntoReminders({ username });
  expect(isIn).toBe(true);
  const isIn2 = await Reminders.isUserOptedIntoReminders({ username: testUser2 });
  expect(isIn2).toBe(false);
});

test('removeReminderForUsername opts the current user out', async ({ username, userId }) => {
  await seedUserCache(username, userId);
  await Reminders.setReminderForUsername({ username });
  await Reminders.removeReminderForUsername({ username });
  expect(await Reminders.totalReminders()).toBe(0);
  const isIn = await Reminders.isUserOptedIntoReminders({ username });
  expect(isIn).toBe(false);
});

test('getAllUsersOptedIntoReminders returns all users who opted in (order by opt-in time)', async ({
  mocks,
}) => {
  await seedUserCache('alice');
  await seedUserCache(testUser2);
  await seedUserCache(testUser3);

  await mocks.notifications.plugin.OptInCurrentUser(
    Empty.create(),
    metadataForUserId('t2_alice')
  );
  await mocks.notifications.plugin.OptInCurrentUser(Empty.create(), metadataForUserId('t2_bob'));
  await mocks.notifications.plugin.OptInCurrentUser(
    Empty.create(),
    metadataForUserId('t2_carol')
  );

  const users = await Reminders.getAllUsersOptedIntoReminders();
  expect(Array.isArray(users)).toBe(true);
  expect(users.length).toBe(3);
  expect(users).toEqual(
    ['alice', testUser2, testUser3].map((x) => ({
      username: x,
      userId: `t2_${x}`,
      score: expect.any(Number),
    }))
  );
});

test('totalReminders returns correct count', async ({ mocks }) => {
  await seedUserCache('alice');
  await seedUserCache(testUser2);
  expect(await Reminders.totalReminders()).toBe(0);

  await mocks.notifications.plugin.OptInCurrentUser(
    Empty.create(),
    metadataForUserId('t2_alice')
  );
  expect(await Reminders.totalReminders()).toBe(1);

  await mocks.notifications.plugin.OptInCurrentUser(Empty.create(), metadataForUserId('t2_bob'));
  expect(await Reminders.totalReminders()).toBe(2);
});

test('toggleReminderForUsername toggles opt-in state for the current user', async ({
  username,
  userId,
}) => {
  await seedUserCache(username, userId);
  let result = await Reminders.toggleReminderForUsername({ username });
  expect(result).toEqual({ newValue: true });
  expect(await Reminders.isUserOptedIntoReminders({ username })).toBe(true);
  result = await Reminders.toggleReminderForUsername({ username });
  expect(result).toEqual({ newValue: false });
  expect(await Reminders.isUserOptedIntoReminders({ username })).toBe(false);
});

test('rejects invalid usernames (e.g., with u/ prefix)', async () => {
  expect(() => Reminders.setReminderForUsername({ username: 'u/invalid' })).toThrowError(
    /Username must not start with the u\/ prefix/
  );
});

test('reminder opt-in removes user cache expiry and opt-out reapplies it', async () => {
  const username = 'alice';
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

test('clearCacheForNonReminderUsers removes caches for users without reminders', async ({
  mocks,
}) => {
  await redis.hSet(User.UsernameToIdKey(), {
    alice: 't2_alice',
    bob: 't2_bob',
  });
  await redis.set(User.Key('t2_alice'), JSON.stringify({ id: 't2_alice', username: 'alice' }));
  await redis.set(User.Key('t2_bob'), JSON.stringify({ id: 't2_bob', username: 'bob' }));

  // Keep bob's cache by marking bob as opted-in via the notifications mock.
  await mocks.notifications.plugin.OptInCurrentUser(Empty.create(), metadataForUserId('t2_bob'));

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
