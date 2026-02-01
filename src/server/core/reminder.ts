import { z } from 'zod';
import { fn } from '../../shared/fn';
import { redis } from '@devvit/web/server';
import { zodRedditUsername } from '../utils';

export namespace Reminders {
  // Original to make it super explicit since we might let people play the archive on any postId
  export const getRemindersKey = () => `reminders` as const;

  export const setReminderForUsername = fn(
    z.object({
      username: zodRedditUsername,
    }),
    async ({ username }) => {
      await redis.zAdd(getRemindersKey(), {
        member: username,
        score: Date.now(),
      });
    }
  );

  export const isUserOptedIntoReminders = fn(
    z.object({
      username: zodRedditUsername,
    }),
    async ({ username }) => {
      const score = await redis.zScore(getRemindersKey(), username);
      return score !== null && score !== undefined;
    }
  );

  export const removeReminderForUsername = fn(
    z.object({
      username: zodRedditUsername,
    }),
    async ({ username }) => {
      await redis.zRem(getRemindersKey(), [username]);
    }
  );

  export const getUsersOptedIntoReminders = fn(z.object({}), async () => {
    const data = await redis.zRange(getRemindersKey(), 0, '+inf', {
      by: 'score',
    });
    return data;
  });

  export const totalReminders = fn(z.object({}), async () => {
    return await redis.zCard(getRemindersKey());
  });

  export const toggleReminderForUsername = fn(
    z.object({
      username: zodRedditUsername,
    }),
    async ({ username }) => {
      const isOptedIn = await isUserOptedIntoReminders({ username });

      if (isOptedIn) {
        await removeReminderForUsername({ username });
        return { newValue: false };
      } else {
        await setReminderForUsername({ username });
        return { newValue: true };
      }
    }
  );
}
