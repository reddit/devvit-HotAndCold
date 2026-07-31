import { z } from 'zod';
import { fn } from '../../shared/fn';
import { WORD_DATA_RELEASE } from '../../shared/wordDataVersion';
import { redisCompressed as redis } from './redisCompression';
import { getStaticWordConfig, hasStaticWordConfig } from './staticWordData';

export * as API from './api.js';

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

const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;
export const WordConfigKey = (word: string) => `word_config4:${WORD_DATA_RELEASE}:${word}` as const;

export type WordConfig = z.infer<typeof wordConfigSchema>;

const configMemory = new Map<string, WordConfig>();
const configPending = new Map<string, Promise<WordConfig>>();
const MAX_MEMORY_CONFIGS = 4;

class StaticTargetNotFoundError extends Error {}

function rememberConfig(word: string, config: WordConfig): void {
  configMemory.delete(word);
  configMemory.set(word, config);
  while (configMemory.size > MAX_MEMORY_CONFIGS) {
    const oldest = configMemory.keys().next().value;
    if (oldest == null) break;
    configMemory.delete(oldest);
  }
}

async function readCachedWordConfig(key: string): Promise<WordConfig | null> {
  try {
    const cached = await redis.get(key);
    return cached ? wordConfigSchema.parse(JSON.parse(cached)) : null;
  } catch (error) {
    console.error('[word-data] Redis config read failed', { key, error });
    return null;
  }
}

async function cacheWordConfig(key: string, config: WordConfig): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(config));
    await redis.expire(key, THIRTY_DAYS_IN_SECONDS);
  } catch (error) {
    console.error('[word-data] Redis config write failed', { key, error });
    // The configured source remains available when Redis is unavailable.
  }
}

export const getWordConfigCached = fn(
  z.object({
    word: z.string().trim().toLowerCase(),
  }),
  async ({ word }) => {
    const memory = configMemory.get(word);
    if (memory) return memory;
    const pending = configPending.get(word);
    if (pending) return pending;

    const key = WordConfigKey(word);
    const promise = (async () => {
      const cached = await readCachedWordConfig(key);
      if (cached) return cached;

      const fresh = await getStaticWordConfig(word);
      if (!fresh) {
        console.error('[word-data] static target lookup returned no data', {
          word,
          key,
          release: WORD_DATA_RELEASE,
        });
        throw new StaticTargetNotFoundError(`Static target is unavailable: ${word}`);
      }
      const parsed = wordConfigSchema.parse(fresh);
      await cacheWordConfig(key, parsed);
      return parsed;
    })();
    configPending.set(word, promise);
    try {
      const config = await promise;
      rememberConfig(word, config);
      return config;
    } finally {
      configPending.delete(word);
    }
  }
);

const wordSchema = z.object({
  data: z.array(
    z.object({
      word: z.string(),
      id: z.int(),
    })
  ),
});

export const getWord = fn(
  z.object({
    word: z.string().trim().toLowerCase(),
  }),
  async ({ word }) => {
    const exists = await hasStaticWordConfig(word);
    return wordSchema.parse({ data: exists ? [{ word, id: 0 }] : [] });
  }
);

export function renderLetterCsv(
  challengeSecretWord: string,
  letter: string,
  wordConfig: WordConfig
): string {
  const header = 'word,similarity,rank';
  const lower = letter.toLowerCase();
  const records: { word: string; similarity: number; rank: number }[] = [];

  for (let index = 0; index < wordConfig.similar_words.length; index++) {
    const entry = wordConfig.similar_words[index]!;
    if (entry.word && entry.word[0]?.toLowerCase() === lower) {
      records.push({ word: entry.word, similarity: entry.similarity, rank: index + 1 });
    }
  }

  if (challengeSecretWord[0]?.toLowerCase() === lower) {
    records.push({ word: challengeSecretWord, similarity: 1, rank: 0 });
  }

  const sorted = records.sort((left, right) =>
    left.word.localeCompare(right.word, undefined, { sensitivity: 'base' })
  );
  return [
    header,
    ...sorted.map((record) => `${record.word},${record.similarity.toFixed(4)},${record.rank}`),
  ].join('\n');
}

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
    return renderLetterCsv(challengeSecretWord, letter, wordConfig);
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
