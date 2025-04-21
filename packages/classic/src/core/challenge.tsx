import { z } from 'zod';
import { API } from '../core/api.js';
import { ChallengeToWord } from './challengeToWord.js';
import { WordListService } from './wordList.js';
import { ChallengeToPost } from './challengeToPost.js';
import { Preview } from '../components/Preview.js';
import { stringifyValues } from '@hotandcold/shared/utils';
import {
  redisNumberString,
  zodContext,
  zoddy,
  zodJobContext,
  zodRedis,
  zodTransaction,
} from '@hotandcold/shared/utils/zoddy';

import { Streaks } from './streaks.js';
import { Post, RichTextBuilder } from '@devvit/public-api';

export * as Challenge from './challenge.js';

// Define base Zod schemas
const zodAppContext = z.union([zodContext, zodJobContext]); // Combined context types

// Infer types from Zod schemas
type RedisClientType = z.infer<typeof zodRedis>;
type RedisOrTransactionClientType = z.infer<typeof zodRedis> | z.infer<typeof zodTransaction>;

// Define challenge schema
const challengeSchema = z
  .object({
    word: z.string().trim().toLowerCase(),
    winnersCircleCommentId: z.string().optional(),
    totalPlayers: redisNumberString.optional(),
    totalSolves: redisNumberString.optional(),
    totalGuesses: redisNumberString.optional(),
    totalHints: redisNumberString.optional(),
    totalGiveUps: redisNumberString.optional(),
  })
  .strict();

export class ChallengeService {
  private redis: RedisOrTransactionClientType;

  constructor(redis: RedisOrTransactionClientType) {
    this.redis = redis;
  }

  // --- Static Key Generators ---
  static getCurrentChallengeNumberKey(): string {
    return 'current_challenge_number';
  }

  static getChallengeKey(challenge: number): string {
    return `challenge:${challenge}`;
  }

  // --- Instance Methods ---

  async getCurrentChallengeNumber(): Promise<number> {
    const redisClient = this.redis as RedisClientType;
    const currentChallengeNumber = await redisClient.get(
      ChallengeService.getCurrentChallengeNumberKey()
    );

    if (!currentChallengeNumber) {
      throw new Error('No current challenge number found');
    }

    return parseInt(currentChallengeNumber);
  }

  incrementCurrentChallengeNumber = zoddy(z.object({}), async () => {
    const redisClient = this.redis as RedisClientType;
    await redisClient.incrBy(ChallengeService.getCurrentChallengeNumberKey(), 1);
  });

  setCurrentChallengeNumber = zoddy(
    z.object({
      number: z.number().gt(0),
    }),
    async ({ number }) => {
      // Uses this.redis which can be transaction or regular
      await this.redis.set(ChallengeService.getCurrentChallengeNumberKey(), number.toString());
    }
  );

  getChallenge = zoddy(
    z.object({
      challenge: z.number().gt(0),
    }),
    async ({ challenge }) => {
      const redisClient = this.redis as RedisClientType;
      const result = await redisClient.hGetAll(ChallengeService.getChallengeKey(challenge));

      if (!result || Object.keys(result).length === 0) {
        throw new Error('No challenge found');
      }
      return challengeSchema.parse(result);
    }
  );

  setChallenge = zoddy(
    z.object({
      challenge: z.number().gt(0),
      config: challengeSchema,
    }),
    async ({ challenge, config }) => {
      // Uses this.redis which can be transaction or regular
      await this.redis.hSet(ChallengeService.getChallengeKey(challenge), stringifyValues(config));
    }
  );

  initialize = zoddy(z.object({}), async () => {
    const redisClient = this.redis as RedisClientType;
    const key = ChallengeService.getCurrentChallengeNumberKey();
    const result = await redisClient.get(key);
    if (!result) {
      await redisClient.set(key, '0');
    } else {
      console.log('Challenge key already initialized');
    }
  });

  // Generic incrementer function
  private incrementChallengeField = zoddy(
    z.object({
      challenge: z.number().int().gt(0),
      field: z.enum(['totalPlayers', 'totalSolves', 'totalGuesses', 'totalHints', 'totalGiveUps']),
      amount: z.number().int().default(1),
    }),
    async ({ challenge, field, amount }) => {
      // Uses this.redis which can be transaction or regular
      await this.redis.hIncrBy(ChallengeService.getChallengeKey(challenge), field, amount);
    }
  );

  // Public incrementers using the private helper
  incrementChallengeTotalPlayers = (params: { challenge: number }) =>
    this.incrementChallengeField({ ...params, field: 'totalPlayers' });
  incrementChallengeTotalSolves = (params: { challenge: number }) =>
    this.incrementChallengeField({ ...params, field: 'totalSolves' });
  incrementChallengeTotalGuesses = (params: { challenge: number }) =>
    this.incrementChallengeField({ ...params, field: 'totalGuesses' });
  incrementChallengeTotalHints = (params: { challenge: number }) =>
    this.incrementChallengeField({ ...params, field: 'totalHints' });
  incrementChallengeTotalGiveUps = (params: { challenge: number }) =>
    this.incrementChallengeField({ ...params, field: 'totalGiveUps' });

  makeNewChallenge = zoddy(
    // Requires AppContextType for Reddit API access etc.
    z.object({ context: zodAppContext }),
    async ({ context }) => {
      console.log('Making new challenge...');

      // Instantiate WordListService with the same redis client (might be transaction)
      const wordListService = new WordListService(this.redis);

      // Use instance methods where possible, pass context redis if needed by helpers
      const [wordList, usedWords, currentChallengeNumber, currentSubreddit] = await Promise.all([
        wordListService.getCurrentWordList({}),
        ChallengeToWord.getAllUsedWords({ redis: context.redis }),
        this.getCurrentChallengeNumber(),
        context.reddit.getCurrentSubreddit(),
      ]);

      console.log('Current challenge number:', currentChallengeNumber);

      const unusedWordIndex = wordList.findIndex((word: string) => !usedWords.includes(word));
      if (unusedWordIndex === -1) {
        throw new Error(
          'No unused words available in the word list. Please add more and try again.'
        );
      }
      const newWord = wordList[unusedWordIndex];
      const newChallengeNumber = currentChallengeNumber + 1;

      console.log('Current challenge number:', currentChallengeNumber);
      await API.getWordConfigCached({ context: context, word: newWord });

      let post: Post | undefined;
      try {
        // Assume this.redis might be a transaction passed to constructor
        const txnRedis = this.redis;
        const txnChallengeService = new ChallengeService(txnRedis); // Use the same redis instance
        const txnWordListService = new WordListService(txnRedis);

        await txnWordListService.setCurrentWordListWords({
          words: wordList.slice(unusedWordIndex + 1),
        });

        post = await context.reddit.submitPost({
          subredditName: currentSubreddit.name,
          title: `Hot and cold #${newChallengeNumber}`,
          preview: <Preview />,
        });

        const winnersCircleComment = await post.addComment({
          richtext: new RichTextBuilder().paragraph((c) =>
            c.text({ text: `🏆 Winner's Circle 🏆` })
          ),
        });
        await winnersCircleComment.distinguish(true);

        // Use the transaction-aware service instances
        await txnChallengeService.setChallenge({
          challenge: newChallengeNumber,
          config: {
            word: newWord,
            winnersCircleCommentId: winnersCircleComment.id,
            totalPlayers: '0',
            totalSolves: '0',
            totalGuesses: '0',
            totalHints: '0',
            totalGiveUps: '0',
          },
        });

        await txnChallengeService.setCurrentChallengeNumber({ number: newChallengeNumber });

        // Pass transaction-aware redis to helpers
        await ChallengeToWord.setChallengeNumberForWord({
          challenge: newChallengeNumber,
          redis: txnRedis,
          word: newWord,
        });
        await ChallengeToPost.setChallengeNumberForPost({
          challenge: newChallengeNumber,
          postId: post.id,
          redis: txnRedis,
        });

        if (currentChallengeNumber > 0) {
          // Pass transaction-aware redis if Streaks supports it
          await Streaks.expireStreaks({
            redis: context.redis, // Base redis might be needed?
            // @ts-expect-error THis is due to the workaround
            txn: txnRedis, // Cast may be needed depending on Streaks signature
            challengeNumberBeforeTheNewestChallenge: currentChallengeNumber,
          });
        }

        // if (txn is transaction) await txn.exec();

        console.log(
          'New challenge created:',
          'Number:',
          newChallengeNumber,
          'Word:',
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
        if (post) {
          console.log(`Removing post ${post.id} due to new challenge error`);
          await context.reddit.remove(post.id, false);
        }
        throw error;
      }
    }
  );
}
