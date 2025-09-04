#!/usr/bin/env node --experimental-strip-types

import { promises as fsp } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { shouldFilterAsync } from './word-utils.ts';
import PQueue from 'p-queue';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const WORDS_NEW_DIR = join(TOOLS_DIR, '..', 'words', 'new');
const LIST_FILE = join(WORDS_NEW_DIR, 'extracted.txt');
const BACKUP_FILE = join(WORDS_NEW_DIR, 'extracted.before-clean.txt');

async function loadWords(path: string): Promise<string[]> {
  const raw = await fsp.readFile(path, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && !w.startsWith('#'));
}

async function writeWords(path: string, words: string[]): Promise<void> {
  const content = words.join('\n') + '\n';
  await fsp.writeFile(path, content, 'utf8');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const [, , concurrencyArg, rpsArg, batchArg] = process.argv;
  const DEFAULT_CONCURRENCY = 80;
  const DEFAULT_RPS: number | undefined = 80;
  const DEFAULT_BATCH_SIZE = 80;
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

  const inputWords = await loadWords(LIST_FILE);

  // De-duplicate while preserving order (case-insensitive)
  const seen = new Set<string>();
  const uniqueWords: string[] = [];
  let duplicateCount = 0;
  for (const word of inputWords) {
    const key = word.toLowerCase().trim();
    if (seen.has(key)) {
      duplicateCount++;
      continue;
    }
    seen.add(key);
    uniqueWords.push(word);
  }

  // Filter out words that do not pass shouldFilterAsync (rate-limited, batched)
  const filterResults: boolean[] = new Array(uniqueWords.length);
  const queue = new PQueue({
    concurrency,
    ...(rps
      ? { intervalCap: Math.max(1, rps), interval: 1000, carryoverConcurrencyCount: true }
      : {}),
  });

  console.log(
    `Filtering ${uniqueWords.length.toLocaleString()} words | concurrency=${queue.concurrency}` +
      (rps ? `, rps≈${rps}` : '') +
      `, batch=${batchSize}`
  );

  let processed = 0;
  for (let start = 0; start < uniqueWords.length; start += batchSize) {
    const end = Math.min(start + batchSize, uniqueWords.length);
    const tasks: Promise<unknown>[] = [];
    for (let i = start; i < end; i++) {
      const index = i;
      const word = uniqueWords[i]!;
      const task = queue.add(async () => {
        // Small jitter to reduce burstiness
        await sleep(25 + Math.floor(Math.random() * 75));
        const res = await shouldFilterAsync(word);
        filterResults[index] = res;
        processed++;
        if (processed % 2000 === 0 || processed === uniqueWords.length) {
          console.log(
            `  … filtered ${processed.toLocaleString()} / ${uniqueWords.length.toLocaleString()}`
          );
        }
      });
      tasks.push(task);
    }
    await Promise.all(tasks);
    await queue.onIdle();
    console.log(
      `  ✓ batch ${(end / batchSize).toFixed(
        0
      )} (${end.toLocaleString()} / ${uniqueWords.length.toLocaleString()})`
    );
  }
  const cleaned: string[] = [];
  let filteredCount = 0;
  for (let i = 0; i < uniqueWords.length; i++) {
    if (filterResults[i]) {
      filteredCount++;
      continue;
    }
    cleaned.push(uniqueWords[i]!);
  }

  // Backup and write
  await fsp.copyFile(LIST_FILE, BACKUP_FILE).catch(() => {});
  await writeWords(LIST_FILE, cleaned);

  console.log('Word list cleaned successfully.');
  console.table({
    input: inputWords.length,
    duplicatesRemoved: duplicateCount,
    filteredRemoved: filteredCount,
    output: cleaned.length,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
