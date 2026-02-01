#!/usr/bin/env node --experimental-strip-types

import { promises as fsp } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { shouldFilterAsync } from './word-utils.ts';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const WORDS_DIR = join(TOOLS_DIR, '..', 'words');
const LIST_FILE = join(WORDS_DIR, 'word-list.txt');
const BACKUP_FILE = join(WORDS_DIR, 'word-list.before-clean.txt');

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

async function main() {
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

  // Filter out words that do not pass shouldFilterAsync
  const filterResults = await Promise.all(uniqueWords.map((w) => shouldFilterAsync(w)));
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
