import { z } from 'zod';
import { fn } from '../../shared/fn';
import { settings, redis } from '@devvit/web/server';

export * as API from './api.js';

const API_URL = 'https://jbbhyxtpholdwrxencjx.supabase.co/functions/v1/';

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
        })
        .strict()
    ),
  })
  .strict();

const wordSchema = z.object({
  data: z.array(
    z.object({
      word: z.string(),
      id: z.int(),
    })
  ),
});

export const getWordConfig = fn(
  z.object({
    word: z.string().trim().toLowerCase(),
  }),
  async ({ word }) => {
    const secret = await settings.get<string>('SUPABASE_SECRET');

    if (!secret) {
      throw new Error('No API key found for word service in Devvit.settings');
    }

    const response = await fetch(API_URL + 'nearest-words-2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${String(secret)}`,
      },
      body: JSON.stringify({ word }),
    });

    // Do a quick check in case API is down or changes
    return wordConfigSchema.parse(await response.json());
  }
);

export const getWord = fn(
  z.object({
    word: z.string().trim().toLowerCase(),
  }),
  async ({ word }) => {
    const secret = await settings.get<string>('SUPABASE_SECRET');

    if (!secret) {
      throw new Error('No API key found for word service in Devvit.settings');
    }

    const response = await fetch(API_URL + 'word-2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${String(secret)}`,
      },
      body: JSON.stringify({ word }),
    });

    // Do a quick check in case API is down or changes
    return wordSchema.parse(await response.json());
  }
);

const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;
const WordConfigKey = (word: string) => `word_config2:${word}` as const;

export const getWordConfigCached = fn(
  z.object({
    word: z.string().trim().toLowerCase(),
  }),
  async ({ word }) => {
    const key = WordConfigKey(word);

    // Try cache first. On any failure, fall back to fresh fetch.
    try {
      console.log('Getting word config cached', key);
      const cached = await redis.get(key);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          return wordConfigSchema.parse(parsed);
        } catch {
          // ignore parse/validation errors and fetch fresh
        }
      }
    } catch {
      // ignore redis read errors and fetch fresh
    }

    console.log('No cache found, fetching fresh...');

    // Fetch fresh and attempt to cache
    const fresh = await getWordConfig({ word });
    console.log('Getting word config fresh', key);
    try {
      await redis.set(key, JSON.stringify(fresh));
      await redis.expire(key, THIRTY_DAYS_IN_SECONDS);
    } catch {
      // ignore redis write/expire errors
    }
    return fresh;
  }
);

export const buildLetterCsvForChallenge = fn(
  z.object({
    challengeSecretWord: z.string().trim().toLowerCase(),
    letter: z
      .string()
      .length(1)
      .regex(/^[a-z]$/),
  }),
  async ({ challengeSecretWord, letter }): Promise<string> => {
    const wordConfig = await getWordConfigCached({ word: challengeSecretWord });
    const header = 'word,similarity,rank';
    const lower = letter.toLowerCase();

    // Collect records for the requested starting letter
    const records: { word: string; similarity: number; rank: number }[] = [];
    for (let i = 0; i < wordConfig.similar_words.length; i++) {
      const entry = wordConfig.similar_words[i]!;
      if (entry.word && entry.word[0]?.toLowerCase() === lower) {
        const rank = i + 1; // 1-based rank from global order
        records.push({ word: entry.word, similarity: entry.similarity, rank });
      }
    }

    // Ensure the secret word itself is present in its corresponding letter CSV
    if (challengeSecretWord[0]?.toLowerCase() === lower) {
      records.push({ word: challengeSecretWord, similarity: 1, rank: 0 });
    }

    // Deduplicate by word, prefer the lowest rank (so secret rank 0 wins)
    const bestByWord = new Map<string, { word: string; similarity: number; rank: number }>();
    for (const rec of records) {
      const existing = bestByWord.get(rec.word);
      if (!existing || rec.rank < existing.rank) {
        bestByWord.set(rec.word, rec);
      }
    }

    // Sort alphabetically by word to make the secret harder to spot while
    // preserving the original rank field for consumers that use it
    const sorted = Array.from(bestByWord.values()).sort((a, b) =>
      a.word.localeCompare(b.word, undefined, { sensitivity: 'base' })
    );

    const rows: string[] = [
      header,
      ...sorted.map((r) => `${r.word},${r.similarity.toFixed(4)},${r.rank}`),
    ];
    return rows.join('\n');
  }
);

export const buildHintCsvForChallenge = fn(
  z.object({
    challengeSecretWord: z.string().trim().toLowerCase(),
    max: z.number().int().min(1).max(100000).default(500),
  }),
  async ({ challengeSecretWord, max }): Promise<string> => {
    const wordConfig = await getWordConfigCached({ word: challengeSecretWord });
    const header = 'word,similarity,rank';
    const rows: string[] = [header];
    let added = 0;
    for (let i = 0; i < wordConfig.similar_words.length; i++) {
      if (added >= max) break;
      const entry = wordConfig.similar_words[i]!;
      if (!entry.is_hint) continue;
      const rank = i + 1; // 1-based rank from global order
      rows.push(`${entry.word},${entry.similarity.toFixed(4)},${rank}`);
      added++;
    }
    return rows.join('\n');
  }
);
