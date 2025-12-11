import { expect } from 'vitest';
import { test } from '../test';
import { LastPlayedAt } from './lastPlayedAt';

const testUser1 = 'alice';
const testUser2 = 'bob';
const testUser3 = 'carol';

test('setLastPlayedAtForUsername adds or updates a user', async () => {
  await LastPlayedAt.setLastPlayedAtForUsername({ username: testUser1 });
  const total = await LastPlayedAt.totalLastPlayedUsers();
  expect(total).toBe(1);
});

test('getLastPlayedAtMsForUsername returns timestamp for existing user, null otherwise', async () => {
  await LastPlayedAt.setLastPlayedAtForUsername({ username: testUser1 });
  const ts = await LastPlayedAt.getLastPlayedAtMsForUsername({ username: testUser1 });
  expect(typeof ts === 'number' && ts > 0).toBe(true);
  const tsMissing = await LastPlayedAt.getLastPlayedAtMsForUsername({ username: testUser2 });
  expect(tsMissing).toBeNull();
});

test('getUsersLastPlayedAt returns all users in score order', async () => {
  await LastPlayedAt.setLastPlayedAtForUsername({ username: testUser1 });
  await new Promise((r) => setTimeout(r, 2));
  await LastPlayedAt.setLastPlayedAtForUsername({ username: testUser2 });
  await new Promise((r) => setTimeout(r, 2));
  await LastPlayedAt.setLastPlayedAtForUsername({ username: testUser3 });
  const users = await LastPlayedAt.getUsersLastPlayedAt();
  expect(Array.isArray(users)).toBe(true);
  expect(users.length).toBe(3);
  expect(users).toEqual(
    [testUser1, testUser2, testUser3].map((x) => ({ member: x, score: expect.any(Number) }))
  );
});

test('totalLastPlayedUsers returns correct count', async () => {
  expect(await LastPlayedAt.totalLastPlayedUsers()).toBe(0);
  await LastPlayedAt.setLastPlayedAtForUsername({ username: testUser1 });
  expect(await LastPlayedAt.totalLastPlayedUsers()).toBe(1);
  await LastPlayedAt.setLastPlayedAtForUsername({ username: testUser2 });
  expect(await LastPlayedAt.totalLastPlayedUsers()).toBe(2);
});
