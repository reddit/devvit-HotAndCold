#!/usr/bin/env node --experimental-strip-types

import OpenAI from 'openai';
import { promises as fsp } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import PQueue from 'p-queue';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const WORDS_NEW_DIR = join(TOOLS_DIR, '..', 'words', 'new');
const INPUT_FILE = join(WORDS_NEW_DIR, 'extracted.txt');
const OUTPUT_FILE = join(WORDS_NEW_DIR, 'lemma-map-full.csv');
const FAILURES_FILE = join(WORDS_NEW_DIR, 'lemma-map-full.failures.txt');

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY || '';
  if (!key) throw new Error('Missing OPENAI_API_KEY environment variable for openai.');
  return key;
}

import { getVariantsFromOpenAI } from './openai-variants.ts';

async function ensureOutputFileReady(): Promise<void> {
  await fsp.mkdir(WORDS_NEW_DIR, { recursive: true });
  try {
    await fsp.access(OUTPUT_FILE);
  } catch {
    await fsp.writeFile(OUTPUT_FILE, 'word,lemma\n', 'utf8');
  }
}

async function removeOutputFileIfExists(): Promise<void> {
  try {
    await fsp.unlink(OUTPUT_FILE);
  } catch (err: unknown) {
    if ((err as { code?: string } | null)?.code !== 'ENOENT') {
      throw err;
    }
  }
}

async function removeFailuresFileIfExists(): Promise<void> {
  try {
    await fsp.unlink(FAILURES_FILE);
  } catch (err: unknown) {
    if ((err as { code?: string } | null)?.code !== 'ENOENT') {
      throw err;
    }
  }
}

// appendFailureLemma moved to './openai-variants.ts'

async function loadWords(path: string): Promise<string[]> {
  const raw = await fsp.readFile(path, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0 && !w.startsWith('#'));
}

function dedupePreserveOrder(words: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const key = w.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

// normalizeTokens moved to './openai-variants.ts'

// getVariantsFromOpenAI now imported from './openai-variants.ts'

async function appendRows(pairs: Array<{ word: string; lemma: string }>): Promise<void> {
  if (pairs.length === 0) return;
  const lines = pairs.map((p) => `${p.word},${p.lemma}`).join('\n') + '\n';
  await fsp.appendFile(OUTPUT_FILE, lines, 'utf8');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const [, , concurrencyArg, rpsArg, batchArg] = process.argv;
  const DEFAULT_CONCURRENCY = 100;
  const DEFAULT_RPS: number | undefined = 100;
  const DEFAULT_BATCH_SIZE = 100;
  const concurrency = Math.max(
    1,
    Number(concurrencyArg) || Number(process.env.CLEAN_CONCURRENCY) || DEFAULT_CONCURRENCY
  );
  const rps = Number.isFinite(Number(rpsArg))
    ? Number(rpsArg)
    : Number.isFinite(Number(process.env.CLEAN_RPS))
      ? Number(process.env.CLEAN_RPS)
      : DEFAULT_RPS;
  const batchSize = Math.max(
    1,
    Number(batchArg) || Number(process.env.CLEAN_BATCH_SIZE) || DEFAULT_BATCH_SIZE
  );

  // Fresh run: remove previous output and recreate with header
  await removeOutputFileIfExists();
  await removeFailuresFileIfExists();
  await ensureOutputFileReady();

  const inputWords = await loadWords(INPUT_FILE);
  const words = dedupePreserveOrder(inputWords);

  const queue = new PQueue({
    concurrency,
    ...(rps
      ? { intervalCap: Math.max(1, rps), interval: 1000, carryoverConcurrencyCount: true }
      : {}),
  });

  console.log(
    `Generating lemma map for ${words.length.toLocaleString()} lemmas | concurrency=${queue.concurrency}` +
      (rps ? `, rps≈${rps}` : '') +
      `, batch=${batchSize}`
  );

  const client = new OpenAI({ apiKey: getOpenAIKey() });

  let processed = 0;
  let writtenPairs = 0;

  for (let start = 0; start < words.length; start += batchSize) {
    const end = Math.min(start + batchSize, words.length);
    const tasks: Promise<unknown>[] = [];
    for (let i = start; i < end; i++) {
      const lemma = words[i]!;
      const task = queue.add(async () => {
        try {
          await sleep(15 + Math.floor(Math.random() * 60));
          const { tokens } = await getVariantsFromOpenAI(client, lemma);

          if (tokens.length === 0) {
            console.log(`[lemma-map] ${lemma}: no expansions`);
            return;
          }

          console.log(`[lemma-map] ${lemma.toLowerCase()}: ${tokens.join(',')}`);
          const pairs = tokens.map((v) => ({ word: v.toLowerCase(), lemma: lemma.toLowerCase() }));
          await appendRows(pairs);
          writtenPairs += pairs.length;
        } finally {
          processed++;
          if (processed % 100 === 0 || processed === words.length) {
            console.log(
              `  … processed ${processed.toLocaleString()} / ${words.length.toLocaleString()} (rows written≈${writtenPairs.toLocaleString()})`
            );
          }
        }
      });
      tasks.push(task);
    }
    await Promise.all(tasks);
    await queue.onIdle();
    console.log(
      `  ✓ batch ${(end / batchSize).toFixed(0)} (${end.toLocaleString()} / ${words.length.toLocaleString()})`
    );
  }

  console.log('Lemma map generation complete.');
  console.table({
    inputWords: inputWords.length,
    uniqueLemmas: words.length,
    rowsWrittenApprox: writtenPairs,
    outputFile: OUTPUT_FILE,
  });
}

// Only run when executed directly, not when imported
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
