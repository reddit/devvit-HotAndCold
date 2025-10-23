import { z } from 'zod';
import { fn } from '../../shared/fn';
import { redis } from '@devvit/web/server';
import { zodRedditUsername } from '../utils';

export namespace JoinedSubreddit {
  export const getJoinedSubredditKey = () => `joined_subreddit` as const;

  export const setJoinedSubredditForUsername = fn(
    z.object({
      username: zodRedditUsername,
    }),
    async ({ username }) => {
      await redis.zAdd(getJoinedSubredditKey(), {
        member: username,
        score: Date.now(),
      });
    }
  );

  export const isUserJoinedSubreddit = fn(
    z.object({
      username: zodRedditUsername,
    }),
    async ({ username }) => {
      const score = await redis.zScore(getJoinedSubredditKey(), username);
      return score !== null && score !== undefined;
    }
  );

  export const removeJoinedSubredditForUsername = fn(
    z.object({
      username: zodRedditUsername,
    }),
    async ({ username }) => {
      await redis.zRem(getJoinedSubredditKey(), [username]);
    }
  );

  export const getUsersJoinedSubreddit = fn(z.void(), async () => {
    // Fetch all members by score (timestamp), in order
    const data = await redis.zRange(getJoinedSubredditKey(), 0, '+inf', {
      by: 'score',
    });
    return data;
  });

  // Batched scan by rank for large reconciliations
  export const scanUsers = fn(
    z.object({
      cursor: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(1000).default(500),
    }),
    async ({ cursor, limit }) => {
      const { cursor: nextCursor, members } = await redis.zScan(
        getJoinedSubredditKey(),
        Math.max(0, cursor),
        undefined,
        Math.max(1, limit)
      );
      const list = members.map((member) => member.member);
      return { members: list, nextCursor, done: nextCursor === 0 } as const;
    }
  );

  export const totalJoinedSubreddit = fn(z.void(), async () => {
    return await redis.zCard(getJoinedSubredditKey());
  });

  export const toggleJoinedSubredditForUsername = fn(
    z.object({
      username: zodRedditUsername,
    }),
    async ({ username }) => {
      const isJoined = await isUserJoinedSubreddit({ username });

      if (isJoined) {
        await removeJoinedSubredditForUsername({ username });
        return { newValue: false };
      } else {
        await setJoinedSubredditForUsername({ username });
        return { newValue: true };
      }
    }
  );
}
