import { expect } from 'vitest';
import { it, resetRedis, shutdown } from './devvitTest';
import { Reminders } from '../core/reminder';

it('sets and checks reminder opt-in', async () => {
  await resetRedis();

  await Reminders.setReminderForUsername({ username: 'alice' });
  const isIn = await Reminders.isUserOptedIntoReminders({ username: 'alice' });
  expect(isIn).toBe(true);
});

it('removes reminder opt-in', async () => {
  await resetRedis();

  await Reminders.setReminderForUsername({ username: 'bob' });
  let isIn = await Reminders.isUserOptedIntoReminders({ username: 'bob' });
  expect(isIn).toBe(true);

  await Reminders.removeReminderForUsername({ username: 'bob' });
  isIn = await Reminders.isUserOptedIntoReminders({ username: 'bob' });
  expect(isIn).toBe(false);
});

it('toggles reminder opt-in state', async () => {
  await resetRedis();

  const t1 = await Reminders.toggleReminderForUsername({ username: 'carol' });
  expect(t1.newValue).toBe(true);
  expect(await Reminders.isUserOptedIntoReminders({ username: 'carol' })).toBe(true);

  const t2 = await Reminders.toggleReminderForUsername({ username: 'carol' });
  expect(t2.newValue).toBe(false);
  expect(await Reminders.isUserOptedIntoReminders({ username: 'carol' })).toBe(false);
});

it('lists opted-in users and returns correct total count', async () => {
  await resetRedis();

  await Reminders.setReminderForUsername({ username: 'dave' });
  await Reminders.setReminderForUsername({ username: 'erin' });

  const users = await Reminders.getUsersOptedIntoReminders({});
  expect(users.sort()).toEqual(['dave', 'erin']);

  const total = await Reminders.totalReminders({});
  expect(total).toBe(2);
});

it('rejects invalid usernames (e.g., with u/ prefix)', async () => {
  await resetRedis();

  expect(() => Reminders.setReminderForUsername({ username: 'u/invalid' })).toThrowError(
    /Username must not start with the u\/ prefix/
  );
});

// Ensure Redis shuts down after test suite completes (when run directly)
it('shutdown redis (noop test)', async () => {
  await shutdown();
});
