import { z } from 'zod';
import { API } from '../core/api.js';
import { ChallengeToWord } from './challengeToWord.js';
import { WordListManager } from './wordList.js';
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
import { Devvit, Post, RichTextBuilder } from '@devvit/public-api';
import type { GameMode } from './types.js';
import { zodGameMode } from './types.js';

// Infer Redis types from Zod schemas
const zodRedisOrTransaction = z.union([zodRedis, zodTransaction]);
type RedisType = z.infer<typeof zodRedisOrTransaction>;
type RedisClientType = z.infer<typeof zodRedis>; // Non-transaction type

// Schema definition (outside class)
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
type ChallengeConfig = z.infer<typeof challengeSchema>;

export class ChallengeManager {
  private redis: RedisType;
  private mode: GameMode;

  constructor(redis: RedisType, mode: GameMode) {
    this.redis = redis;
    this.mode = zodGameMode.parse(mode); // Validate mode
  }

  // --- Key Generation Methods ---
  private getCurrentChallengeNumberKey(): string {
    const prefix = this.mode === 'regular' ? '' : `${this.mode}:`;
    return `${prefix}current_challenge_number`;
  }

  private getChallengeKey(challengeNumber: number): string {
    const prefix = this.mode === 'regular' ? '' : `${this.mode}:`;
    return `${prefix}challenge:${challengeNumber}`;
  }

  // --- Instance Methods ---
  async getCurrentChallengeNumber(): Promise<number> {
    const redisClient = this.redis as RedisClientType;
    const currentChallengeNumberStr = await redisClient.get(this.getCurrentChallengeNumberKey());
    if (!currentChallengeNumberStr) {
      throw new Error(`No current challenge number found for mode ${this.mode}`);
    }
    return parseInt(currentChallengeNumberStr);
  }

  incrementCurrentChallengeNumber = zoddy(z.object({}), async ({}) => {
    const redisClient = this.redis as RedisClientType;
    await redisClient.incrBy(this.getCurrentChallengeNumberKey(), 1);
  });

  setCurrentChallengeNumber = zoddy(
    z.object({
      number: z.number().int().gte(0),
    }),
    async ({ number }) => {
      await this.redis.set(this.getCurrentChallengeNumberKey(), number.toString());
    }
  );

  getChallenge = zoddy(
    z.object({
      challenge: z.number().int().gt(0),
    }),
    async ({ challenge }) => {
      const redisClient = this.redis as RedisClientType;
      const result = await redisClient.hGetAll(this.getChallengeKey(challenge));
      if (!result || Object.keys(result).length === 0) {
        throw new Error(`No challenge data found for challenge ${challenge}, mode ${this.mode}`);
      }
      // Use the predefined schema here
      return challengeSchema.parse(result);
    }
  );

  setChallenge = zoddy(
    z.object({
      challenge: z.number().int().gt(0),
      // Use the inferred type for config
      config: challengeSchema,
    }),
    async ({ challenge, config }) => {
      await this.redis.hSet(this.getChallengeKey(challenge), stringifyValues(config));
    }
  );

  private incrementChallengeField = zoddy(
    z.object({
      challenge: z.number().int().gt(0),
      field: z.enum(['totalPlayers', 'totalSolves', 'totalGuesses', 'totalHints', 'totalGiveUps']),
      amount: z.number().int().default(1),
    }),
    async ({ challenge, field, amount }) => {
      await this.redis.hIncrBy(this.getChallengeKey(challenge), field, amount);
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

  // makeNewChallenge is an instance method related to managing challenges for this mode
  makeNewChallenge = zoddy(
    z.object({
      // Still needs context for Reddit API, etc.
      context: z.union([zodJobContext, zodContext]),
    }),
    async ({ context }) => {
      // Use instance mode
      const mode = this.mode;
      console.log(`Making new challenge for mode: ${mode}...`);

      // Use instance redis for WordListManager
      const wordListManager = new WordListManager(this.redis, mode);

      // Use instance methods where possible

      const [wordList, usedWords, currentChallengeNumber, currentSubreddit] = await Promise.all([
        wordListManager.getCurrentWordList(),
        // TODO: Update ChallengeToWord to be mode-aware
        ChallengeToWord.getAllUsedWords({ redis: context.redis }), // Keep context.redis if needed by helper
        this.getCurrentChallengeNumber(), // Use instance method
        context.reddit.getCurrentSubreddit(),
      ]);

      console.log(`Current challenge number (${mode}):`, currentChallengeNumber);
      const unusedWordIndex = wordList.findIndex((word: string) => !usedWords.includes(word));
      if (unusedWordIndex === -1) {
        throw new Error(`No unused words available in the ${mode} word list.`);
      }
      const newWord = wordList[unusedWordIndex];
      const newChallengeNumber = currentChallengeNumber + 1;
      console.log(`New challenge number (${mode}):`, newChallengeNumber);

      await API.getWordConfigCached({ context: context, word: newWord });

      let post: Post | undefined;
      try {
        const txn = context.redis; // Using context.redis, assumes no transaction for now
        // Create a manager instance for the transaction, using the same mode
        const txnChallengeManager = new ChallengeManager(txn, this.mode);
        const txnWordListManager = new WordListManager(txn, mode);

      await setCurrentChallengeNumber({
        number: newChallengeNumber,
        redis: txn,
      });
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

      // Edge case handling for the first time
      if (currentChallengeNumber > 0) {
        await Streaks.expireStreaks({
          redis: context.redis,
          // @ts-expect-error THis is due to the workaround
          txn,
          challengeNumberBeforeTheNewestChallenge: currentChallengeNumber,
        });

        const postTitle = `Hot and cold${mode !== 'regular' ? ` (${mode})` : ''} #${newChallengeNumber}`;
        post = await context.reddit.submitPost({
          subredditName: currentSubreddit.name,
          title: postTitle,
          preview: <Preview />,
        });

        const winnersCircleComment = await post.addComment({
          richtext: new RichTextBuilder().paragraph((c) =>
            c.text({ text: `🏆 Winner's Circle (${mode}) 🏆` })
          ),
        });
        await winnersCircleComment.distinguish(true);

        await txnChallengeManager.setChallenge({
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

        await txnChallengeManager.setCurrentChallengeNumber({ number: newChallengeNumber });

        // TODO: Update dependent modules for mode awareness
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

        if (currentChallengeNumber > 0) {
          // TODO: Update Streaks for mode awareness
          await Streaks.expireStreaks({
            redis: context.redis,
            txn: txn as any, // Keep workaround for transaction type
            challengeNumberBeforeTheNewestChallenge: currentChallengeNumber,
          });
        }

        console.log(
          `New challenge created (${mode}):`,
          'Challenge:',
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
          mode: mode,
        };
      } catch (error) {
        console.error(`Error making new ${mode} challenge:`, error);
        if (post) {
          console.log(`Removing post ${post.id} due to new ${mode} challenge error`);
          // Use the context passed into the method
          await context.reddit.remove(post.id, false);
        }
        throw error;
      }
    }
  );

  // --- Static Methods ---
  // initialize remains static as it sets up before an instance might exist
  static initialize = zoddy(
    z.object({
      redis: zodRedis,
      mode: zodGameMode,
    }),
    async ({ redis, mode }) => {
      // Instantiate manager locally to access key generation
      const manager = new ChallengeManager(redis as RedisClientType, mode);
      const key = manager.getCurrentChallengeNumberKey();
      const result = await (redis as RedisClientType).get(key);
      if (!result) {
        console.log(`Initializing challenge number for mode: ${mode}`);
        await (redis as RedisClientType).set(key, '0');
      } else {
        console.log(`Challenge number for mode ${mode} already initialized`);
      }
    }
  );
}
