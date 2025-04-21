import { z } from 'zod';
import {
  zodContext,
  zoddy,
  zodRedis,
  zodTransaction,
  zodTriggerContext,
} from '@hotandcold/shared/utils/zoddy';
import { DEFAULT_WORD_LIST } from '../constants.js';
import { API } from './api.js';

// Define base Zod schemas
const zodRedisClient = zodRedis;
const zodTransactionClient = zodTransaction;
const zodRedisOrTransactionClient = z.union([zodRedisClient, zodTransactionClient]);
const zodAppContext = z.union([zodContext, zodTriggerContext]);

// Infer Redis types from Zod schemas
type RedisClientType = z.infer<typeof zodRedisClient>;
type RedisOrTransactionClientType = z.infer<typeof zodRedisOrTransactionClient>;
type AppContextType = z.infer<typeof zodAppContext>;

/**
 * NOTE: Word lists a mutable! There is no way to know what the original word list was.
 *
 * You can use ChallengeToWord.getAllUsedWords to get all the words that have been used in challenges
 * if you really need to pull this.
 */
export class WordListService {
  // Use the specific inferred type for the instance variable
  private redis: RedisOrTransactionClientType;

  // Constructor expects the union type
  constructor(redis: RedisOrTransactionClientType) {
    this.redis = redis;
  }

  // Static utility method for key generation
  static getWordListKey(dictionary = 'default'): string {
    return `word_list:${dictionary}`;
  }

  // Instance method
  getCurrentWordList = zoddy(z.object({}), async ({}) => {
    // Cast to non-transaction type if needed for .get
    const redisClient = this.redis as RedisClientType;
    const wordListKey = WordListService.getWordListKey(); // Use static method
    const wordList = await redisClient.get(wordListKey);

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
      const redisClient = this.redis as RedisClientType;
      const wordListKey = WordListService.getWordListKey();
      const wordList = await redisClient.get(wordListKey);
      if (!wordList) {
        console.log('Initializing word list...');
        DEFAULT_WORD_LIST.forEach((word) => {
          // Pass the full context provided to the method
          // Cast context to the specific type API expects if necessary
          void API.getWordConfig({ context: context as AppContextType, word });
        });
        await redisClient.set(wordListKey, JSON.stringify(DEFAULT_WORD_LIST));
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
      // Create a temporary instance with the strictly non-transactional type for the get call
      const serviceForGet = new WordListService(this.redis as RedisClientType);
      const wordList = await serviceForGet.getCurrentWordList({});

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

      const wordListKey = WordListService.getWordListKey();
      await this.redis.set(
        wordListKey,
        JSON.stringify(mode === 'prepend' ? [...newWords, ...wordList] : [...wordList, ...newWords])
      );

      return {
        wordsAdded: newWords.length,
        wordsSkipped: skippedWords.length,
      };
    }
  );
}
