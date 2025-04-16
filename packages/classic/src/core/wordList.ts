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
import type { GameMode } from './types.js';

/**
 * NOTE: Word lists are mutable! There is no way to know what the original word list was.
 *
 * You can use ChallengeToWord.getAllUsedWords to get all the words that have been used in challenges
 * if you really need to pull this.
 */

const getWordListRedisKey = (mode: GameMode): string => {
  // Use 'default' for regular mode to maintain compatibility with the old key
  const keySuffix = mode === 'regular' ? 'default' : mode;
  return `word_list:${keySuffix}`;
};

const zodGameMode = z.enum(['regular', 'hardcore']);
const zodRedisOrTransaction = z.union([zodRedis, zodTransaction]);
const zodWordArray = z.array(z.string().trim().toLowerCase());
const zodContextOrTriggerContext = z.union([zodContext, zodTriggerContext]);

// Infer the Redis type from the Zod schema
type RedisType = z.infer<typeof zodRedisOrTransaction>;
// Infer context types if needed, adjust based on actual zod schema definitions
type ContextType = z.infer<typeof zodContextOrTriggerContext>;

export class WordListManager {
  private redis: RedisType;
  private mode: GameMode;
  private wordListKey: string;

  constructor(redis: RedisType, mode: GameMode) {
    this.redis = redis;
    this.mode = zodGameMode.parse(mode);
    this.wordListKey = getWordListRedisKey(this.mode);
  }

  // Define the zod schema for the non-transaction redis client if needed
  // const zodRedisClient = z.custom<z.infer<typeof zodRedis>>(); // Or whatever zodRedis represents

  async getCurrentWordList(): Promise<string[]> {
    // Cast to the non-transaction client type expected by .get()
    const redisClient = this.redis as z.infer<typeof zodRedis>;
    const wordList = await redisClient.get(this.wordListKey);

    if (!wordList) {
      // TODO: Consider initializing if not found, or handle differently based on mode
      throw new Error(`No word list found for mode: ${this.mode}`);
    }

    return JSON.parse(wordList) as string[];
  }

  setCurrentWordListWords = zoddy(
    z.object({
      words: zodWordArray,
    }),
    async ({ words }) => {
      await this.redis.set(this.wordListKey, JSON.stringify(words));
    }
  );

  /**
   * Adds words to the current word list.
   * Use if you want to add words to the list.
   */
  addToCurrentWordList = zoddy(
    z.object({
      words: zodWordArray,
      /** Prepend means the words will be used before words already in the list */
      addMode: z.enum(['prepend', 'append']).default('append'),
    }),
    async ({ words, addMode }) => {
      // Need to create a temporary instance with the correct redis type for zoddy
      // Use the inferred RedisType, casting might still be needed depending on zoddy's input expectation
      // If zoddy needs the non-transaction type, use z.infer<typeof zodRedis>
      const currentList = await new WordListManager(
        this.redis as z.infer<typeof zodRedis>,
        this.mode
      ).getCurrentWordList();

      // Filter out words that already exist
      const newWords = words.filter((word) => !currentList.includes(word));

      if (newWords.length === 0) {
        console.log(`All words already in ${this.mode} list. Nothing to add.`);
        return {
          wordsAdded: 0,
          wordsSkipped: words.length,
        };
      }

      // Log skipped words
      const skippedWords = words.filter((word) => currentList.includes(word));
      if (skippedWords.length > 0) {
        console.log(`Skipping existing words for ${this.mode} list: ${skippedWords.join(', ')}`);
      }

      const updatedList =
        addMode === 'prepend' ? [...newWords, ...currentList] : [...currentList, ...newWords];

      // Need to create a temporary instance with the correct redis type for zoddy
      await new WordListManager(this.redis, this.mode).setCurrentWordListWords({
        words: updatedList,
      });

      return {
        wordsAdded: newWords.length,
        wordsSkipped: skippedWords.length,
      };
    }
  );

  initialize = zoddy(
    z.object({
      context: zodContextOrTriggerContext, // The context object containing redis
    }),
    async ({ context }) => {
      // Use instance redis and key
      // Need to ensure this.redis is not a transaction here.
      // Casting for safety, assuming initialize is called outside transactions.
      const redisClient = this.redis as z.infer<typeof zodRedis>;
      const wordList = await redisClient.get(this.wordListKey);

      if (!wordList) {
        console.log(`Initializing word list for mode: ${this.mode}`);
        // For now, both modes initialize with the same default list.
        // This could be customized later if needed.
        DEFAULT_WORD_LIST.forEach((word) => {
          // Don't wait, this just heats up the cache for the third party API
          // Consider if API call should be mode-dependent
          // Pass the context provided to the method
          API.getWordConfig({ context: context, word });
        });
        await redisClient.set(this.wordListKey, JSON.stringify(DEFAULT_WORD_LIST));
      } else {
        console.log(`Word list for mode ${this.mode} already exists. Skipping initialization.`);
      }
    }
  );
}
