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

  export const getUsersJoinedSubreddit = fn(z.object({}), async () => {
    // Fetch all members by score (timestamp), in order
    const data = await redis.zRange(getJoinedSubredditKey(), 0, '+inf', {
      by: 'score',
    });
    return data;
  });

  export const totalJoinedSubreddit = fn(z.object({}), async () => {
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
