import { z } from 'zod';
import { fn } from '../../shared/fn';
import { redis } from '@devvit/web/server';
import { zodRedditUsername } from '../utils';

export namespace LastPlayedAt {
  export const getLastPlayedAtKey = () => `last_played_at` as const;

  export const setLastPlayedAtForUsername = fn(
    z.object({
      username: zodRedditUsername,
    }),
    async ({ username }) => {
      await redis.zAdd(getLastPlayedAtKey(), {
        member: username,
        score: Date.now(),
      });
    }
  );

  export const getLastPlayedAtMsForUsername = fn(
    z.object({
      username: zodRedditUsername,
    }),
    async ({ username }) => {
      const score = await redis.zScore(getLastPlayedAtKey(), username);
      return score ?? null;
    }
  );

  export const getUsersLastPlayedAt = fn(z.void(), async () => {
    const data = await redis.zRange(getLastPlayedAtKey(), 0, '+inf', {
      by: 'score',
    });
    return data;
  });

  export const totalLastPlayedUsers = fn(z.void(), async () => {
    return await redis.zCard(getLastPlayedAtKey());
  });
}
