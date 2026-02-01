import { z } from 'zod';
import { redisNumberString } from '../utils';
import { fn } from '../../shared/fn';
import { redis, reddit, Post } from '@devvit/web/server';
import { WordQueue } from './wordQueue';
import { getWordConfigCached } from './api';

export const stringifyValues = <T extends Record<string, any>>(obj: T): Record<keyof T, string> => {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key, String(value)])
  ) as Record<keyof T, string>;
};

export namespace Challenge {
  export const CurrentChallengeNumberKey = () => 'current_challenge_number' as const;

  export const ChallengeKey = (challengeNumber: number) => `challenge:${challengeNumber}` as const;
  export const ChallengePostIdKey = (challengeNumber: number) =>
    `challenge:${challengeNumber}:postId` as const;

  const challengeSchema = z
    .object({
      challengeNumber: z.string(),
      secretWord: z.string(),
      totalPlayers: redisNumberString.optional(),
      totalSolves: redisNumberString.optional(),
      totalGuesses: redisNumberString.optional(),
      totalHints: redisNumberString.optional(),
      totalGiveUps: redisNumberString.optional(),
    })
    .strict();

  export const getCurrentChallengeNumber = fn(z.void(), async () => {
    const currentChallengeNumber = await redis.get(Challenge.CurrentChallengeNumberKey());

    if (!currentChallengeNumber) {
      // Default to 0 if not set
      return 0;
    }

    return parseInt(currentChallengeNumber);
  });

  export const incrementCurrentChallengeNumber = fn(z.void(), async () => {
    await redis.incrBy(Challenge.CurrentChallengeNumberKey(), 1);
  });

  export const setCurrentChallengeNumber = fn(
    z.object({
      number: z.number().gt(0),
    }),
    async ({ number }) => {
      await redis.set(Challenge.CurrentChallengeNumberKey(), number.toString());
    }
  );

  export const getChallenge = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      const result = await redis.hGetAll(Challenge.ChallengeKey(challengeNumber));

      if (!result) {
        throw new Error('No challenge found');
      }
      return challengeSchema.parse(result);
    }
  );

  export const setChallenge = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      config: challengeSchema,
    }),
    async ({ challengeNumber, config }) => {
      await redis.hSet(Challenge.ChallengeKey(challengeNumber), stringifyValues(config));
    }
  );

  export const setPostIdForChallenge = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      postId: z.string(),
    }),
    async ({ challengeNumber, postId }) => {
      await redis.set(ChallengePostIdKey(challengeNumber), postId);
    }
  );

  export const getPostIdForChallenge = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      const postId = await redis.get(ChallengePostIdKey(challengeNumber));
      return postId ?? null;
    }
  );

  export const initialize = fn(z.void(), async () => {
    const result = await redis.get(Challenge.CurrentChallengeNumberKey());
    if (!result) {
      await redis.set(Challenge.CurrentChallengeNumberKey(), '0');
    } else {
      console.log('Challenge key already initialized');
    }
  });

  export const incrementChallengeTotalPlayers = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      await redis.hIncrBy(Challenge.ChallengeKey(challengeNumber), 'totalPlayers', 1);
    }
  );

  export const incrementChallengeTotalSolves = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      await redis.hIncrBy(Challenge.ChallengeKey(challengeNumber), 'totalSolves', 1);
    }
  );

  export const incrementChallengeTotalGuesses = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      await redis.hIncrBy(Challenge.ChallengeKey(challengeNumber), 'totalGuesses', 1);
    }
  );

  export const incrementChallengeTotalHints = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      await redis.hIncrBy(Challenge.ChallengeKey(challengeNumber), 'totalHints', 1);
    }
  );

  export const incrementChallengeTotalGiveUps = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      await redis.hIncrBy(Challenge.ChallengeKey(challengeNumber), 'totalGiveUps', 1);
    }
  );

  export const makeNewChallenge = fn(z.void(), async () => {
    console.log('Making new challenge...');
    const [currentChallengeNumber, currentSubreddit] = await Promise.all([
      getCurrentChallengeNumber(),
      reddit.getCurrentSubreddit(),
    ]);

    console.log('Current challenge number:', currentChallengeNumber);

    const newChallengeNumber = currentChallengeNumber + 1;

    console.log('Current challenge number:', currentChallengeNumber);

    let post: Post | undefined;

    const newWord = (await WordQueue.shift())?.word;
    if (!newWord) {
      throw new Error('No more words available for new challenge. Need to add more to the list!');
    }

    try {
      // Sets the value in the redis cache for fast lookups
      await getWordConfigCached({ word: newWord });

      post = await reddit.submitCustomPost({
        subredditName: currentSubreddit.name,
        title: `Hot and cold #${newChallengeNumber}`,
        splash: {},
        postData: {
          challengeNumber: newChallengeNumber,
        },
      });

      await setChallenge({
        challengeNumber: newChallengeNumber,
        config: {
          challengeNumber: newChallengeNumber.toString(),
          secretWord: newWord,
          totalPlayers: '0',
          totalSolves: '0',
          totalGuesses: '0',
          totalHints: '0',
          totalGiveUps: '0',
        },
      });

      await setPostIdForChallenge({ challengeNumber: newChallengeNumber, postId: post.id });

      await setCurrentChallengeNumber({ number: newChallengeNumber });

      console.log(
        'New challenge created:',
        'New Challenge Number:',
        newChallengeNumber,
        'New word:',
        newWord,
        'Post ID:',
        post.id
      );

      return {
        postId: post.id,
        postUrl: post.url,
        challenge: newChallengeNumber,
      };
    } catch (error) {
      console.error('Error making new challenge:', error);

      // If the transaction fails, remove the post if created
      if (post) {
        console.log(`Removing post ${post.id} due to new challenge error`);
        await reddit.remove(post.id, false);
      }

      throw error;
    }
  });
}
