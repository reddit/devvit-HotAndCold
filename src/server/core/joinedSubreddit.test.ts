import { expect } from 'vitest';
import { it, resetRedis } from '../test/devvitTest';
import { JoinedSubreddit } from './joinedSubreddit';

const testUser1 = 'alice';
const testUser2 = 'bob';
const testUser3 = 'carol';

it('setJoinedSubredditForUsername adds a user', async () => {
  await JoinedSubreddit.setJoinedSubredditForUsername({ username: testUser1 });
  // Check via totalJoinedSubreddit
  const total = await JoinedSubreddit.totalJoinedSubreddit({});
  expect(total).toBe(1);
});

it('isUserJoinedSubreddit returns true if user is joined, false otherwise', async () => {
  await JoinedSubreddit.setJoinedSubredditForUsername({ username: testUser1 });
  // Should be joined
  const isJoined = await JoinedSubreddit.isUserJoinedSubreddit({ username: testUser1 });
  expect(isJoined).toBe(true);
  // Should not be joined
  const isJoined2 = await JoinedSubreddit.isUserJoinedSubreddit({ username: testUser2 });
  expect(isJoined2).toBe(false);
});

it('removeJoinedSubredditForUsername removes a user', async () => {
  await JoinedSubreddit.setJoinedSubredditForUsername({ username: testUser1 });
  await JoinedSubreddit.removeJoinedSubredditForUsername({ username: testUser1 });
  const total = await JoinedSubreddit.totalJoinedSubreddit({});
  expect(total).toBe(0);
  const isJoined = await JoinedSubreddit.isUserJoinedSubreddit({ username: testUser1 });
  expect(isJoined).toBe(false);
});

it('getUsersJoinedSubreddit returns all users who joined (order by score)', async () => {
  await JoinedSubreddit.setJoinedSubredditForUsername({ username: testUser1 });
  await new Promise((r) => setTimeout(r, 2)); // ensure different timestamps
  await JoinedSubreddit.setJoinedSubredditForUsername({ username: testUser2 });
  await new Promise((r) => setTimeout(r, 2));
  await JoinedSubreddit.setJoinedSubredditForUsername({ username: testUser3 });
  const users = await JoinedSubreddit.getUsersJoinedSubreddit({});
  expect(Array.isArray(users)).toBe(true);
  expect(users.length).toBe(3);
  expect(users).toEqual(
    [testUser1, testUser2, testUser3].map((x) => ({
      member: x,
      score: expect.any(Number),
    }))
  );
});

it('totalJoinedSubreddit returns correct count', async () => {
  expect(await JoinedSubreddit.totalJoinedSubreddit({})).toBe(0);
  await JoinedSubreddit.setJoinedSubredditForUsername({ username: testUser1 });
  expect(await JoinedSubreddit.totalJoinedSubreddit({})).toBe(1);
  await JoinedSubreddit.setJoinedSubredditForUsername({ username: testUser2 });
  expect(await JoinedSubreddit.totalJoinedSubreddit({})).toBe(2);
});

it('toggleJoinedSubredditForUsername toggles join state', async () => {
  // Initially not joined
  let result = await JoinedSubreddit.toggleJoinedSubredditForUsername({ username: testUser1 });
  expect(result).toEqual({ newValue: true });
  expect(await JoinedSubreddit.isUserJoinedSubreddit({ username: testUser1 })).toBe(true);
  // Toggle again
  result = await JoinedSubreddit.toggleJoinedSubredditForUsername({ username: testUser1 });
  expect(result).toEqual({ newValue: false });
  expect(await JoinedSubreddit.isUserJoinedSubreddit({ username: testUser1 })).toBe(false);
});
