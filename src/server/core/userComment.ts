import { z } from 'zod';
import { fn } from '../../shared/fn';
import { redis } from '@devvit/web/server';
import { zodRedditUsername } from '../utils';

export namespace UserComment {
  const keyForChallenge = (challengeNumber: number) => `comments:${challengeNumber}` as const;

  export const setUserCommentedForChallenge = fn(
    z.object({
      username: zodRedditUsername,
      challengeNumber: z.number().gt(0),
    }),
    async ({ username, challengeNumber }) => {
      await redis.zAdd(keyForChallenge(challengeNumber), {
        member: username,
        score: Date.now(),
      });
    }
  );

  export const hasUserCommentedForChallenge = fn(
    z.object({
      username: zodRedditUsername,
      challengeNumber: z.number().gt(0),
    }),
    async ({ username, challengeNumber }) => {
      const score = await redis.zScore(keyForChallenge(challengeNumber), username);
      return score !== null && score !== undefined;
    }
  );
}
