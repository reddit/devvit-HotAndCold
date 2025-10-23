import { expect } from 'vitest';
import { it, resetRedis } from './devvitTest';
import { Reminders } from '../core/reminder';

const testUser1 = 'alice';
const testUser2 = 'bob';
const testUser3 = 'carol';

it('setReminderForUsername adds a user', async () => {
  await resetRedis();
  await Reminders.setReminderForUsername({ username: testUser1 });
  const total = await Reminders.totalReminders();
  expect(total).toBe(1);
});

it('isUserOptedIntoReminders returns true if opted in, false otherwise', async () => {
  await resetRedis();
  await Reminders.setReminderForUsername({ username: testUser1 });
  const isIn = await Reminders.isUserOptedIntoReminders({ username: testUser1 });
  expect(isIn).toBe(true);
  const isIn2 = await Reminders.isUserOptedIntoReminders({ username: testUser2 });
  expect(isIn2).toBe(false);
});

it('removeReminderForUsername removes a user', async () => {
  await resetRedis();
  await Reminders.setReminderForUsername({ username: testUser1 });
  await Reminders.removeReminderForUsername({ username: testUser1 });
  const total = await Reminders.totalReminders();
  expect(total).toBe(0);
  const isIn = await Reminders.isUserOptedIntoReminders({ username: testUser1 });
  expect(isIn).toBe(false);
});

it('getAllUsersOptedIntoReminders returns all users who opted in (order by score)', async () => {
  await resetRedis();
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

it('totalReminders returns correct count', async () => {
  await resetRedis();
  expect(await Reminders.totalReminders()).toBe(0);
  await Reminders.setReminderForUsername({ username: testUser1 });
  expect(await Reminders.totalReminders()).toBe(1);
  await Reminders.setReminderForUsername({ username: testUser2 });
  expect(await Reminders.totalReminders()).toBe(2);
});

it('toggleReminderForUsername toggles opt-in state', async () => {
  await resetRedis();
  let result = await Reminders.toggleReminderForUsername({ username: testUser1 });
  expect(result).toEqual({ newValue: true });
  expect(await Reminders.isUserOptedIntoReminders({ username: testUser1 })).toBe(true);
  result = await Reminders.toggleReminderForUsername({ username: testUser1 });
  expect(result).toEqual({ newValue: false });
  expect(await Reminders.isUserOptedIntoReminders({ username: testUser1 })).toBe(false);
});

it('rejects invalid usernames (e.g., with u/ prefix)', async () => {
  await resetRedis();
  expect(() => Reminders.setReminderForUsername({ username: 'u/invalid' })).toThrowError(
    /Username must not start with the u\/ prefix/
  );
});
