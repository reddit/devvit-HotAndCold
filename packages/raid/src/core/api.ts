import { z } from 'zod';
import { zodContext, zoddy, zodJobContext } from '@hotandcold/shared/utils/zoddy';
import { DEVVIT_SETTINGS_KEYS } from '../constants.js';
import { fromError } from 'zod-validation-error';
import { toMilliseconds } from '@hotandcold/shared/utils';

export * as API from './api.js';

const API_URL = 'https://jbbhyxtpholdwrxencjx.supabase.co/functions/v1/';

export const getWordConfigCacheKey = (word: string) => `word_config:${word}` as const;

/**
 * Generates a cache key for word comparisons. ORDER MATTERS HERE because
 * we lemma wordB (the user's guess). Also if a prior secret word is used
 * that is guessed often, that would break a deterministic cache key.
 *
 * So while the distance is the same regardless of comparison order, you still
 * need to cache in a given order due to the lemma check and the fact that
 * wordA is ALWAYS the secret word.
 */
export const getWordComparisonCacheKey = (wordA: string, wordB: string) => {
  // The _1 is because we messed up the original cache key and we don't
  // provide a way for users to clear their cache.
  return `word_comparison_1:${wordA}:${wordB}` as const;
};

const wordConfigSchema = z
  .object({
    closest_word: z.string(),
    closest_similarity: z.number(),
    furthest_word: z.string(),
    furthest_similarity: z.number(),
    similar_words: z.array(
      z
        .object({
          word: z.string(),
          similarity: z.number(),
          is_hint: z.boolean(),
          definition: z.string(),
        })
        .strict()
    ),
  })
  .strict();

const wordComparisonSchema = z
  .object({
    wordA: z.string(),
    wordB: z.string(),
    wordBLemma: z.string().trim().toLowerCase(),
    similarity: z.number().gte(-1).lte(1).nullable(),
  })
  .strict();

export const getWordConfig = zoddy(
  z.object({
    context: z.union([zodJobContext, zodContext]),
    word: z.string().trim().toLowerCase(),
  }),
  async ({ context, word }) => {
    const secret = await context.settings.get(DEVVIT_SETTINGS_KEYS.WORD_SERVICE_API_KEY);

    if (!secret) {
      throw new Error('No API key found for word service in Devvit.settings');
    }

    const response = await fetch(API_URL + 'nearest-words', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ word }),
    });

    // Do a quick check in case API is down or changes
    const result = wordConfigSchema.safeParse(await response.json());

    if (!result.success) {
      throw new Error(
        `Failed to parse response from API for word "${word}": ${result.error.errors}`
      );
    }

    return result.data;
  }
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
      const cached = await context.cache(
        async () => {
          console.log('Fetching word config for from API, cache miss:', word);
          const response = await getWordConfig({ context, word });

          return JSON.stringify(response);
        },
        {
          key: cacheKey,
          // Not doing forever because I'm worried I'll blow out our Redis
          ttl: toMilliseconds({ days: 30 }),
        }
      );

      return wordConfigSchema.parse(JSON.parse(cached));
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error(
          `Error getting word config for word: "${word}". This can commonly happen if the API does not find the target word in its dictionary. Make sure the word is the lemma form. Error:`,
          fromError(error)
        );
      } else {
        console.error(`Error getting word config for word: "${word}".`, error);
      }

      console.log(`Trying to get word config live from the API`);
      const response = await getWordConfig({ context, word });

      console.log(`I got a response live from the API doe so returning that.`);

      return response;
    }
  }
);

export const compareWords = zoddy(
  z.object({
    context: z.union([zodJobContext, zodContext]),
    secretWord: z.string().trim().toLowerCase(),
    guessWord: z.string().trim().toLowerCase(),
  }),
  async ({ context, secretWord: wordA, guessWord: wordB }) => {
    const secret = await context.settings.get(DEVVIT_SETTINGS_KEYS.WORD_SERVICE_API_KEY);
    if (!secret) {
      throw new Error('No API key found for word service in Devvit.settings');
    }
    const response = await fetch(API_URL + 'compare-words', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ wordA, wordB }),
    });
    return wordComparisonSchema.parse(await response.json());
  }
);

export const compareWordsCached = zoddy(
  z.object({
    context: z.union([zodJobContext, zodContext]),
    secretWord: z.string().trim().toLowerCase(),
    guessWord: z.string().trim().toLowerCase(),
    onCacheMiss: z.function().args(wordComparisonSchema).returns(z.promise(z.void())).optional(),
  }),
  async ({ context, secretWord: wordA, guessWord: wordB, onCacheMiss }) => {
    try {
      const cacheKey = getWordComparisonCacheKey(wordA, wordB);

      // We heavily cache because this is a very expensive/slow operation
      // and I'm too lazy to build a cache on the API side
      const cached = await context.cache(
        async () => {
          console.log(
            'Fetching word config for from API, cache miss',
            'wordA:',
            wordA,
            'wordB:',
            wordB
          );

          const response = await compareWords({
            context,
            secretWord: wordA,
            guessWord: wordB,
          });

          // Do a quick check in case API is down or changes
          const data = wordComparisonSchema.parse(response);

          await onCacheMiss?.(data);

          return JSON.stringify(data);
        },
        {
          key: cacheKey,
          // Much longer since we use it to compute the % of english dictionary
          // After a year will anyone really care? :D
          ttl: toMilliseconds({ days: 365 }),
        }
      );

      return wordComparisonSchema.parse(JSON.parse(cached));
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error(`Error getting cached word comparison. Error:`, fromError(error));
      } else {
        console.error(`Error getting cached word comparison:`, error);
      }

      console.log(`Trying to get word comparison live from the API`);

      const response = await compareWords({
        context,
        secretWord: wordA,
        guessWord: wordB,
      });

      console.log(`I got a response live from the API doe so returning that.`);

      return response;
    }
  }
);
