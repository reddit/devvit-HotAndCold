import { z } from 'zod';
import {
  redisNumberString,
  zodContext,
  zoddy,
  zodJobContext,
  zodRedditUsername,
  zodRedis,
  zodTransaction,
} from '@hotandcold/shared/utils/zoddy';
import { API } from '../core/api.js';
import { Preview } from '../components/Preview.js';
import { stringifyValues } from '@hotandcold/shared/utils';
import { Devvit, Post } from '@devvit/public-api';
import { WordList } from './wordList.js';
import { ChallengeToWord } from './challengeToWord.js';
import { ChallengeToPost } from './challengeToPost.js';
import { ChallengeToStatus } from './challengeToStatus.js';

export * as Challenge from './challenge.js';

export const getCurrentChallengeNumberKey = () => 'current_challenge_number' as const;

export const getChallengeKey = (challenge: number) => `challenge:${challenge}` as const;

export const challengeSchema = z
  .object({
    word: z.string().trim().toLowerCase(),
    totalPlayers: redisNumberString.optional(),
    totalGuesses: redisNumberString.optional(),
    // There are guesses that are globally unique. Used to compute the
    // % of dictionary used
    totalUniqueGuesses: redisNumberString.optional(),
    startedAtMs: redisNumberString,
    solvedAtMs: redisNumberString.optional(),
    solvingUser: zodRedditUsername.optional(),
    solvingUserSnoovatar: z.string().optional(),
  })
  .strict();

export const getCurrentChallengeNumber = zoddy(
  z.object({
    redis: zodRedis,
  }),
  async ({ redis }) => {
    const currentChallengeNumber = await redis.get(getCurrentChallengeNumberKey());

    if (!currentChallengeNumber) {
      throw new Error('No current challenge number found');
    }

    return parseInt(currentChallengeNumber);
  }
);

export const incrementCurrentChallengeNumber = zoddy(
  z.object({
    redis: zodRedis,
  }),
  async ({ redis }) => {
    await redis.incrBy(getCurrentChallengeNumberKey(), 1);
  }
);

export const setCurrentChallengeNumber = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    number: z.number().gt(0),
  }),
  async ({ redis, number }) => {
    await redis.set(getCurrentChallengeNumberKey(), number.toString());
  }
);

export const getChallenge = zoddy(
  z.object({
    redis: zodRedis,
    challenge: z.number().gt(0),
  }),
  async ({ redis, challenge }) => {
    const result = await redis.hGetAll(getChallengeKey(challenge));

    if (!result) {
      throw new Error('No challenge found');
    }
    return challengeSchema.parse(result);
  }
);

export const setChallenge = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    challenge: z.number().gt(0),
    config: challengeSchema,
  }),
  async ({ redis, challenge, config }) => {
    await redis.hSet(getChallengeKey(challenge), stringifyValues(config));
  }
);

export const markChallengeSolved = zoddy(
  challengeSchema
    .pick({ solvedAtMs: true, solvingUser: true, solvingUserSnoovatar: true })
    .required({ solvedAtMs: true, solvingUser: true })
    .extend({
      challenge: z.number(),
      redis: zodRedis,
    }),
  async ({ solvedAtMs, solvingUser, solvingUserSnoovatar, redis, challenge }) => {
    redis.hSet(
      getChallengeKey(challenge),
      stringifyValues({ solvedAtMs, solvingUser, solvingUserSnoovatar: solvingUserSnoovatar ?? '' })
    );
  }
);

export const initialize = zoddy(
  z.object({
    redis: zodRedis,
  }),
  async ({ redis }) => {
    const result = await redis.get(getCurrentChallengeNumberKey());
    if (!result) {
      await redis.set(getCurrentChallengeNumberKey(), '0');
    } else {
      console.log('Challenge key already initialized');
    }
  }
);

export const incrementChallengeTotalPlayers = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    challenge: z.number().gt(0),
  }),
  async ({ redis, challenge }) => {
    await redis.hIncrBy(getChallengeKey(challenge), 'totalPlayers', 1);
  }
);

export const incrementChallengeTotalGuesses = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    challenge: z.number().gt(0),
  }),
  async ({ redis, challenge }) => {
    await redis.hIncrBy(getChallengeKey(challenge), 'totalGuesses', 1);
  }
);

export const incrementChallengeTotalUniqueGuesses = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    challenge: z.number().gt(0),
  }),
  async ({ redis, challenge }) => {
    await redis.hIncrBy(getChallengeKey(challenge), 'totalUniqueGuesses', 1);
  }
);

export const makeNewChallenge = zoddy(
  z.object({
    context: z.union([zodJobContext, zodContext]),
  }),
  async ({ context }) => {
    console.log('Making new challenge...');
    const [wordList, usedWords, currentChallengeNumber, currentSubreddit] = await Promise.all([
      WordList.getCurrentWordList({
        redis: context.redis,
      }),
      ChallengeToWord.getAllUsedWords({
        redis: context.redis,
      }),
      getCurrentChallengeNumber({ redis: context.redis }),
      context.reddit.getCurrentSubreddit(),
    ]);

    console.log('Current challenge number:', currentChallengeNumber);

    // Find index of first unused word
    const unusedWordIndex = wordList.findIndex((word: string) => !usedWords.includes(word));

    if (unusedWordIndex === -1) {
      throw new Error('No unused words available in the word list. Please add more and try again.');
    }

    const newWord = wordList[unusedWordIndex];
    const newChallengeNumber = currentChallengeNumber + 1;

    console.log('Current challenge number:', currentChallengeNumber);

    // Get it once to warm the Devvit cache in our system
    await API.getWordConfigCached({ context, word: newWord });

    let post: Post | undefined;

    try {
      // TODO: Transactions are broken
      const txn = context.redis;
      // const txn = await context.redis.watch();
      // await txn.multi();

      // Clean up the word list while we have the data to do so
      await WordList.setCurrentWordListWords({
        redis: txn,
        // Remove all words up to and including the found word
        words: wordList.slice(unusedWordIndex + 1),
      });

      post = await context.reddit.submitPost({
        subredditName: currentSubreddit.name,
        title: `Hot and cold raid #${newChallengeNumber}`,
        preview: <Preview />,
      });

      await ChallengeToStatus.setStatusForChallenge({
        status: 'ACTIVE',
        challenge: newChallengeNumber,
        redis: txn,
      });

      await setChallenge({
        redis: txn,
        challenge: newChallengeNumber,
        config: {
          startedAtMs: Date.now().toString(),
          word: newWord,
          totalPlayers: '0',
          totalGuesses: '0',
          totalUniqueGuesses: '0',
        },
      });

      await setCurrentChallengeNumber({ number: newChallengeNumber, redis: txn });
      await ChallengeToWord.setChallengeNumberForWord({
        challenge: newChallengeNumber,
        redis: txn,
        word: newWord,
      });
      await ChallengeToPost.setChallengeNumberForPost({
        challenge: newChallengeNumber,
        postId: post.id,
        redis: txn,
      });

      // await txn.exec();

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
        await context.reddit.remove(post.id, false);
      }

      throw error;
    }
  }
);
