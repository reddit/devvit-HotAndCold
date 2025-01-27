import { z } from 'zod';
import { zoddy, zodRedditUsername, zodRedis, zodTransaction } from '@hotandcold/shared/utils/zoddy';

export * as Reminders from './reminders.js';

// Original to make it super explicit since we might let people play the archive on any postId
export const getRemindersKey = () => `reminders` as const;

export const setReminderForUsername = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    username: zodRedditUsername,
  }),
  async ({ redis, username }) => {
    await redis.zAdd(getRemindersKey(), {
      member: username,
      score: 1,
    });
  }
);

export const isUserOptedIntoReminders = zoddy(
  z.object({
    redis: zodRedis,
    username: zodRedditUsername,
  }),
  async ({ redis, username }) => {
    const score = await redis.zScore(getRemindersKey(), username);

    return score === 1;
  }
);

export const removeReminderForUsername = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    username: zodRedditUsername,
  }),
  async ({ redis, username }) => {
    await redis.zRem(getRemindersKey(), [username]);
  }
);

export const getUsersOptedIntoReminders = zoddy(
  z.object({
    redis: zodRedis,
  }),
  async ({ redis }) => {
    const data = await redis.zRange(getRemindersKey(), 1, 1, {
      by: 'score',
    });

    return data.map((item) => item.member);
  }
);

export const totalReminders = zoddy(
  z.object({
    redis: zodRedis,
  }),
  async ({ redis }) => {
    return await redis.zCard(getRemindersKey());
  }
);

export const toggleReminderForUsername = zoddy(
  z.object({
    redis: zodRedis,
    username: zodRedditUsername,
  }),
  async ({ redis, username }) => {
    const isOptedIn = await isUserOptedIntoReminders({ redis, username });

    if (isOptedIn) {
      await removeReminderForUsername({ redis, username });
      return { newValue: false };
    } else {
      await setReminderForUsername({ redis, username });
      return { newValue: true };
    }
  }
);
