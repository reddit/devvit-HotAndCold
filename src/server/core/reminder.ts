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

  export const getAllUsersOptedIntoReminders = fn(z.void(), async () => {
    const all: Array<{ member: string; score: number }> = [];
    let cursor = 0;
    const limit = 1000;

    do {
      const { cursor: nextCursor, members } = await redis.zScan(
        getRemindersKey(),
        cursor,
        undefined,
        limit
      );
      for (const m of members) {
        all.push({ member: m.member, score: m.score });
      }
      cursor = nextCursor ?? 0;
    } while (cursor !== 0);

    all.sort((a, b) => a.score - b.score);
    return all;
  });

  // Batched scan by rank for large reconciliations
  export const scanUsers = fn(
    z.object({
      cursor: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(1000).default(500),
    }),
    async ({ cursor, limit }) => {
      const { cursor: nextCursor, members } = await redis.zScan(
        getRemindersKey(),
        Math.max(0, cursor),
        undefined,
        Math.max(1, limit)
      );
      const list = members.map((m) => m.member);
      return { members: list, nextCursor, done: nextCursor === 0 } as const;
    }
  );

  export const totalReminders = fn(z.void(), async () => {
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
