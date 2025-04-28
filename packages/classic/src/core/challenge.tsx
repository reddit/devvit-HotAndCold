import { z } from 'zod';
import { API } from '../core/api.js';
import { ChallengeToWordService } from './challengeToWord.js';
import { WordListService } from './wordList.js';
import { ChallengeToPostService } from './challengeToPost.js';
import { Preview } from '../components/Preview.js';
import { stringifyValues } from '@hotandcold/shared/utils';
import {
  redisNumberString,
  zodContext,
  zoddy,
  zodJobContext,
} from '@hotandcold/shared/utils/zoddy';
import { GameMode } from '@hotandcold/classic-shared';

import { Post, RedisClient, RichTextBuilder } from '@devvit/public-api';
// For some reason <Preview /> requires this import, but the import is being found as unused.
// Suppress the check for it
import { Devvit } from '@devvit/public-api'; // eslint-disable-line @typescript-eslint/no-unused-vars

export * as Challenge from './challenge.js';

// Define base Zod schemas
const zodAppContext = z.union([zodContext, zodJobContext]); // Combined context types

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
    // PostId of this challenge. This was only set after hardcore mode was introduced, so can't be guaranteed to be present
    postId: z.string().optional(),
  })
  .strict();

export class ChallengeService {
  #redis: RedisClient;
  #challengeToWordService: ChallengeToWordService;
  #challengeToPostService: ChallengeToPostService;
  #mode: GameMode;
  #currentChallengeNumberKey: string;
  #challengeKeyPrefix: string;

  constructor(redis: RedisClient, mode: GameMode) {
    this.#redis = redis;
    this.#mode = mode;
    this.#challengeToWordService = new ChallengeToWordService(redis, mode);
    this.#challengeToPostService = new ChallengeToPostService(redis, mode);

    const prefix = mode === 'hardcore' ? 'hc:' : '';
    this.#currentChallengeNumberKey = `${prefix}current_challenge_number`;
    this.#challengeKeyPrefix = `${prefix}challenge:`;
  }

  // --- Instance Key Generators ---
  #getCurrentChallengeNumberKey(): string {
    return this.#currentChallengeNumberKey;
  }

  getChallengeKey(challenge: number): string {
    return `${this.#challengeKeyPrefix}${challenge}`;
  }

  // --- Instance Methods ---

  async getCurrentChallengeNumber(): Promise<number> {
    const currentChallengeNumber = await this.#redis.get(this.#getCurrentChallengeNumberKey());

    if (!currentChallengeNumber) {
      throw new Error('No current challenge number found');
    }

    return parseInt(currentChallengeNumber);
  }

  incrementCurrentChallengeNumber = zoddy(z.object({}), async () => {
    await this.#redis.incrBy(this.#getCurrentChallengeNumberKey(), 1);
  });

  setCurrentChallengeNumber = zoddy(
    z.object({
      number: z.number().gt(0),
    }),
    async ({ number }) => {
      await this.#redis.set(this.#getCurrentChallengeNumberKey(), number.toString());
    }
  );

  getChallenge = zoddy(
    z.object({
      challenge: z.number().gt(0),
    }),
    async ({ challenge }) => {
      const result = await this.#redis.hGetAll(this.getChallengeKey(challenge));

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
      await this.#redis.hSet(this.getChallengeKey(challenge), stringifyValues(config));
    }
  );

  initialize = zoddy(z.object({}), async () => {
    const key = this.#getCurrentChallengeNumberKey();
    const result = await this.#redis.get(key);
    if (!result) {
      await this.#redis.set(key, '0');
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
      await this.#redis.hIncrBy(this.getChallengeKey(challenge), field, amount);
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
      console.log(`Making new challenge for mode: ${this.#mode}`);

      const wordListService = new WordListService(this.#redis, this.#mode);

      const [wordList, usedWords, currentChallengeNumber, currentSubreddit] = await Promise.all([
        wordListService.getCurrentWordList({}),
        this.#challengeToWordService.getAllUsedWords({}),
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
        await wordListService.setCurrentWordListWords({
          words: wordList.slice(unusedWordIndex + 1),
        });

        const title =
          this.#mode === 'hardcore'
            ? `Hot and Cold HARDCORE #${newChallengeNumber}`
            : `Hot and Cold #${newChallengeNumber}`;

        post = await context.reddit.submitPost({
          subredditName: currentSubreddit.name,
          title: title,
          preview: <Preview />,
        });

        const winnersCircleComment = await post.addComment({
          richtext: new RichTextBuilder().paragraph((c) =>
            c.text({ text: `🏆 Winner's Circle 🏆` })
          ),
        });
        await winnersCircleComment.distinguish(true);

        await this.setChallenge({
          challenge: newChallengeNumber,
          config: {
            word: newWord,
            winnersCircleCommentId: winnersCircleComment.id,
            totalPlayers: '0',
            totalSolves: '0',
            totalGuesses: '0',
            totalHints: '0',
            totalGiveUps: '0',
            postId: post.id,
          },
        });

        await this.setCurrentChallengeNumber({ number: newChallengeNumber });

        await this.#challengeToWordService.setChallengeNumberForWord({
          challenge: newChallengeNumber,
          word: newWord,
        });
        await this.#challengeToPostService.setChallengeIdentifierForPost({
          challenge: newChallengeNumber,
          postId: post.id,
        });

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
