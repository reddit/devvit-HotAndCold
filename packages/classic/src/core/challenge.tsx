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
} from '@hotandcold/shared/utils/zoddy';

import { Devvit, Post, RedisClient, RichTextBuilder } from '@devvit/public-api';

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
  })
  .strict();

export class ChallengeService {
  constructor(private redis: RedisClient) {}

  // --- Static Key Generators ---
  static getCurrentChallengeNumberKey(): string {
    return 'current_challenge_number';
  }

  static getChallengeKey(challenge: number): string {
    return `challenge:${challenge}`;
  }

  // --- Instance Methods ---

  async getCurrentChallengeNumber(): Promise<number> {
    const currentChallengeNumber = await this.redis.get(
      ChallengeService.getCurrentChallengeNumberKey()
    );

    if (!currentChallengeNumber) {
      throw new Error('No current challenge number found');
    }

    return parseInt(currentChallengeNumber);
  }

  incrementCurrentChallengeNumber = zoddy(z.object({}), async () => {
    await this.redis.incrBy(ChallengeService.getCurrentChallengeNumberKey(), 1);
  });

  setCurrentChallengeNumber = zoddy(
    z.object({
      number: z.number().gt(0),
    }),
    async ({ number }) => {
      await this.redis.set(ChallengeService.getCurrentChallengeNumberKey(), number.toString());
    }
  );

  getChallenge = zoddy(
    z.object({
      challenge: z.number().gt(0),
    }),
    async ({ challenge }) => {
      const result = await this.redis.hGetAll(ChallengeService.getChallengeKey(challenge));

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
      await this.redis.hSet(ChallengeService.getChallengeKey(challenge), stringifyValues(config));
    }
  );

  initialize = zoddy(z.object({}), async () => {
    const key = ChallengeService.getCurrentChallengeNumberKey();
    const result = await this.redis.get(key);
    if (!result) {
      await this.redis.set(key, '0');
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

      const wordListService = new WordListService(this.redis);

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
        await wordListService.setCurrentWordListWords({
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
          },
        });

        await this.setCurrentChallengeNumber({ number: newChallengeNumber });

        await ChallengeToWord.setChallengeNumberForWord({
          challenge: newChallengeNumber,
          redis: this.redis,
          word: newWord,
        });
        await ChallengeToPost.setChallengeNumberForPost({
          challenge: newChallengeNumber,
          postId: post.id,
          redis: this.redis,
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
