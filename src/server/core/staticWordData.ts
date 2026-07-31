import { gunzipSync } from 'node:zlib';
import { cache } from '@devvit/web/server';
import { z } from 'zod';
import { WORD_DATA_RELEASE } from '../../shared/wordDataVersion';

export const STATIC_WORD_DATA_BASE_URL =
  'https://raw.githubusercontent.com/reddit/devvit-HotAndCold/main/word-data/v1';

const STATIC_FETCH_TIMEOUT_MS = 15_000;
const STATIC_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const DICTIONARY_HEADER = 'id,word,isHint';
const MAGIC = 'HCW2';
const HEADER_BYTES = 12;
const EXACT_RECORD_BYTES = 10;
const QUANTIZED_RECORD_BYTES = 4;
const SIMILARITY_SCALE = 10_000;

const staticWordDataUrl = (path: string): string =>
  `${STATIC_WORD_DATA_BASE_URL}/${path}?release=${encodeURIComponent(WORD_DATA_RELEASE)}`;

const rankedWordSchema = z
  .object({
    word: z.string().min(1),
    similarity: z.number().finite(),
    isHint: z.boolean(),
  })
  .strict();

export type StaticWordConfig = {
  closest_word: string;
  closest_similarity: number;
  furthest_word: string;
  furthest_similarity: number;
  similar_words: Array<{ word: string; similarity: number; is_hint: boolean }>;
};

export type StaticDictionary = {
  words: readonly string[];
  hints: readonly boolean[];
};

const normalizeWord = (word: string): string => word.trim().toLowerCase();

const wordFileName = (word: string): string =>
  `${encodeURIComponent(word).replaceAll("'", '%27')}.bin.gz`;

function parseCsvRow(row: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < row.length; index++) {
    const char = row[index]!;
    if (char === '"') {
      if (quoted && row[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error('Unterminated quoted CSV field');
  fields.push(field);
  return fields;
}

function parseBoolean(value: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function decompress(bytes: Uint8Array): Buffer {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return Buffer.from(bytes);
  return gunzipSync(bytes);
}

export function decodeStaticDictionary(bytes: Uint8Array): StaticDictionary {
  const lines = decompress(bytes).toString('utf8').split(/\r?\n/).filter(Boolean);
  if (lines[0] !== DICTIONARY_HEADER) throw new Error('Unexpected static dictionary header');

  const words: string[] = [];
  const hints: boolean[] = [];
  for (let index = 1; index < lines.length; index++) {
    const fields = parseCsvRow(lines[index]!);
    if (fields.length !== 3 || Number(fields[0]) !== index - 1) {
      throw new Error(`Invalid static dictionary row ${index}`);
    }
    const word = normalizeWord(fields[1]!);
    if (!word) throw new Error(`Empty static dictionary word at row ${index}`);
    words.push(word);
    hints.push(parseBoolean(fields[2]!));
  }
  if (words.length === 0 || new Set(words).size !== words.length) {
    throw new Error('Static dictionary is empty or contains duplicates');
  }
  if (words.length > 65_535) throw new Error('Static dictionary exceeds uint16 IDs');
  return { words, hints };
}

export function decodeStaticWordConfig(
  bytes: Uint8Array,
  expectedSecret: string,
  dictionary: StaticDictionary
): StaticWordConfig {
  const data = decompress(bytes);
  if (data.length < HEADER_BYTES || data.toString('ascii', 0, 4) !== MAGIC) {
    throw new Error('Unsupported static word-data format');
  }

  const neighborCount = data.readUInt32LE(4);
  const secretId = data.readUInt16LE(8);
  const exactCount = data.readUInt16LE(10);
  const expected = normalizeWord(expectedSecret);
  if (neighborCount !== dictionary.words.length - 1) {
    throw new Error(
      `${expected} has ${neighborCount} neighbors; expected ${dictionary.words.length - 1}`
    );
  }
  if (exactCount > neighborCount) throw new Error(`Invalid exact-row count for ${expected}`);
  if (dictionary.words[secretId] !== expected) {
    throw new Error(`Invalid secret ID for static target "${expected}"`);
  }

  const expectedBytes =
    HEADER_BYTES +
    exactCount * EXACT_RECORD_BYTES +
    (neighborCount - exactCount) * QUANTIZED_RECORD_BYTES;
  if (data.length !== expectedBytes) {
    throw new Error(`Invalid static target byte length for "${expected}"`);
  }

  const seenIds = new Set<number>([secretId]);
  const neighbors: Array<z.infer<typeof rankedWordSchema>> = [];
  let offset = HEADER_BYTES;
  for (let index = 0; index < neighborCount; index++) {
    const wordId = data.readUInt16LE(offset);
    if (wordId >= dictionary.words.length || seenIds.has(wordId)) {
      throw new Error(`Invalid or duplicate word ID at rank ${index + 1} for "${expected}"`);
    }
    seenIds.add(wordId);
    const similarity =
      index < exactCount
        ? data.readDoubleLE(offset + 2)
        : data.readInt16LE(offset + 2) / SIMILARITY_SCALE;
    neighbors.push(
      rankedWordSchema.parse({
        word: dictionary.words[wordId],
        similarity,
        isHint: dictionary.hints[wordId],
      })
    );
    offset += index < exactCount ? EXACT_RECORD_BYTES : QUANTIZED_RECORD_BYTES;
  }

  const closest = neighbors[0];
  const furthest = neighbors.at(-1);
  if (!closest || !furthest || seenIds.size !== dictionary.words.length) {
    throw new Error(`Incomplete static rankings for "${expected}"`);
  }
  return {
    closest_word: closest.word,
    closest_similarity: closest.similarity,
    furthest_word: furthest.word,
    furthest_similarity: furthest.similarity,
    similar_words: neighbors.map((neighbor) => ({
      word: neighbor.word,
      similarity: neighbor.similarity,
      is_hint: neighbor.isHint,
    })),
  };
}

async function fetchStaticBytesFromOrigin(
  path: string,
  url: string,
  cacheKey: string,
  reason: 'cache-fill' | 'cache-bypass'
): Promise<Buffer | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STATIC_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/octet-stream' },
      signal: controller.signal,
    });
    if (response.status === 404) {
      console.error('[word-data] GitHub Raw file not found', { path, url, cacheKey, reason });
      return null;
    }
    if (!response.ok) {
      throw new Error(`Static word data returned HTTP ${response.status} for ${path}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes;
  } catch (error) {
    console.error('[word-data] GitHub Raw fetch failed', { path, url, cacheKey, reason, error });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchStaticBytes(path: string): Promise<Uint8Array | null> {
  const url = staticWordDataUrl(path);
  const cacheKey = `static-word-data:${WORD_DATA_RELEASE}:${path}`;
  let cacheFillAttempted = false;
  try {
    const cached = await cache(
      async (): Promise<{ found: true; base64: string }> => {
        cacheFillAttempted = true;
        const bytes = await fetchStaticBytesFromOrigin(path, url, cacheKey, 'cache-fill');
        if (!bytes) {
          // Cache helper stores both returned values and errors. Throwing avoids a 30-day
          // successful negative value; the caller bypasses cached errors on later requests.
          throw new Error(`Static word data returned HTTP 404 for ${path}`);
        }
        return { found: true, base64: bytes.toString('base64') };
      },
      {
        key: cacheKey,
        ttl: STATIC_CACHE_TTL_SECONDS,
      }
    );
    return Buffer.from(cached.base64, 'base64');
  } catch (error) {
    if (cacheFillAttempted && error instanceof Error && error.message.includes('HTTP 404')) {
      return null;
    }
    console.warn('[word-data] cache-helper failed; bypassing cache', {
      path,
      cacheKey,
      error,
    });
    return await fetchStaticBytesFromOrigin(path, url, cacheKey, 'cache-bypass');
  }
}

async function staticFileExists(path: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STATIC_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(staticWordDataUrl(path), {
      method: 'HEAD',
      signal: controller.signal,
    });
    if (response.status === 404) return false;
    if (!response.ok) {
      throw new Error(`Static word data returned HTTP ${response.status} for ${path}`);
    }
    return true;
  } finally {
    clearTimeout(timeout);
  }
}

let dictionaryMemory: StaticDictionary | null = null;
let dictionaryPending: Promise<StaticDictionary | null> | null = null;

async function getStaticDictionary(): Promise<StaticDictionary | null> {
  if (dictionaryMemory) return dictionaryMemory;
  if (dictionaryPending) return dictionaryPending;
  dictionaryPending = (async () => {
    const bytes = await fetchStaticBytes('_dictionary.csv.gz');
    if (!bytes) {
      console.error('[word-data] dictionary file is unavailable');
      return null;
    }
    try {
      dictionaryMemory = decodeStaticDictionary(bytes);
      return dictionaryMemory;
    } catch (error) {
      console.error('[word-data] dictionary decode failed', {
        compressedBytes: bytes.byteLength,
        error,
      });
      throw error;
    }
  })();
  try {
    return await dictionaryPending;
  } finally {
    dictionaryPending = null;
  }
}

export async function getStaticWordConfig(word: string): Promise<StaticWordConfig | null> {
  const normalized = normalizeWord(word);
  const path = wordFileName(normalized);
  const [dictionary, bytes] = await Promise.all([getStaticDictionary(), fetchStaticBytes(path)]);
  if (!bytes) {
    console.error('[word-data] target file is unavailable', {
      word: normalized,
      path,
      release: WORD_DATA_RELEASE,
    });
    return null;
  }
  if (!dictionary) {
    console.error('[word-data] cannot decode target without dictionary', {
      word: normalized,
      path,
      targetBytes: bytes.byteLength,
    });
    throw new Error('Static word dictionary is unavailable');
  }
  try {
    return decodeStaticWordConfig(bytes, normalized, dictionary);
  } catch (error) {
    console.error('[word-data] target decode failed', {
      word: normalized,
      path,
      targetBytes: bytes.byteLength,
      dictionaryWords: dictionary.words.length,
      error,
    });
    throw error;
  }
}

export async function hasStaticWordConfig(word: string): Promise<boolean> {
  return await staticFileExists(wordFileName(normalizeWord(word)));
}
