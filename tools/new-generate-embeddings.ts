#!/usr/bin/env node --experimental-strip-types

import { createWriteStream, promises as fsp } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import PQueue from 'p-queue';
import { format as csvFormat } from 'fast-csv';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const WORDS_NEW_DIR = join(TOOLS_DIR, '..', 'words', 'new');
const DEFAULT_INPUT = join(WORDS_NEW_DIR, 'word-list.txt');
const DEFAULT_OUTPUT = join(WORDS_NEW_DIR, 'gemini_3072_embeddings.csv');

const DEFAULT_BATCH_SIZE = 100; // API limit; we'll clamp if higher is passed
const DEFAULT_CONCURRENCY = 1; // number of requests in-flight (reduced to avoid rate limits)
const DEFAULT_RPS: number | undefined = 1; // default to 1 request/sec to back off more
const MAX_RETRIES = 8; // exponential backoff attempts (increased)
const BASE_DELAY_MS = 2000; // initial backoff delay (increased)

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function* chunkArray<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

function getApiKey(): string {
  const key = process.env.GOOGLE_API_KEY || process.env.GENAI_API_KEY || '';
  if (!key) {
    throw new Error(
      'Missing GOOGLE_API_KEY (or GENAI_API_KEY) environment variable for @google/genai.'
    );
  }
  return key;
}

async function readWordList(path: string): Promise<string[]> {
  const contents = await fsp.readFile(path, 'utf8');
  return contents
    .split(/\r?\n/) // preserve order
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

type EmbeddingResponse = {
  embeddings?: { values: number[] }[];
  embedding?: { values: number[] };
};

function pickEmbeddings(resp: EmbeddingResponse): number[][] {
  if (Array.isArray(resp.embeddings)) {
    return resp.embeddings.map((e) => e.values);
  }
  if (resp.embedding && Array.isArray(resp.embedding.values)) {
    return [resp.embedding.values];
  }
  throw new Error('Unexpected embeddings response shape.');
}

async function embedBatchWithRetry(
  ai: GoogleGenAI,
  words: string[],
  attempt: number = 0
): Promise<number[][]> {
  try {
    const resp = (await ai.models.embedContent({
      model: 'gemini-embedding-001',
      contents: words,
    })) as unknown as EmbeddingResponse;

    const embeddings = pickEmbeddings(resp);
    if (embeddings.length !== words.length) {
      throw new Error(
        `Embeddings length mismatch: expected ${words.length}, got ${embeddings.length}`
      );
    }
    return embeddings;
  } catch (err: any) {
    const status = err?.status || err?.code || err?.response?.status;
    const isRateLimit = status === 429 || status === 'RESOURCE_EXHAUSTED' || status === 503;
    const isRetryable = isRateLimit || err?.name === 'FetchError' || err?.name === 'AbortError';

    if (attempt < MAX_RETRIES && isRetryable) {
      const delay = Math.round(BASE_DELAY_MS * Math.pow(2, attempt) * (1 + Math.random()));
      console.warn(
        `Rate-limited or transient error on batch (attempt ${attempt + 1}/${MAX_RETRIES}). ` +
          `Retrying in ${delay}ms...`
      );
      await sleep(delay);
      return embedBatchWithRetry(ai, words, attempt + 1);
    }
    console.error('Failed to embed batch:', err);
    throw err;
  }
}

type CsvRow = { word: string; embedding: string };

async function main() {
  const [, , inputArg, outputArg, batchArg, concurrencyArg, rpsArg] = process.argv;
  const inputPath = inputArg || DEFAULT_INPUT;
  const outputPath = outputArg || DEFAULT_OUTPUT;
  let batchSize = Math.max(1, Number(batchArg) || DEFAULT_BATCH_SIZE);
  // Gemini embed API caps batch requests at 100 items
  if (batchSize > 100) {
    console.warn(`Batch size ${batchSize} exceeds API maximum of 100. Using 100.`);
    batchSize = 100;
  }
  const concurrency = Math.max(
    1,
    Number(concurrencyArg) || Number(process.env.EMBED_CONCURRENCY) || DEFAULT_CONCURRENCY
  );
  const rps = Number.isFinite(Number(rpsArg))
    ? Number(rpsArg)
    : Number.isFinite(Number(process.env.EMBED_RPS))
      ? Number(process.env.EMBED_RPS)
      : DEFAULT_RPS;

  const words = await readWordList(inputPath);
  if (words.length === 0) {
    console.error(`No words found in ${inputPath}`);
    process.exit(1);
  }

  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const outStream = createWriteStream(outputPath, { encoding: 'utf8' });
  const csvStream = csvFormat<CsvRow, CsvRow>({ headers: true });
  // Pipe csv to file stream
  csvStream.pipe(outStream);
  const queue = new PQueue({
    concurrency,
    ...(rps
      ? { intervalCap: Math.max(1, rps), interval: 1000, carryoverConcurrencyCount: true }
      : {}),
  });

  let processed = 0;
  console.log(
    `Embedding ${words.length.toLocaleString()} words to ${outputPath} | ` +
      `${batchSize}/req, concurrency=${queue.concurrency}` +
      (rps ? `, rps≈${rps}` : '') +
      ` (3072 dims)`
  );

  console.time('embed-all');
  try {
    const addTasks: Promise<unknown>[] = [];
    for (const batch of chunkArray(words, batchSize)) {
      const task = queue.add(async () => {
        // Small jitter before each request to reduce burstiness
        await sleep(100 + Math.floor(Math.random() * 200));
        const vectors = await embedBatchWithRetry(ai, batch);
        // Stream CSV rows: word, embedding-as-JSON-array
        for (let i = 0; i < batch.length; i++) {
          const row: CsvRow = { word: batch[i]!, embedding: JSON.stringify(vectors[i]!) };
          if (!csvStream.write(row)) {
            await new Promise<void>((resolve) => csvStream.once('drain', () => resolve()));
          }
        }
        processed += batch.length;
        if (processed % (batchSize * 10) === 0 || processed === words.length) {
          console.log(
            `  … embedded ${processed.toLocaleString()} / ${words.length.toLocaleString()}`
          );
        }
      });
      addTasks.push(task);
    }
    await Promise.all(addTasks);
    await queue.onIdle();
  } finally {
    await new Promise<void>((resolve, reject) => {
      csvStream.end(() => resolve());
      outStream.on('error', reject);
    });
  }
  console.timeEnd('embed-all');
  console.log('✅ Done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
