import { z } from 'zod';
import { zodContext, zoddy, zodTriggerContext } from '@hotandcold/shared/utils/zoddy';
import { DEFAULT_WORD_LIST } from '../constants.js';
import { API } from './api.js';
import { RedisClient } from '@devvit/public-api';
import { Mode } from '@hotandcold/classic-shared';

// Define base Zod schemas
const zodAppContext = z.union([zodContext, zodTriggerContext]);

/**
 * NOTE: Word lists a mutable! There is no way to know what the original word list was.
 *
 * You can use ChallengeToWord.getAllUsedWords to get all the words that have been used in challenges
 * if you really need to pull this.
 */
export class WordListService {
  constructor(
    private redis: RedisClient,
    private mode: Mode
  ) {}

  // Static utility method for key generation
  static getWordListKey(dictionary = 'default'): string {
    return `word_list:${dictionary}`;
  }

  // Instance method
  getCurrentWordList = zoddy(z.object({}), async () => {
    const wordListKey = WordListService.getWordListKey();
    const wordList = await this.redis.get(wordListKey);

    if (!wordList) {
      throw new Error('No word list found');
    }

    return JSON.parse(wordList) as string[];
  });

  // Instance method allowing transaction or regular redis
  setCurrentWordListWords = zoddy(
    z.object({
      words: z.array(z.string().trim().toLowerCase()),
    }),
    async ({ words }) => {
      const wordListKey = WordListService.getWordListKey();
      await this.redis.set(wordListKey, JSON.stringify(words));
    }
  );

  // Instance method, likely needs non-transactional redis for `get`
  // Also needs the original context for API call
  initialize = zoddy(
    // Ensure the input schema matches expected type
    z.object({ context: zodAppContext }),
    async ({ context }) => {
      // Use the redis instance provided in the constructor
      const wordListKey = WordListService.getWordListKey();
      const wordList = await this.redis.get(wordListKey);
      if (!wordList) {
        DEFAULT_WORD_LIST.forEach((word) => {
          // Don't wait, this just heas up the cache for the third party API
          void API.getWordConfig({ context: context, word });
        });
        await this.redis.set(wordListKey, JSON.stringify(DEFAULT_WORD_LIST));
      } else {
        console.log('Word list already exists. Skipping initialization.');
      }
    }
  );

  /**
   * Use if you want to add the next word that will be chosen.
   */
  // Instance method, needs non-transactional redis for getCurrentWordList
  addToCurrentWordList = zoddy(
    z.object({
      words: z.array(z.string().trim().toLowerCase()),
      /** Prepend means the words will be used before words already in the list */
      mode: z.enum(['prepend', 'append']).default('append'),
    }),
    async ({ words, mode }) => {
      const wordList = await this.getCurrentWordList({});

      // Filter out words that already exist
      const newWords = words.filter((word) => !wordList.includes(word));

      if (newWords.length === 0) {
        console.log('All words already in list. Nothing to add.');
        return {
          wordsAdded: 0,
          wordsSkipped: words.length,
        };
      }

      // Log skipped words
      const skippedWords = words.filter((word) => wordList.includes(word));
      if (skippedWords.length > 0) {
        console.log(`Skipping existing words: ${skippedWords.join(', ')}`);
      }

      await this.redis.set(
        WordListService.getWordListKey(),
        JSON.stringify(mode === 'prepend' ? [...newWords, ...wordList] : [...wordList, ...newWords])
      );

      return {
        wordsAdded: newWords.length,
        wordsSkipped: skippedWords.length,
      };
    }
  );
}
