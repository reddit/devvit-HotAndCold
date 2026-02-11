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

test('scanUsernames paginates by cursor', async () => {
  await LastPlayedAt.setLastPlayedAtForUsername({ username: testUser1 });
  await new Promise((r) => setTimeout(r, 2));
  await LastPlayedAt.setLastPlayedAtForUsername({ username: testUser2 });
  await new Promise((r) => setTimeout(r, 2));
  await LastPlayedAt.setLastPlayedAtForUsername({ username: testUser3 });

  const first = await LastPlayedAt.scanUsernames({ cursor: 0, count: 1 });
  expect(first.members.length).toBeGreaterThan(0);

  const visited = new Set(first.members);
  let cursor = first.cursor;
  for (let i = 0; i < 10 && cursor !== 0; i++) {
    const next = await LastPlayedAt.scanUsernames({ cursor, count: 1 });
    next.members.forEach((m) => visited.add(m));
    cursor = next.cursor;
  }

  expect(visited.has(testUser1)).toBe(true);
  expect(visited.has(testUser2)).toBe(true);
  expect(visited.has(testUser3)).toBe(true);
  expect(cursor).toBe(0);
});

test('totalLastPlayedUsers returns correct count', async () => {
  expect(await LastPlayedAt.totalLastPlayedUsers()).toBe(0);
  await LastPlayedAt.setLastPlayedAtForUsername({ username: testUser1 });
  expect(await LastPlayedAt.totalLastPlayedUsers()).toBe(1);
  await LastPlayedAt.setLastPlayedAtForUsername({ username: testUser2 });
  expect(await LastPlayedAt.totalLastPlayedUsers()).toBe(2);
});
