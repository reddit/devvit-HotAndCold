import { z } from "zod";
import { zodContext, zoddy, zodJobContext } from "../utils/zoddy.js";
import { toMilliseconds } from "../utils/toMilliseconds.js";
import { DEVVIT_SETTINGS_KEYS } from "../constants.js";

export * as API from "./api.js";

const API_URL = "https://jbbhyxtpholdwrxencjx.supabase.co/functions/v1/";

export const getWordConfigCacheKey = (word: string) =>
  `word_config:${word}` as const;

/**
 * Generates a cache key for word comparisons in a deterministic order.
 * The order of the input parameters doesn't matter - the function will
 * always alphabetize them to ensure consistent cache keys:
 *
 * wordComparisonCacheKey('CAR', 'DOG') === wordComparisonCacheKey('DOG', 'CAR')
 * // Both return 'word_comparison:CAR:DOG'
 *
 * @param wordA - First word to compare
 * @param wordB - Second word to compare
 * @returns Cache key with words in alphabetical order
 */
export const getWordComparisonCacheKey = (
  wordA: string,
  wordB: string,
): `word_comparison:${string}:${string}` => {
  const [first, second] = [wordA, wordB].sort();
  return `word_comparison:${first}:${second}` as const;
};

const wordConfigSchema = z.object({
  closest_word: z.string(),
  closest_similarity: z.number(),
  furthest_word: z.string(),
  furthest_similarity: z.number(),
  similar_words: z.array(
    z.object({
      word: z.string(),
      similarity: z.number(),
      is_hint: z.boolean(),
      definition: z.string(),
    }),
  ),
});

const wordComparisonSchema = z.object({
  wordA: z.string(),
  wordB: z.string(),
  wordBLemma: z.string().trim().toLowerCase(),
  similarity: z.number().gte(-1).lte(1).nullable(),
});

export const getWordConfig = zoddy(
  z.object({
    context: z.union([zodJobContext, zodContext]),
    word: z.string().trim().toLowerCase(),
  }),
  async ({ context, word }) => {
    const secret = await context.settings.get(
      DEVVIT_SETTINGS_KEYS.WORD_SERVICE_API_KEY,
    );

    if (!secret) {
      throw new Error("No API key found for word service in Devvit.settings");
    }

    const response = await fetch(API_URL + "nearest-words", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ word }),
    });

    // Do a quick check in case API is down or changes
    return wordConfigSchema.parse(await response.json());
  },
);

export const getWordConfigCached = zoddy(
  z.object({
    context: z.union([zodJobContext, zodContext]),
    word: z.string().trim().toLowerCase(),
  }),
  async ({ context, word }) => {
    try {
      const cacheKey = getWordConfigCacheKey(word);

      // We heavily cache because this is a very expensive/slow operation
      // and I'm too lazy to build a cache on the API side
      const cached = await context.cache(async () => {
        console.log("Fetching word config for from API, cache miss:", word);
        const response = await getWordConfig({ context, word });

        return JSON.stringify(response);
      }, {
        key: cacheKey,
        // Not doing forever because I'm worried I'll blow out our Redis
        ttl: toMilliseconds({ days: 30 }),
      });

      return wordConfigSchema.parse(JSON.parse(cached));
    } catch (error) {
      console.error(`Error getting cached word config:`, error);

      const response = await getWordConfig({ context, word });

      console.log(`I got a response live from the API doe so returning that.`);

      return response;
    }
  },
);

export const compareWords = zoddy(
  z.object({
    context: z.union([zodJobContext, zodContext]),
    secretWord: z.string().trim().toLowerCase(),
    guessWord: z.string().trim().toLowerCase(),
  }),
  async ({ context, secretWord: wordA, guessWord: wordB }) => {
    const secret = await context.settings.get(
      DEVVIT_SETTINGS_KEYS.WORD_SERVICE_API_KEY,
    );
    if (!secret) {
      throw new Error("No API key found for word service in Devvit.settings");
    }
    const response = await fetch(API_URL + "compare-words", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ wordA, wordB }),
    });
    return wordComparisonSchema.parse(await response.json());
  },
);

export const compareWordsCached = zoddy(
  z.object({
    context: z.union([zodJobContext, zodContext]),
    secretWord: z.string().trim().toLowerCase(),
    guessWord: z.string().trim().toLowerCase(),
  }),
  async ({ context, secretWord: wordA, guessWord: wordB }) => {
    try {
      const cacheKey = getWordComparisonCacheKey(wordA, wordB);

      // We heavily cache because this is a very expensive/slow operation
      // and I'm too lazy to build a cache on the API side
      const cached = await context.cache(async () => {
        console.log(
          "Fetching word config for from API, cache miss",
          "wordA:",
          wordA,
          "wordB:",
          wordB,
        );

        const response = await compareWords({
          context,
          secretWord: wordA,
          guessWord: wordB,
        });

        // Do a quick check in case API is down or changes
        const data = wordComparisonSchema.parse(response);

        return JSON.stringify(data);
      }, {
        key: cacheKey,
        // Not doing forever because I'm worried I'll blow out our Redis
        ttl: toMilliseconds({ days: 30 }),
      });

      return wordComparisonSchema.parse(JSON.parse(cached));
    } catch (error) {
      console.error(`Error getting cached word comparison:`, error);

      const response = await compareWords({
        context,
        secretWord: wordA,
        guessWord: wordB,
      });

      console.log(`I got a response live from the API doe so returning that.`);

      return response;
    }
  },
);
