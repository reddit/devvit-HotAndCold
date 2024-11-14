import { number, z } from 'zod';
import { zodContext, zoddy, zodRedis, zodTransaction } from '../utils/zoddy';
import { API } from '../core/api';
import { ChallengeToWord } from './challengeToWord';
import { WordList } from './wordList';
import { ChallengeToPost } from './challengeToPost';
import { Preview } from '../components/Preview';
import { coerceValues, stringifyValues } from '../utils/utils';
import { Streaks } from './streaks';

export * as Challenge from './challenge';

export const getCurrentChallengeNumberKey = () => 'current_challenge_number' as const;

export const getChallengeKey = (challenge: number) => `challenge:${challenge}` as const;

const challengeSchema = z.object({
  word: z.string().trim().toLowerCase(),
  totalPlayers: z.number().gte(0).optional(),
  totalSolves: z.number().gte(0).optional(),
  totalGuesses: z.number().gte(0).optional(),
  totalHints: z.number().gte(0).optional(),
  totalGiveUps: z.number().gte(0).optional(),
});

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
  async ({ redis }) => {
    await redis.set(getCurrentChallengeNumberKey(), number.toString());
  }
);

export const getChallenge = zoddy(
  z.object({
    redis: zodRedis,
    challenge: z.number().gt(0),
  }),
  async ({ redis, challenge }) => {
    const result = await redis.get(getChallengeKey(challenge));

    if (!result) {
      throw new Error('No challenge found');
    }
    return challengeSchema.parse(coerceValues(JSON.parse(result)));
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

export const incrementChallengeTotalPlayers = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    challenge: z.number().gt(0),
  }),
  async ({ redis, challenge }) => {
    await redis.hIncrBy(getChallengeKey(challenge), 'totalPlayers', 1);
  }
);

export const incrementChallengeTotalSolves = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    challenge: z.number().gt(0),
  }),
  async ({ redis, challenge }) => {
    await redis.hIncrBy(getChallengeKey(challenge), 'totalSolves', 1);
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

export const incrementChallengeTotalHints = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    challenge: z.number().gt(0),
  }),
  async ({ redis, challenge }) => {
    await redis.hIncrBy(getChallengeKey(challenge), 'totalHints', 1);
  }
);

export const incrementChallengeTotalGiveUps = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    challenge: z.number().gt(0),
  }),
  async ({ redis, challenge }) => {
    await redis.hIncrBy(getChallengeKey(challenge), 'totalGiveUps', 1);
  }
);

export const makeNewChallenge = zoddy(
  z.object({
    context: zodContext,
  }),
  async ({ context }) => {
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

    // Find index of first unused word
    const unusedWordIndex = wordList.findIndex((word) => !usedWords.includes(word));

    if (unusedWordIndex === -1) {
      throw new Error('No unused words available in the word list');
    }

    const newWord = wordList[unusedWordIndex];
    const newChallengeNumber = currentChallengeNumber + 1;

    // Clean up the word list while we have the data to do so
    await WordList.setCurrentWordListWords({
      redis: context.redis,
      // Remove all words up to and including the found word
      words: wordList.slice(unusedWordIndex + 1),
    });

    // Get it once to warm the cache in our system
    await API.getWordConfig({ context, word: newWord });

    const txn = await context.redis.watch();
    await txn.multi();

    const post = await context.reddit.submitPost({
      subredditName: currentSubreddit.name,
      title: `Hot and cold #${newChallengeNumber}`,
      preview: <Preview />,
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

    await Streaks.expireStreaks({
      redis: context.redis,
      txn,
      challengeNumberBeforeTheNewestChallenge: currentChallengeNumber,
    });

    await txn.exec();
  }
);
